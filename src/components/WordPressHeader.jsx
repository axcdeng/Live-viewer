import { useEffect, useState } from 'react';

/**
 * WordPress Header Component for React
 * Fetches navigation links from robostem.org and displays them in a clean header
 */
export default function WordPressHeader() {
    const [navLinks, setNavLinks] = useState([]);
    const [logoUrl, setLogoUrl] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetchWordPressNav();
    }, []);

    const fetchWordPressNav = async () => {
        try {
            setLoading(true);

            // Use CORS proxy to avoid CORS issues
            const corsProxy = 'https://api.allorigins.win/raw?url=';
            const targetUrl = encodeURIComponent('https://robostem.org');

            const response = await fetch(`${corsProxy}${targetUrl}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch: ${response.status}`);
            }

            const html = await response.text();

            // Parse the HTML to extract navigation links
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // Extract logo
            const logoImg = doc.querySelector('header img, .logo img, nav img');
            if (logoImg) {
                let logoSrc = logoImg.getAttribute('src');
                // Convert relative URL to absolute
                if (logoSrc && logoSrc.startsWith('/')) {
                    logoSrc = `https://robostem.org${logoSrc}`;
                }
                console.log('Extracted logo URL:', logoSrc);
                setLogoUrl(logoSrc);
            }

            // Extract navigation links - try multiple selectors
            const links = [];

            // Try to find nav menu items
            const navItems = doc.querySelectorAll('nav a, header a, .menu a');
            navItems.forEach(link => {
                const text = link.textContent.trim();
                const href = link.getAttribute('href');

                // Filter out only the main navigation links
                if (text && href &&
                    (text.toUpperCase() === 'HOW' ||
                        text.toUpperCase() === 'WHAT' ||
                        text.toUpperCase() === 'WHO' ||
                        text.includes('Contact') ||
                        text.includes('Join'))) {

                    // Convert relative URLs to absolute
                    let absoluteHref = href;
                    if (href.startsWith('/')) {
                        absoluteHref = `https://robostem.org${href}`;
                    } else if (href.startsWith('#')) {
                        absoluteHref = `https://robostem.org${href}`;
                    }

                    links.push({ text, href: absoluteHref });
                }
            });

            // Deduplicate links by text
            const uniqueLinks = [];
            const seen = new Set();
            links.forEach(link => {
                if (!seen.has(link.text)) {
                    seen.add(link.text);
                    uniqueLinks.push(link);
                }
            });

            console.log('Extracted navigation links:', uniqueLinks);
            setNavLinks(uniqueLinks);

        } catch (err) {
            console.error('Error fetching WordPress navigation:', err);
            // Fallback to hardcoded links if fetch fails
            setNavLinks([
                { text: 'HOW', href: 'https://robostem.org/#how' },
                { text: 'WHAT', href: 'https://robostem.org/#what' },
                { text: 'WHO', href: 'https://robostem.org/#who' },
                { text: 'Join Us / Contact', href: 'https://robostem.org/contact/' }
            ]);
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return (
            <div className="w-full h-16 flex items-center justify-center">
                <div className="text-gray-400 text-sm">Loading...</div>
            </div>
        );
    }

    return (
        <nav className="w-full px-4 sm:px-8 py-4 flex items-center justify-between">
            {/* Logo */}
            <a
                href="https://robostem.org"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center hover:opacity-80 transition-opacity"
            >
                {logoUrl ? (
                    <img
                        src={logoUrl}
                        alt="robostem"
                        className="h-8 w-auto"
                    />
                ) : (
                    <span className="text-lg font-bold text-white">robostem</span>
                )}
            </a>

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-8">
                {navLinks.map((link, index) => {
                    // Style the last link (Contact) as a button
                    const isContactLink = link.text.includes('Contact') || link.text.includes('Join');

                    if (isContactLink) {
                        return (
                            <a
                                key={index}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg font-medium transition-all border border-white/20"
                            >
                                {link.text}
                            </a>
                        );
                    }

                    return (
                        <a
                            key={index}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:text-[#4FCEEC] font-medium transition-colors uppercase text-sm tracking-wide"
                        >
                            {link.text}
                        </a>
                    );
                })}
            </nav>
        </nav>
    );
}
