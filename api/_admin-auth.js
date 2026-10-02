import { timingSafeEqual } from 'node:crypto';

// Server-side check for the admin's credentials. The leading underscore keeps
// Vercel from serving this file as an endpoint of its own.
//
// The credentials live only in the ADMIN_USERNAME / ADMIN_PASSWORD env vars.
// The client sends them as HTTP Basic auth on every write. With either env var
// unset, every request is refused: an unconfigured deploy must not fall open.

function safeEqual(a, b) {
    const left = Buffer.from(String(a));
    const right = Buffer.from(String(b));
    return left.length === right.length && timingSafeEqual(left, right);
}

// 'ok', 'unconfigured' or 'denied'.
export function checkAdmin(req) {
    const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
    if (!ADMIN_USERNAME || !ADMIN_PASSWORD) return 'unconfigured';

    const header = String(req.headers?.authorization || '');
    const match = header.match(/^Basic\s+(.+)$/i);
    if (!match) return 'denied';

    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const split = decoded.indexOf(':');
    if (split < 0) return 'denied';

    // Both compared, always, so a wrong username takes as long as a wrong password.
    const userOk = safeEqual(decoded.slice(0, split), ADMIN_USERNAME);
    const passOk = safeEqual(decoded.slice(split + 1), ADMIN_PASSWORD);
    return userOk && passOk ? 'ok' : 'denied';
}

// Sends the refusal and returns false, or returns true for an admin.
export function requireAdmin(req, res) {
    const result = checkAdmin(req);
    if (result === 'ok') return true;
    if (result === 'unconfigured') {
        console.error('[admin-auth] ADMIN_USERNAME / ADMIN_PASSWORD are not set');
        res.status(503).json({ error: 'Admin login is not configured on the server' });
    } else {
        res.status(401).json({ error: 'Invalid credentials' });
    }
    return false;
}
