// The admin's credentials, held for the tab's lifetime as an HTTP Basic token.
// The server checks them on every write (api/_admin-auth.js), so nothing here
// is a secret the bundle has to keep: a forged token just gets a 401.

const KEY = 'adminAuth';

export function getAdminToken() {
    try {
        const value = sessionStorage.getItem(KEY);
        // 'true' is what the old client-side-only login stored.
        return value && value !== 'true' ? value : null;
    } catch {
        return null;
    }
}

export function clearAdminToken() {
    try {
        sessionStorage.removeItem(KEY);
    } catch {
        // nothing to clear
    }
}

// Resolves to 'ok', 'denied' or 'error' (server unreachable or not configured).
export async function adminLogin(username, password) {
    const token = btoa(unescape(encodeURIComponent(`${username}:${password}`)));
    try {
        const res = await fetch('/api/admin-login', {
            method: 'POST',
            headers: { Authorization: `Basic ${token}` },
        });
        if (res.ok) {
            sessionStorage.setItem(KEY, token);
            return 'ok';
        }
        return res.status === 401 ? 'denied' : 'error';
    } catch {
        return 'error';
    }
}

export function saveRoutes(routes) {
    return fetch('/api/save-routes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Basic ${getAdminToken() ?? ''}`,
        },
        body: JSON.stringify(routes),
    });
}
