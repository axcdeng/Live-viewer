import { requireAdmin } from './_admin-auth.js';

export const config = {
    runtime: 'nodejs', // Use Node.js runtime for easier fetch/auth handling
};

// The whole preset list is replaced on every save, so anything that is not a
// list of routes with a sku and a path would wipe every preset at once.
function isRouteList(value) {
    return Array.isArray(value) && value.every((route) =>
        route && typeof route === 'object'
        && typeof route.sku === 'string' && route.sku
        && typeof route.path === 'string' && route.path);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdmin(req, res)) return;

    const { EDGE_CONFIG_ID, VERCEL_API_TOKEN } = process.env;

    if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
        console.error('Missing env vars');
        return res.status(500).json({ error: 'Server misconfiguration: Missing env vars' });
    }

    const updatedRoutes = req.body;
    if (!isRouteList(updatedRoutes)) {
        return res.status(400).json({ error: 'Expected an array of routes, each with a sku and a path' });
    }

    try {
        // Update the Edge Config Store
        // Docs: https://vercel.com/docs/rest-api/endpoints#update-edge-config-items
        const response = await fetch(
            `https://api.vercel.com/v1/edge-config/${EDGE_CONFIG_ID}/items`,
            {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${VERCEL_API_TOKEN}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    items: [
                        {
                            operation: 'update',
                            key: 'routes',
                            value: updatedRoutes,
                        },
                    ],
                }),
            }
        );

        const result = await response.json();

        if (!response.ok) {
            console.error('Vercel API Error:', result);
            return res.status(response.status).json({ error: result.error?.message || 'Failed to update config' });
        }

        return res.status(200).json({ success: true, result });
    } catch (error) {
        console.error('Error saving routes:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
