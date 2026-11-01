import { env } from 'cloudflare:workers';

// Workers KV replaces both Vercel Edge Config (the preset route table) and
// Vercel KV (the stream-detection and YouTube start-time caches).

const ROUTES_KEY = 'routes';

export async function getRoutes() {
    return (await env.STORE.get(ROUTES_KEY, 'json')) || [];
}

export async function setRoutes(routes) {
    await env.STORE.put(ROUTES_KEY, JSON.stringify(routes));
}

// The slice of the @vercel/kv API the handlers use.
export const kv = {
    async get(key) {
        return env.STORE.get(`cache:${key}`, 'json');
    },
    async set(key, value, { ex } = {}) {
        // KV's minimum TTL is 60 seconds.
        await env.STORE.put(`cache:${key}`, JSON.stringify(value), ex ? { expirationTtl: Math.max(ex, 60) } : undefined);
    },
};
