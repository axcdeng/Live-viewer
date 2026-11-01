import { getRoutes } from '../worker/store.js';

export const config = {
    runtime: 'edge', // Fast edge execution
};

// Helper to escape XML special characters
function escapeXml(unsafe) {
    return (unsafe || '').replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
        }
        return c;
    });
}

function generateSitemapXml(routes) {
    const baseUrl = 'https://jumper.robostem.org';
    const today = new Date().toISOString().split('T')[0];

    // Build the XML structure
    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // Root URL
    xml += `  <url>\n`;
    xml += `    <loc>${baseUrl}/</loc>\n`;
    xml += `    <lastmod>${today}</lastmod>\n`;
    xml += `    <changefreq>daily</changefreq>\n`;
    xml += `    <priority>1.0</priority>\n`;
    xml += `  </url>\n`;

    // Ensure routes is an array and reverse it to prioritize the latest added events
    const validRoutes = Array.isArray(routes) ? routes : [];
    // We assume the newest routes are appended to the end, therefore we reverse
    const reversedRoutes = [...validRoutes].reverse();

    reversedRoutes.forEach((route, index) => {
        // Only output valid route paths
        if (!route || !route.path) return;

        const path = escapeXml(route.path);
        // Top 3 events get higher priority and current date
        const isTop3 = index < 3;
        const priority = isTop3 ? '0.9' : '0.6';
        const changefreq = isTop3 ? 'weekly' : 'monthly';
        const lastmod = isTop3 ? `<lastmod>${today}</lastmod>\n` : '';

        // Use the /?preset= URL as the canonical URL since /path just redirects there
        xml += `  <url>\n`;
        xml += `    <loc>${baseUrl}/?preset=${path}</loc>\n`;
        if (lastmod) xml += `    ${lastmod}`;
        xml += `    <changefreq>${changefreq}</changefreq>\n`;
        xml += `    <priority>${priority}</priority>\n`;
        xml += `  </url>\n`;
    });

    xml += `</urlset>`;
    return xml;
}

export default async function handler(req) {
    try {
        const routes = await getRoutes();

        const sitemapXml = generateSitemapXml(routes || []);

        return new Response(sitemapXml, {
            status: 200,
            headers: {
                'Content-Type': 'text/xml; charset=utf-8',
                'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
            },
        });
    } catch (error) {
        console.error('Error generating sitemap:', error);

        // Fallback minimal valid sitemap if connection fails
        const minimalValidSitemap = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://jumper.robostem.org/</loc></url></urlset>`;

        return new Response(minimalValidSitemap, {
            status: 500, // Returning 500 but still returning XML avoids completely breaking some parsers
            headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        });
    }
}
