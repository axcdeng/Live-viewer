import { kv } from '@vercel/kv';
import { createClient } from '@vercel/edge-config';

export const config = {
    runtime: 'nodejs',
    maxDuration: 30,
};

const RE_API = 'https://events.vex.com/api/v2';
const YT_START_CACHE_TTL = 86400; // 24 hours — stream start times don't change

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { sku, matchId, offsetSeconds = '0' } = req.query;

    if (!sku || !matchId) {
        return res.status(400).json({ error: 'Missing required parameters: sku, matchId' });
    }

    const offset = parseInt(offsetSeconds) || 0;
    const reApiKey = process.env.ROBOTEVENTS_API_KEY || process.env.VITE_DEFAULT_ROBOTEVENTS_API_KEY;
    const ytApiKey = process.env.YOUTUBE_API_KEY || process.env.VITE_DEFAULT_YOUTUBE_API_KEY;

    const reHeaders = {
        'Authorization': `Bearer ${reApiKey}`,
        'Accept': 'application/json',
    };

    try {
        // 1. Verify preset exists in Edge Config
        const edgeClient = createClient(process.env.EDGE_CONFIG);
        const routes = await edgeClient.get('routes') || [];
        const preset = routes.find(r => r.sku === sku);

        if (!preset) {
            return res.status(404).json({ error: 'Event not found in presets' });
        }

        // 2. Fetch match from events.vex.com
        const matchRes = await fetch(`${RE_API}/matches/${matchId}`, { headers: reHeaders });

        if (!matchRes.ok) {
            return res.status(404).json({ error: 'Match not found' });
        }

        const match = await matchRes.json();

        if (!match.started) {
            return res.status(422).json({ error: 'Match has no start time' });
        }

        const matchStartMs = new Date(match.started).getTime();
        const divisionId = String(match.division?.id || 1);

        // 3. Fetch event start date to calculate day index
        const eventRes = await fetch(`${RE_API}/events/${match.event.id}`, { headers: reHeaders });
        let eventStartMs = matchStartMs;

        if (eventRes.ok) {
            const event = await eventRes.json();
            if (event.start) eventStartMs = new Date(event.start).getTime();
        }

        // 4. Day index = how many calendar days into the event the match falls
        const dayIndex = Math.max(0, Math.floor((matchStartMs - eventStartMs) / (1000 * 60 * 60 * 24)));

        // 5. Pick video ID from preset streams
        let videoId = null;

        if (preset.multiStreams) {
            const divStreams = preset.multiStreams[divisionId]
                ?? preset.multiStreams[Object.keys(preset.multiStreams)[0]];
            if (divStreams) {
                videoId = divStreams[String(dayIndex)] ?? divStreams[Object.keys(divStreams)[0]];
            }
        } else if (preset.streams) {
            if (Array.isArray(preset.streams)) {
                videoId = preset.streams[dayIndex] ?? preset.streams[0];
            } else {
                const divStreams = preset.streams[divisionId]
                    ?? preset.streams[Object.keys(preset.streams)[0]];
                if (Array.isArray(divStreams)) {
                    videoId = divStreams[dayIndex] ?? divStreams[0];
                }
            }
        }

        if (!videoId) {
            return res.status(404).json({ error: 'No stream configured for this match' });
        }

        // 6. Get YouTube stream start time (KV cache → YouTube API)
        const cacheKey = `yt_start_time:${videoId}`;
        let streamStartMs = null;

        try {
            const cached = await kv.get(cacheKey);
            if (cached !== null) streamStartMs = cached;
        } catch (_) {
            // KV unavailable, fall through to YouTube API
        }

        if (streamStartMs === null) {
            if (!ytApiKey) {
                return res.status(503).json({ error: 'YouTube API key not configured' });
            }

            const ytRes = await fetch(
                `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails&id=${videoId}&key=${ytApiKey}`
            );

            if (ytRes.ok) {
                const ytData = await ytRes.json();
                const actualStart = ytData.items?.[0]?.liveStreamingDetails?.actualStartTime;
                if (actualStart) {
                    streamStartMs = new Date(actualStart).getTime();
                    try {
                        await kv.set(cacheKey, streamStartMs, { ex: YT_START_CACHE_TTL });
                    } catch (_) {
                        // ignore cache write failure
                    }
                }
            }
        }

        if (streamStartMs === null) {
            return res.status(503).json({ error: 'Could not determine stream start time' });
        }

        // 7. Calculate seek position
        const seekSeconds = Math.floor((matchStartMs - streamStartMs) / 1000) + offset;

        return res.status(200).json({
            timestamp: seekSeconds,
            livestreamLink: `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, seekSeconds)}`,
            videoId,
            matchName: match.name,
        });

    } catch (error) {
        console.error('[match-timestamp]', error);
        return res.status(500).json({ error: 'Internal server error', message: error.message });
    }
}
