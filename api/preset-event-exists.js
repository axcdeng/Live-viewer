import { getRoutes } from '../worker/store.js';

export const config = {
    runtime: 'edge',
};

export default async function handler(req) {
    const url = new URL(req.url);
    const sku = url.searchParams.get('sku');

    if (!sku) {
        return new Response(JSON.stringify({ error: 'Missing sku parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    try {
        const routes = await getRoutes();
        const exists = routes.some(r => r.sku === sku);

        return new Response(JSON.stringify({ exists, sku }), {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    } catch (error) {
        console.error('Error checking preset event:', error);
        return new Response(JSON.stringify({ error: 'Failed to check preset event' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
