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

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');
    // The current clip flips when a broadcast starts or ends, so this is only
    // worth a short cache — the admin hits it expecting live-ish truth.
    res.setHeader('Cache-Control', 'public, max-age=15, s-maxage=15');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const eventId = String(req.query.eventId || '').trim();
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
        const videoId = html.match(CLIP_ID_RE)?.[1] ?? null;

        if (!videoId) {
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

        return res.status(200).json({ eventId, videoId, ...details });
    } catch (error) {
        console.error('[vimeo-clip]', error);
        return res.status(500).json({ error: 'Failed to reach Vimeo', message: error.message });
    }
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
