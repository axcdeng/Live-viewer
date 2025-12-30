
export const config = {
    runtime: 'nodejs', // Use Node.js runtime for easier fetch/auth handling
};

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { EDGE_CONFIG_ID, VERCEL_API_TOKEN } = process.env;

    if (!EDGE_CONFIG_ID || !VERCEL_API_TOKEN) {
        console.error('Missing env vars');
        return res.status(500).json({ error: 'Server misconfiguration: Missing env vars' });
    }

    try {
        const updatedRoutes = req.body; // Expecting the array of routes

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
