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

    const { sku, offsetSeconds = '0' } = req.query;

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
        const preset = routes.find(r => r.sku === sku);

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

        // 5. Build result — one entry per match
        const results = allMatches.map(match => {
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
