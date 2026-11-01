import { requireAdmin } from './_admin-auth.js';
import { setRoutes } from '../worker/store.js';

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

    const updatedRoutes = req.body;
    if (!isRouteList(updatedRoutes)) {
        return res.status(400).json({ error: 'Expected an array of routes, each with a sku and a path' });
    }

    try {
        await setRoutes(updatedRoutes);
        return res.status(200).json({ success: true });
    } catch (error) {
        console.error('Error saving routes:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
