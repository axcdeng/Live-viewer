import detectStreams from '../api/detect-streams.js';
import matchTimestamp from '../api/match-timestamp.js';
import vimeoClip from '../api/vimeo-clip.js';
import worldsBroadcasts from '../api/worlds-broadcasts.js';
import adminLogin from '../api/admin-login.js';
import saveRoutes from '../api/save-routes.js';
import getAllRoutes from '../api/get-all-routes.js';
import presetEventExists from '../api/preset-event-exists.js';
import sitemap from '../api/sitemap.xml.js';

const HANDLERS = {
    '/api/detect-streams': detectStreams,
    '/api/match-timestamp': matchTimestamp,
    '/api/vimeo-clip': vimeoClip,
    '/api/worlds-broadcasts': worldsBroadcasts,
    '/api/admin-login': adminLogin,
    '/api/save-routes': saveRoutes,
    '/api/get-all-routes': getAllRoutes,
    '/api/preset-event-exists': presetEventExists,
    '/sitemap.xml': sitemap,
    '/api/sitemap.xml': sitemap,
};

// The handlers were written for Vercel: some take a Request and return a
// Response (edge style), the rest take Node-style (req, res). This runs either.
async function run(handler, request) {
    const url = new URL(request.url);
    const query = {};
    for (const key of new Set(url.searchParams.keys())) {
        const all = url.searchParams.getAll(key);
        query[key] = all.length > 1 ? all : all[0];
    }

    let body;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        const text = await request.text();
        try { body = text ? JSON.parse(text) : undefined; } catch { body = text; }
    }

    const headers = {};
    request.headers.forEach((value, key) => { headers[key] = value; });

    let status = 200;
    const out = new Headers();
    let payload = null;
    let settle;
    const done = new Promise((resolve) => { settle = resolve; });
    const finish = (data) => {
        payload = data;
        settle(new Response(payload, { status, headers: out }));
    };
    const res = {
        setHeader(key, value) { out.set(key, value); return res; },
        status(code) { status = code; return res; },
        json(data) { out.set('Content-Type', 'application/json'); finish(JSON.stringify(data)); return res; },
        send(data) { finish(typeof data === 'string' ? data : JSON.stringify(data)); return res; },
        end(data) { finish(data ?? null); return res; },
    };
    const req = { method: request.method, url: request.url, query, body, headers };

    const result = await handler(req, res);
    if (result instanceof Response) return result;
    return done;
}

export default {
    async fetch(request, env) {
        const { pathname } = new URL(request.url);
        const handler = HANDLERS[pathname];
        if (!handler) return env.ASSETS.fetch(request);
        try {
            return await run(handler, request);
        } catch (error) {
            console.error(pathname, error);
            return Response.json({ error: 'Internal Server Error' }, { status: 500 });
        }
    },
};
