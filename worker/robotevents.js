import { kv } from './store.js';

// Every RobotEvents call the API makes, through a pool of keys and a short cache.
//
// match-timestamp used to fetch the event and every page of its matches on each
// request, all on one key. The apps ask once per event opened, and every match
// lookup at every event failed once RobotEvents started answering 429 ("Too
// Many Attempts"). A cached answer costs no request; a 429 on one key moves on
// to the next, and past the last key to OpenScout's proxy.

const RE_API = 'https://events.vex.com/api/v2';
const OPENSCOUT_RE = 'https://openscout.ing/api/re';

export class RateLimited extends Error {}

/** ROBOTEVENTS_API_KEYS (comma or whitespace separated), then the single keys. */
function keys() {
    const pool = (process.env.ROBOTEVENTS_API_KEYS || '').split(/[\s,]+/);
    pool.push(process.env.ROBOTEVENTS_API_KEY, process.env.VITE_DEFAULT_ROBOTEVENTS_API_KEY);
    return [...new Set(pool.filter(Boolean))];
}

// The key that last answered, so a limited one is not tried first every time.
let next = 0;

/**
 * GET a RobotEvents API path and return its JSON, or the cached copy.
 *
 * `ttl` is in seconds; 0 skips the cache. Returns null for a non-429 failure,
 * with the status, so the caller words its own error. Throws RateLimited when
 * every key is limited.
 */
export async function reGet(path, ttl = 0) {
    const cacheKey = `re:${path}`;
    if (ttl > 0) {
        const hit = await kv.get(cacheKey);
        if (hit) return { ok: true, data: hit };
    }

    const pool = keys();
    for (let tried = 0; tried < pool.length; tried++) {
        const index = (next + tried) % pool.length;
        const res = await fetch(`${RE_API}${path}`, {
            headers: { Authorization: `Bearer ${pool[index]}`, Accept: 'application/json' },
        });
        if (res.status === 429) continue;
        next = index;
        if (!res.ok) return { ok: false, status: res.status };
        return keep(cacheKey, ttl, await res.json());
    }

    // RobotEvents limits Cloudflare's shared egress addresses whatever the key,
    // so from a Worker every key can be refused at once. OpenScout's proxy
    // answers the same paths from its own cache, its snapshots or the RoboSTEM
    // mirror when RobotEvents refuses it too.
    const res = await fetch(`${OPENSCOUT_RE}${path}`, {
        headers: { Referer: 'https://openscout.ing/', Accept: 'application/json' },
    });
    if (res.ok) return keep(cacheKey, ttl, await res.json());
    if (res.status !== 429) return { ok: false, status: res.status };
    throw new RateLimited('Every RobotEvents key is rate limited');
}

async function keep(cacheKey, ttl, data) {
    if (ttl > 0) await kv.set(cacheKey, data, { ex: ttl });
    return { ok: true, data };
}
