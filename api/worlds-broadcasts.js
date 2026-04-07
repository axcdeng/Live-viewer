// Proxy for BoxCast channel broadcast listings.
// Avoids CORS issues and lets us cache + filter server-side.
//
// Query params:
//   channelId  – BoxCast channel ID (required)
//   year       – 4-digit year string, e.g. "2025" (optional filter)

export const config = {
    runtime: 'nodejs',
    maxDuration: 15,
};

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { channelId, year } = req.query;

    if (!channelId) {
        return res.status(400).json({ error: 'channelId is required' });
    }

    try {
        // Fetch up to 200 broadcasts from the channel.
        // BoxCast returns an array directly (no wrapper object).
        const bcRes = await fetch(
            `https://api.boxcast.com/channels/${channelId}/broadcasts?l=100`,
            { headers: { Accept: 'application/json' } }
        );

        if (!bcRes.ok) {
            return res.status(502).json({ error: `BoxCast returned ${bcRes.status}` });
        }

        let broadcasts = await bcRes.json();

        // BoxCast may return an array or { data: [] } depending on version
        if (!Array.isArray(broadcasts)) {
            broadcasts = broadcasts.data ?? [];
        }

        // Optional year filter – keeps response lean
        if (year) {
            broadcasts = broadcasts.filter(
                (bc) => bc.starts_at && bc.starts_at.startsWith(year)
            );
        }

        res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
        return res.status(200).json(broadcasts);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
