import { requireAdmin } from './_admin-auth.js';

export const config = {
    runtime: 'nodejs',
};

// Verifies the admin's credentials so the login form can say yes or no before
// anything is saved. Holds no session: every write re-checks the same header.
export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }
    if (!requireAdmin(req, res)) return;
    return res.status(200).json({ ok: true });
}
