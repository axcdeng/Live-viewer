// Resolve the clip a Vimeo event is currently pointing at.
//
// A Vimeo "event" (vimeo.com/event/<id>) is a recurring live channel whose embed
// renders whichever clip is live or up next, and each broadcast session becomes
// its own clip. There is no unauthenticated way to list the whole playlist — the
// Vimeo API is a paid tier — but the public embed page names the current clip in
// its player config URL, which is enough to prefill the admin form one day at a
// time.
//
// Everything here is scraping the public embed HTML. No API key, no auth.

export const config = {
    runtime: 'nodejs',
    maxDuration: 20,
};

// Vimeo serves the embed page to plain fetches, but a browser-ish UA keeps it
// from occasionally handing back the JS-shell variant with no config URL in it.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const CONFIG_URL_RE = /data-config-url="([^"]+)"/;
const CLIP_ID_RE = /player\.vimeo\.com\/video\/(\d+)\//;
// The unlisted hash that makes a clip embeddable on its own, straight from the
// `?h=` on any player URL Vimeo publishes for it.
const HASH_RE = /\/video\/\d+\?h=([a-z0-9]+)/i;

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    // The current clip flips when a broadcast starts or ends, so this is only
    // worth a short cache — the admin hits it expecting live-ish truth.
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const eventId = String(req.query.eventId || '').trim();
    const videoId = String(req.query.videoId || '').trim();

    // Hash lookup for a clip we already know the id of. Needed because a past
    // day's clip has to keep playing after the event moves on, and only the
    // hashed player URL pins one — the event embed always serves whichever clip
    // is currently featured, ignoring `?video=`.
    if (videoId) {
        if (!/^\d+$/.test(videoId)) {
            return res.status(400).json({ error: 'videoId must be a numeric Vimeo clip id' });
        }
        try {
            const hash = await fetchClipHash(videoId);
            if (!hash) return res.status(404).json({ error: `No embed hash found for clip ${videoId}`, videoId });
            return res.status(200).json({ videoId, hash });
        } catch (error) {
            console.error('[vimeo-clip] hash lookup', error);
            return res.status(500).json({ error: 'Failed to reach Vimeo', message: error.message });
        }
    }

    if (!/^\d+$/.test(eventId)) {
        return res.status(400).json({ error: 'eventId must be a numeric Vimeo event id' });
    }

    try {
        const embedRes = await fetch(`https://vimeo.com/event/${eventId}/embed`, {
            headers: { 'User-Agent': UA, Accept: 'text/html' },
        });

        if (!embedRes.ok) {
            return res.status(502).json({ error: `Vimeo returned ${embedRes.status} for event ${eventId}` });
        }

        const html = await embedRes.text();
        const currentId = html.match(CLIP_ID_RE)?.[1] ?? null;

        if (!currentId) {
            return res.status(404).json({
                error: 'No clip is attached to this Vimeo event right now.',
                eventId,
            });
        }

        // The config URL carries a short-lived signature, so it has to be taken
        // from the embed HTML rather than rebuilt. It is the only place duration
        // and live status are exposed, and it is strictly a nice-to-have — a
        // failure here still leaves us with the clip id.
        const details = await fetchClipDetails(decodeEntities(html.match(CONFIG_URL_RE)?.[1] ?? ''));

        // Resolved separately from the config: the hash is what lets this clip
        // still be played once it is no longer the featured one.
        const hash = details.hash ?? (await fetchClipHash(currentId).catch(() => null));

        return res.status(200).json({ eventId, videoId: currentId, ...details, hash });
    } catch (error) {
        console.error('[vimeo-clip]', error);
        return res.status(500).json({ error: 'Failed to reach Vimeo', message: error.message });
    }
}

// Scrape a clip's own Vimeo page for the `?h=` hash. Vimeo publishes it in the
// page's player URL, which is also what its share/embed code uses.
async function fetchClipHash(videoId) {
    const res = await fetch(`https://vimeo.com/${videoId}`, {
        headers: { 'User-Agent': UA, Accept: 'text/html' },
    });
    if (!res.ok) return null;
    // Anchored to the requested id: a Vimeo page also carries player URLs for
    // related and next-up clips, and storing one of those hashes would pin the
    // wrong recording with nothing on screen to say so.
    const anchored = new RegExp(`/video/${videoId}\\?h=([a-z0-9]+)`, 'i');
    return (await res.text()).match(anchored)?.[1] ?? null;
}

async function fetchClipDetails(configUrl) {
    if (!configUrl) return {};

    try {
        const configRes = await fetch(configUrl, { headers: { 'User-Agent': UA } });
        if (!configRes.ok) return {};

        const data = await configRes.json();
        const video = data.video ?? {};
        const liveEvent = video.live_event ?? null;

        return {
            // Vimeo's own embed code carries the hash, so prefer it over a
            // second page fetch when the config is available.
            hash: String(data.video?.embed_code ?? '').match(HASH_RE)?.[1]
                ?? video.unlisted_hash
                ?? null,
            title: video.title ?? null,
            // 0 while a stream is live or still pending — duration only settles
            // once the session is archived.
            duration: video.duration ?? null,
            // 'pending' (scheduled, not started), 'streaming', 'ended', or absent
            // for an ordinary uploaded clip.
            liveStatus: liveEvent?.status ?? null,
            scheduledStart: liveEvent?.ingest?.scheduled_start_time ?? null,
            // DVR is what makes seeking work while a broadcast is still running.
            dvr: liveEvent?.dvr ?? null,
        };
    } catch {
        return {};
    }
}

function decodeEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}
