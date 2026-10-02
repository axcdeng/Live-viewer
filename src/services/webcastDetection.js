// Webcast detection service - finds and classifies webcast URLs

export const extractUrlsFromText = (text) => {
    if (!text) return [];

    // Regex to match URLs
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const matches = text.match(urlRegex) || [];

    return [...new Set(matches)]; // Remove duplicates
};

export const classifyUrl = (url) => {
    const lower = url.toLowerCase();

    // Direct video (watch, embed, youtu.be)
    if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/') || lower.includes('youtube.com/embed/')) {
        return {
            type: 'direct-video',
            platform: 'youtube',
            url
        };
    }

    // YouTube channel
    if (lower.includes('youtube.com/channel/') || lower.includes('youtube.com/@') || lower.includes('youtube.com/c/')) {
        return {
            type: 'channel',
            platform: 'youtube',
            url
        };
    }

    // YouTube playlist
    if (lower.includes('youtube.com/playlist')) {
        return {
            type: 'playlist',
            platform: 'youtube',
            url
        };
    }

    // Twitch
    if (lower.includes('twitch.tv')) {
        if (lower.includes('/videos/')) {
            return { type: 'direct-video', platform: 'twitch', url };
        }
        return { type: 'channel', platform: 'twitch', url };
    }

    // Other video platforms
    if (lower.includes('vimeo.com') || lower.includes('dailymotion.com')) {
        return { type: 'direct-video', platform: 'other', url };
    }

    // Generic/unknown
    return { type: 'other', platform: 'unknown', url };
};

export const findWebcastCandidates = async (event) => {
    const candidates = [];

    // 1. Check API webcast field (if it exists)
    // Note: RobotEvents API doesn't always have this field structured
    // We'll check common field names
    if (event.webcast) {
        candidates.push({
            ...classifyUrl(event.webcast),
            source: 'api-webcast-field',
            priority: 1
        });
    }

    // 2. Scan event description for URLs
    const description = event.description || '';
    const urlsInDescription = extractUrlsFromText(description);

    // Check if URLs are in a "webcast" section
    const webcastSectionRegex = /webcast[:\s]*([^\n]*)/gi;
    const webcastMatches = description.match(webcastSectionRegex);

    let webcastUrls = [];
    if (webcastMatches) {
        webcastMatches.forEach(match => {
            const urls = extractUrlsFromText(match);
            webcastUrls.push(...urls);
        });
    }

    // Add webcast section URLs with higher priority
    webcastUrls.forEach(url => {
        candidates.push({
            ...classifyUrl(url),
            source: 'description-webcast-section',
            priority: 2
        });
    });

    // Add other URLs from description with lower priority
    urlsInDescription.forEach(url => {
        if (!webcastUrls.includes(url)) {
            const classified = classifyUrl(url);
            // Skip obvious non-stream URLs
            if (!url.toLowerCase().includes('robotevents.com') &&
                !url.toLowerCase().includes('events.vex.com') &&
                !url.toLowerCase().includes('vexrobotics.com')) {
                candidates.push({
                    ...classified,
                    source: 'description-general',
                    priority: 3
                });
            }
        }
    });

    // Sort by priority (lower number = higher priority)
    candidates.sort((a, b) => a.priority - b.priority);

    // Remove duplicates
    const seen = new Set();
    return candidates.filter(c => {
        if (seen.has(c.url)) return false;
        seen.add(c.url);
        return true;
    });
};

export const isProbablyLivestream = (url) => {
    const classified = classifyUrl(url);
    return classified.type === 'direct-video' || classified.type === 'channel';
};
