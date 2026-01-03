import { headerData } from '../data/headerData';

/**
 * WordPress Header Component
 * Displays static navigation from headerData.js
 * 
 * Header versions are managed via Admin page.
 * DO NOT MODIFY - Use Admin > Header Management to update.
 */
export default function WordPressHeader() {
    const { logoUrl, navLinks } = headerData;

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
                        className="h-12 w-auto"
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
