import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { headerData } from '../data/headerData';

/**
 * WordPress Header Component
 * Displays navigation with dropdown menu support
 */
export default function WordPressHeader() {
    const { logoUrl, navLinks } = headerData;
    const [openDropdown, setOpenDropdown] = useState(null);
    const location = useLocation();

    return (
        <nav className="w-full px-4 sm:px-8 py-2 flex items-center justify-between">
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
                        className="h-10 w-auto"
                    />
                ) : (
                    <span className="text-lg font-bold text-white">robostem</span>
                )}
            </a>

            {/* Navigation Links */}
            <nav className="hidden md:flex items-center gap-6">
                <Link
                    to="/worlds"
                    className={`px-4 py-2 rounded-lg font-medium transition-all border text-sm ${
                        location.pathname === '/worlds'
                            ? 'bg-[#4FCEEC] text-black border-[#4FCEEC]'
                            : 'bg-[#4FCEEC]/10 hover:bg-[#4FCEEC]/20 text-[#4FCEEC] border-[#4FCEEC]/30'
                    }`}
                >
                    Worlds
                </Link>
                {navLinks.map((link, index) => {
                    const isContactLink = link.text.includes('Contact') || link.text.includes('Join');
                    const hasChildren = link.children && link.children.length > 0;

                    // Contact/CTA Button
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

                    // Dropdown Menu
                    if (hasChildren) {
                        return (
                            <div
                                key={index}
                                className="relative"
                                onMouseEnter={() => setOpenDropdown(index)}
                                onMouseLeave={() => setOpenDropdown(null)}
                            >
                                <button className="flex items-center gap-1 text-white hover:text-[#4FCEEC] font-medium transition-colors text-sm">
                                    {link.text}
                                    <ChevronDown className={`w-4 h-4 transition-transform ${openDropdown === index ? 'rotate-180' : ''}`} />
                                </button>

                                {openDropdown === index && (
                                    <div className="absolute top-full left-0 pt-2 z-50">
                                        <div className="py-2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl min-w-[140px]">
                                            {link.children.map((child, childIndex) => (
                                                <a
                                                    key={childIndex}
                                                    href={child.href}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="block px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-800 transition-colors"
                                                >
                                                    {child.text}
                                                </a>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Regular Link
                    return (
                        <a
                            key={index}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-white hover:text-[#4FCEEC] font-medium transition-colors text-sm"
                        >
                            {link.text}
                        </a>
                    );
                })}
            </nav>
        </nav>
    );
}
