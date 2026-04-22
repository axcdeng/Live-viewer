import { useEffect, useState } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

const APP_STORE_URL = 'https://apps.apple.com/us/app/streamhop-vex-match-jumper/id6759777314';
const BANNER_SEEN_STORAGE_KEY = 'vex-jumper-mobile-cta-seen-v1';

function hasSeenBanner() {
    if (typeof window === 'undefined') return true;

    try {
        return window.localStorage.getItem(BANNER_SEEN_STORAGE_KEY) === 'true';
    } catch (error) {
        console.warn('Unable to read CTA banner state from localStorage.', error);
        return false;
    }
}

function markBannerSeen() {
    if (typeof window === 'undefined') return;

    try {
        window.localStorage.setItem(BANNER_SEEN_STORAGE_KEY, 'true');
    } catch (error) {
        console.warn('Unable to persist CTA banner state in localStorage.', error);
    }
}

export default function JumperMobileBanner() {
    const [showBanner, setShowBanner] = useState(() => !hasSeenBanner());

    useEffect(() => {
        if (!showBanner) return;
        markBannerSeen();
    }, [showBanner]);

    const handleDismiss = () => {
        markBannerSeen();
        setShowBanner(false);
    };

    if (!showBanner) return null;

    return (
        <div className="relative bg-gray-900/80 border-b border-gray-800 flex-shrink-0">
            <div className="px-10 py-2.5 flex items-center justify-center">
                <span className="text-sm font-light text-gray-300">
                    <a
                        href={APP_STORE_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={handleDismiss}
                        className="text-[#4FCEEC] hover:underline inline-flex items-center gap-1"
                    >
                        VEX Jumper is on iOS <ArrowUpRight className="w-3.5 h-3.5" />
                    </a>
                    {' '}— no more typing URLs at events. Jump to matches right from your phone.
                </span>
            </div>
            <button
                onClick={handleDismiss}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
                aria-label="Dismiss"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
