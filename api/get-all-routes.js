
import { createClient } from '@vercel/edge-config';

export const config = {
    runtime: 'edge', // Use Edge Runtime for speed
};

export default async function handler(req) {
    try {
        const client = createClient(process.env.EDGE_CONFIG);
        const routes = await client.get('routes');

        return new Response(JSON.stringify(routes || []), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store, max-age=0', // Always fetch fresh data for admin
            },
        });
    } catch (error) {
        console.error('Error fetching routes:', error);
        return new Response(JSON.stringify({ error: 'Failed to fetch routes' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
