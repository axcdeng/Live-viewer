import { kv } from '@vercel/kv';
import { createClient } from '@vercel/edge-config';

export const config = {
    runtime: 'nodejs',
    maxDuration: 60,
};

const RE_API = 'https://events.vex.com/api/v2';
const YT_START_CACHE_TTL = 86400; // 24 hours

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { sku, offsetSeconds = '0', streams: adHocStreams } = req.query;

    if (!sku) {
        return res.status(400).json({ error: 'Missing required parameter: sku' });
    }

    const offset = parseInt(offsetSeconds) || 0;
    const reApiKey = process.env.ROBOTEVENTS_API_KEY || process.env.VITE_DEFAULT_ROBOTEVENTS_API_KEY;
    const ytApiKey = process.env.YOUTUBE_API_KEY || process.env.VITE_DEFAULT_YOUTUBE_API_KEY;
    const reHeaders = { 'Authorization': `Bearer ${reApiKey}`, 'Accept': 'application/json' };

    try {
        // 1. Verify preset exists in Edge Config
        const edgeClient = createClient(process.env.EDGE_CONFIG);
        const routes = await edgeClient.get('routes') || [];
        // An event nobody has set up can still be answered, if the caller says
        // which recordings to measure against. See adHocPreset.
        const preset = routes.find(r => r.sku === sku) || adHocPreset(sku, adHocStreams);

        if (!preset) {
            return res.status(404).json({ error: 'Event not found in presets' });
        }

        // 2. Fetch event metadata (ID, divisions, start date)
        const eventRes = await fetch(`${RE_API}/events?sku[]=${sku}`, { headers: reHeaders });
        if (!eventRes.ok) return res.status(502).json({ error: 'Failed to fetch event' });

        const eventData = await eventRes.json();
        const event = eventData.data?.[0];
        if (!event) return res.status(404).json({ error: 'Event not found in RobotEvents' });

        const eventStartMs = new Date(event.start).getTime();
        const divisions = event.divisions?.length ? event.divisions : [{ id: 1 }];

        // 3. Fetch all matches across all divisions in parallel (paginated)
        const divisionMatches = await Promise.all(divisions.map(async (div) => {
            const matches = [];
            let page = 1;
            while (true) {
                const r = await fetch(
                    `${RE_API}/events/${event.id}/divisions/${div.id}/matches?per_page=250&page=${page}`,
                    { headers: reHeaders }
                );
                if (!r.ok) break;
                const d = await r.json();
                matches.push(...(d.data || []));
                if (d.meta?.current_page >= d.meta?.last_page) break;
                page++;
            }
            return matches;
        }));

        const allMatches = divisionMatches.flat();

        // 4. Determine which video IDs are needed, fetch their YouTube start times
        const neededVideoIds = new Set();
        for (const match of allMatches) {
            if (!match.started) continue;
            const matchStartMs = new Date(match.started).getTime();
            const dayIndex = Math.max(0, Math.floor((matchStartMs - eventStartMs) / (1000 * 60 * 60 * 24)));
            const videoId = getVideoId(preset, String(match.division?.id || 1), dayIndex);
            if (videoId) neededVideoIds.add(videoId);
        }

        const streamStartTimes = await fetchStreamStartTimes([...neededVideoIds], ytApiKey);

        // 4b. Vimeo presets carry their own per-day anchors instead of a stream
        // start time we can look up (see resolveVimeoDays).
        const vimeoDays = resolveVimeoDays(preset, allMatches);
        // Presets saved before hashes were stored carry a clip id but no hash,
        // and without one the player can only fall back to the event embed —
        // which serves whichever clip is featured now, i.e. the wrong day. Fill
        // the gap here so an old preset heals itself rather than silently
        // playing the wrong recording.
        await backfillVimeoHashes(vimeoDays);

        // 5. Build result — one entry per match
        const results = allMatches.map(match => {
            const vimeoEntry = vimeoTimestampFor(match, preset, vimeoDays, offset);
            if (vimeoEntry) return vimeoEntry;

            const matchStartMs = match.started ? new Date(match.started).getTime() : null;
            const divisionId = String(match.division?.id || 1);
            const dayIndex = matchStartMs !== null
                ? Math.max(0, Math.floor((matchStartMs - eventStartMs) / (1000 * 60 * 60 * 24)))
                : 0;
            const videoId = getVideoId(preset, divisionId, dayIndex);
            const streamStartMs = videoId ? streamStartTimes[videoId] ?? null : null;

            let timestamp = null;
            let livestreamLink = null;

            if (matchStartMs !== null && streamStartMs !== null && videoId) {
                const seekSeconds = Math.floor((matchStartMs - streamStartMs) / 1000) + offset;
                timestamp = seekSeconds;
                livestreamLink = `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, seekSeconds)}`;
            }

            return {
                id: match.id,
                name: match.name,
                divisionId: match.division?.id ?? 1,
                timestamp,
                livestreamLink,
                videoId: videoId || null,
            };
        });

        return res.status(200).json(results);

    } catch (error) {
        console.error('[match-timestamp]', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}

// ---------------------------------------------------------------------------
// Vimeo
//
// Vimeo's live API is a paid tier, so unlike YouTube there is no way to ask when
// a broadcast started. Instead the admin supplies one anchor per day — a match,
// and how far into the video that match begins — and everything else follows,
// because the recording runs in real time:
//
//   streamStart      = anchorMatchStart − anchorSeconds
//   seek(anyMatch)   = anchorSeconds + (thatMatchStart − anchorMatchStart)
//
// Days are keyed by the venue's own calendar date. RobotEvents timestamps carry
// the venue's UTC offset, so slicing the date off the string is exact — parsing
// into a Date would re-anchor to the server's timezone and roll late-evening
// matches into the next day.
// ---------------------------------------------------------------------------

const VIMEO_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const localDate = (isoString) => (isoString ? String(isoString).slice(0, 10) : null);
const matchTime = (match) => match?.started || match?.scheduled || null;

// date → { videoId, streamStartMs }, for the days that are actually armed.
function resolveVimeoDays(preset, allMatches) {
    const days = preset?.vimeo?.days;
    if (!Array.isArray(days)) return null;

    const resolved = new Map();

    for (const day of days) {
        if (!day?.date || day.anchorSeconds === null || day.anchorSeconds === undefined) continue;
        if (!day.videoId) continue; // armed but no clip yet — nothing to play

        // Prefer the anchor match's live start time over the copy saved with the
        // day, so a RobotEvents revision cannot drag every seek off by the same
        // amount relative to the other matches.
        const live = allMatches.find(m => m.id === day.anchorMatchId);
        const anchorStartedAt = matchTime(live) || day.anchorStartedAt;
        if (!anchorStartedAt) continue;

        const anchorMs = new Date(anchorStartedAt).getTime();
        if (Number.isNaN(anchorMs)) continue;

        resolved.set(day.date, {
            videoId: String(day.videoId),
            // Only a hashed player URL pins a specific clip; without it the
            // player falls back to the event embed, which serves whichever clip
            // is featured right now.
            hash: day.hash ? String(day.hash) : null,
            streamStartMs: anchorMs - Number(day.anchorSeconds) * 1000,
        });
    }

    return resolved.size ? resolved : null;
}

// Best-effort: a lookup failure just leaves the day hashless, which is no worse
// than before. Runs at most once per configured day and only when needed.
async function backfillVimeoHashes(vimeoDays) {
    if (!vimeoDays) return;
    const missing = [...vimeoDays.values()].filter((day) => !day.hash);
    if (!missing.length) return;

    await Promise.all(missing.map(async (day) => {
        try {
            const res = await fetch(`https://vimeo.com/${day.videoId}`, {
                headers: { 'User-Agent': VIMEO_UA, Accept: 'text/html' },
            });
            if (!res.ok) return;
            // Anchored to this clip: the page also lists related clips' player
            // URLs, and taking one of those would pin the wrong recording.
            const anchored = new RegExp(`/video/${day.videoId}\\?h=([a-z0-9]+)`, 'i');
            day.hash = (await res.text()).match(anchored)?.[1] ?? null;
        } catch {
            // leave it null
        }
    }));
}

function vimeoTimestampFor(match, preset, vimeoDays, offset) {
    if (!vimeoDays) return null;

    // Only matches that actually ran, matching the YouTube path above — a
    // scheduled-but-unplayed match would otherwise come back with a non-null
    // timestamp and light up a play button for footage that does not exist.
    if (!match?.started) return null;

    const startedAt = matchTime(match);
    const day = vimeoDays.get(localDate(startedAt));
    if (!day) return null;

    const seekSeconds = Math.floor((new Date(startedAt).getTime() - day.streamStartMs) / 1000) + offset;
    // A match before the anchor by more than the anchor's own offset would seek
    // behind the start of the recording.
    if (!Number.isFinite(seekSeconds) || seekSeconds < 0) return null;

    const eventId = String(preset.vimeo.eventId);

    return {
        id: match.id,
        name: match.name,
        divisionId: match.division?.id ?? 1,
        timestamp: seekSeconds,
        livestreamLink: `https://vimeo.com/event/${eventId}/video/${day.videoId}`,
        videoId: null,
        vimeo: { eventId, videoId: day.videoId, hash: day.hash },
    };
}

// ---------------------------------------------------------------------------
// Events nobody has set up
//
// A preset exists because somebody had to find the recordings by hand. The
// arithmetic afterwards needs nothing but the video ids: this server holds both
// keys — RobotEvents for the schedule, YouTube for when each broadcast actually
// started — and a caller that has found the recordings itself is only missing
// those two lookups.
//
// So `streams` may be passed in the query, in exactly the shape a preset stores
// it, and it is used only when the SKU has no preset of its own. A real preset
// always wins: it was set up deliberately, and its day and division mapping is
// known good.
//
// Nothing is written anywhere. This is a read with the caller's own list, not a
// way to add a preset — save-routes is still the only thing that does that.
// ---------------------------------------------------------------------------

// A YouTube id is eleven of these and nothing else. Checked rather than trusted:
// every id here is interpolated into a googleapis URL below.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// Enough for a four-day event in four divisions. The cap is what stops this
// endpoint being a way to spend the YouTube quota a thousand ids at a time.
const AD_HOC_MAX_IDS = 16;

function adHocPreset(sku, raw) {
    if (!raw) return null;

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }

    // Either a bare list of ids in day order, or those lists keyed by division -
    // the two shapes a preset's `streams` already comes in.
    const lists = Array.isArray(parsed)
        ? { 1: parsed }
        : (parsed && typeof parsed === 'object' ? parsed : null);
    if (!lists) return null;

    const streams = {};
    const seen = new Set();

    for (const [division, days] of Object.entries(lists)) {
        if (!Array.isArray(days)) continue;
        if (!/^[0-9]+$/.test(String(division))) continue;

        // Blanks are kept in place, not dropped: the position in this list *is*
        // the day, so a missing day one has to stay a hole rather than shifting
        // day two into it.
        const cleaned = days.map((id) => {
            const value = typeof id === 'string' ? id.trim() : '';
            if (!VIDEO_ID.test(value)) return '';
            seen.add(value);
            return value;
        });

        if (cleaned.some(Boolean)) streams[division] = cleaned;
    }

    if (!Object.keys(streams).length) return null;
    if (seen.size > AD_HOC_MAX_IDS) return null;

    return { sku, streams, adHoc: true };
}

function getVideoId(preset, divisionId, dayIndex) {
    let videoId = null;

    if (preset.multiStreams) {
        const divStreams = preset.multiStreams[divisionId]
            ?? preset.multiStreams[Object.keys(preset.multiStreams)[0]];
        if (divStreams) {
            videoId = divStreams[String(dayIndex)] ?? divStreams[Object.keys(divStreams)[0]] ?? null;
        }
    } else if (preset.streams) {
        if (Array.isArray(preset.streams)) {
            videoId = preset.streams[dayIndex] ?? preset.streams[0] ?? null;
        } else {
            const divStreams = preset.streams[divisionId]
                ?? preset.streams[Object.keys(preset.streams)[0]];
            if (Array.isArray(divStreams)) {
                videoId = divStreams[dayIndex] ?? divStreams[0] ?? null;
            }
        }
    }

    return videoId || null; // treat empty string as null
}

async function fetchStreamStartTimes(videoIds, ytApiKey) {
    const result = {};
    if (!videoIds.length) return result;

    // Check KV cache for all IDs in parallel
    const cacheResults = await Promise.allSettled(
        videoIds.map(id => kv.get(`yt_start_time:${id}`))
    );

    const missing = [];
    for (let i = 0; i < videoIds.length; i++) {
        const val = cacheResults[i].status === 'fulfilled' ? cacheResults[i].value : null;
        if (val !== null) {
            result[videoIds[i]] = val;
        } else {
            missing.push(videoIds[i]);
        }
    }

    if (!missing.length || !ytApiKey) return result;

    // YouTube API supports up to 50 IDs per request
    for (let i = 0; i < missing.length; i += 50) {
        const chunk = missing.slice(i, i + 50);
        const ytRes = await fetch(
            `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${chunk.join(',')}&key=${ytApiKey}`
        );
        if (!ytRes.ok) continue;
        const ytData = await ytRes.json();
        for (const item of ytData.items || []) {
            const actualStart = item.liveStreamingDetails?.actualStartTime;
            if (actualStart) {
                const ms = new Date(actualStart).getTime();
                result[item.id] = ms;
                kv.set(`yt_start_time:${item.id}`, ms, { ex: YT_START_CACHE_TTL }).catch(() => {});
            }
        }
    }

    return result;
}
