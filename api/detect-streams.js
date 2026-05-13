import { kv } from '@vercel/kv';
import * as cheerio from 'cheerio';

/**
 * Stream Detection API
 * 
 * Automatically detects YouTube livestreams for VEX events by:
 * 1. Checking cache first (Vercel KV)
 * 2. Scraping RobotEvents webcast section
 * 3. Searching YouTube API for channel streams
 * 4. Matching streams to divisions
 * 
 * Query params:
 * - sku: Event SKU (e.g., "RE-VRC-24-1234")
 * - eventStart: ISO date string
 * - eventEnd: ISO date string
 * - divisions: JSON string of divisions array (optional)
 * - apiKey: YouTube API key (optional, uses env default)
 */

export const config = {
    runtime: 'nodejs', // Use Node.js runtime for KV support
    maxDuration: 60, // 60 second timeout for reliable scraping
};

// Cache TTL: 1 hour
const CACHE_TTL = 3600;

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { sku, eventStart, eventEnd, divisions: divisionsJson, apiKey } = req.query;

    if (!sku || !eventStart || !eventEnd) {
        return res.status(400).json({
            error: 'Missing required parameters: sku, eventStart, eventEnd'
        });
    }

    const cacheKey = `stream_cache:${sku}`;
    const skipCache = req.query.nocache === 'true' || req.query.nocache === '1';

    try {
        // 1. Check cache first (unless nocache is set)
        if (!skipCache) {
            const cachedData = await kv.get(cacheKey);
            if (cachedData) {
                console.log(`[CACHE HIT] ${sku}`);
                return res.status(200).json({
                    streams: cachedData.streams || [],
                    cached: true,
                    cachedAt: cachedData.cachedAt
                });
            }
        } else {
            console.log(`[CACHE SKIP] nocache parameter set`);
        }

        console.log(`[CACHE MISS] ${sku} - Scraping RobotEvents...`);

        // 2. Parse divisions if provided
        let divisions = [];
        if (divisionsJson) {
            try {
                divisions = JSON.parse(divisionsJson);
            } catch (e) {
                console.error('Failed to parse divisions:', e);
            }
        }

        // 3. Scrape RobotEvents
        const robotEventsUrl = `https://www.robotevents.com/robot-competitions/vex-robotics-competition/${sku}.html`;
        const scrapedLinks = await scrapeRobotEvents(robotEventsUrl);
        console.log(`[SCRAPE] Found ${scrapedLinks.length} links`);

        // 4. Process links
        const directVideos = [];
        const channelLinks = [];

        for (const link of scrapedLinks) {
            const videoId = extractVideoId(link.url);
            if (videoId) {
                directVideos.push({
                    videoId,
                    label: link.label,
                    divisionHint: link.divisionHint
                });
            } else if (isChannelLink(link.url)) {
                channelLinks.push({
                    channelUrl: link.url,
                    channelId: extractChannelId(link.url),
                    label: link.label,
                    divisionHint: link.divisionHint
                });
            }
        }

        console.log(`[PROCESS] ${directVideos.length} direct videos, ${channelLinks.length} channel links`);

        // 5. Search YouTube for channel videos (if needed)
        const youtubeApiKey = apiKey || process.env.YOUTUBE_API_KEY || process.env.VITE_DEFAULT_YOUTUBE_API_KEY;
        let channelVideos = [];

        if (channelLinks.length > 0 && youtubeApiKey) {
            channelVideos = await searchChannelVideos(channelLinks, eventStart, eventEnd, youtubeApiKey);
            console.log(`[YOUTUBE] Found ${channelVideos.length} videos from channels`);
        }

        let allVideos = [...directVideos, ...channelVideos];

        // 6. Combine and normalize streams
        const streams = normalizeStreams(allVideos, eventStart, eventEnd, divisions);

        console.log(`[RESULT] ${streams.length} streams normalized`);

        // 7. Cache and return
        const cacheData = {
            streams,
            cachedAt: new Date().toISOString()
        };

        await kv.set(cacheKey, cacheData, { ex: CACHE_TTL });

        return res.status(200).json({
            streams,
            cached: false
        });

    } catch (error) {
        console.error('[ERROR]', error);
        return res.status(500).json({
            error: 'Failed to detect streams',
            message: error.message,
            streams: []
        });
    }
}

// ===== Helper Functions =====

async function scrapeRobotEvents(url) {
    const links = [];

    try {
        console.log(`[SCRAPE] Fetching ${url} (Parallel Strategies)`);

        // Helper to validate HTML content
        const validateContent = (html, source) => {
            if (!html || html.length < 500) throw new Error(`${source}: Content too short`);
            if (html.includes('id="challenge-running"') || html.includes('Just a moment...')) {
                throw new Error(`${source}: Cloudflare challenge detected`);
            }
            return html;
        };

        // Strategy 1: Googlebot User Agent
        const fetchGooglebot = async () => {
            try {
                const res = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
                        'Referer': 'https://www.google.com/',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    }
                });
                if (!res.ok) throw new Error(`Googlebot failed: ${res.status}`);
                const html = await res.text();
                return validateContent(html, 'Googlebot');
            } catch (e) { throw e; }
        };

        // Strategy 2: Standard User Agent
        const fetchStandard = async () => {
            try {
                const res = await fetch(url, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
                    },
                    signal: AbortSignal.timeout(8000) // 8s timeout for standard
                });
                if (!res.ok) throw new Error(`Standard UA failed: ${res.status}`);
                const html = await res.text();
                return validateContent(html, 'Standard UA');
            } catch (e) { throw e; }
        };

        // Strategy 3: CORS Proxy
        const fetchProxy = async () => {
            try {
                // Add a small delay for proxy to prioritize direct methods first if they are fast
                await new Promise(r => setTimeout(r, 100));
                const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                const res = await fetch(proxyUrl, {
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    },
                    signal: AbortSignal.timeout(15000) // Longer timeout for proxy
                });
                if (!res.ok) throw new Error(`Proxy failed: ${res.status}`);
                const html = await res.text();
                return validateContent(html, 'Proxy');
            } catch (e) { throw e; }
        };

        // Race them! First one to return VALID content wins.
        let html = null;
        try {
            html = await Promise.any([
                fetchGooglebot(),
                fetchStandard(),
                fetchProxy()
            ]);
            console.log(`[SCRAPE] Successful fetch!`);
        } catch (aggregateError) {
            console.error('[SCRAPE] All parallel fetch strategies failed', aggregateError);
            return links;
        }

        const $ = cheerio.load(html);
        const seen = new Set();

        // Strategy 1: Look for explicit links in likely containers
        const selectors = [
            '#webcast a',
            '.tab-content a',
            'div[id*="webcast"] a',
            'a[href*="youtube.com"]',
            'a[href*="youtu.be"]'
        ];

        // Strategy 2: Scan full body text for http links if we're desperate
        // (Regex extraction from full HTML)
        const youtubeRegex = /(https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|live\/|@|channel\/|c\/)|youtu\.be\/)[a-zA-Z0-9_-]+)/g;
        const bodyText = $('body').html() || '';
        const regexMatches = bodyText.match(youtubeRegex) || [];

        for (const matchUrl of regexMatches) {
            if (!seen.has(matchUrl)) {
                seen.add(matchUrl);
                links.push({
                    url: matchUrl,
                    label: 'Extracted from text',
                    divisionHint: null // Hard to determine context from raw regex
                });
                console.log(`[SCRAPE] Found link via regex: ${matchUrl}`);
            }
        }

        for (const selector of selectors) {
            $(selector).each((_, el) => {
                const href = $(el).attr('href');
                if (href && (href.includes('youtube.com') || href.includes('youtu.be'))) {
                    // Start clean URL (remove query params other than v if possible, generally keep it simple)

                    if (!seen.has(href)) {
                        seen.add(href);

                        // Try to extract division info from surrounding text
                        const parentText = $(el).parent().text().toLowerCase();
                        const grandparentText = $(el).parent().parent().text().toLowerCase();
                        const labelText = $(el).text().trim();

                        let divisionHint = null;
                        // Look for division patterns like "Division A", "Div 1", etc.
                        const divMatch = parentText.match(/division\s*([a-z0-9]+)/i) ||
                            grandparentText.match(/division\s*([a-z0-9]+)/i) ||
                            labelText.match(/division\s*([a-z0-9]+)/i);

                        // Also look for "High School" or "Middle School" as division proxies
                        if (!divMatch) {
                            if (parentText.includes('high school') || labelText.match(/hs/i)) divisionHint = "HS";
                            else if (parentText.includes('middle school') || labelText.match(/ms/i)) divisionHint = "MS";
                        }

                        if (divMatch) {
                            divisionHint = divMatch[1].toUpperCase();
                        }

                        console.log(`[SCRAPE] Found link via selector: ${href} (division hint: ${divisionHint})`);

                        // Update or add. If we found via regex before, now we have better context (divisionHint)
                        const existingIdx = links.findIndex(l => l.url === href);
                        if (existingIdx !== -1) {
                            links[existingIdx].divisionHint = divisionHint;
                            links[existingIdx].label = labelText || links[existingIdx].label;
                        } else {
                            links.push({
                                url: href,
                                label: labelText || 'Webcast Link',
                                divisionHint
                            });
                        }
                    }
                }
            });
        }

    } catch (error) {
        console.error('Error scraping RobotEvents:', error);
    }

    return links;
}

function extractVideoId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|live\/|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function isChannelLink(url) {
    if (!url) return false;
    return url.includes('youtube.com/@') ||
        url.includes('youtube.com/channel/') ||
        url.includes('youtube.com/c/');
}

function extractChannelId(url) {
    if (!url) return null;

    // Handle @username format
    const atMatch = url.match(/youtube\.com\/@([^/?]+)/);
    if (atMatch) return `@${atMatch[1]}`;

    // Handle /channel/ID format
    const channelMatch = url.match(/youtube\.com\/channel\/([^/?]+)/);
    if (channelMatch) return channelMatch[1];

    // Handle /c/name format
    const cMatch = url.match(/youtube\.com\/c\/([^/?]+)/);
    if (cMatch) return cMatch[1];

    return null;
}

async function searchChannelVideos(channelLinks, eventStart, eventEnd, apiKey) {
    const videos = [];

    for (const channel of channelLinks) {
        try {
            // First, resolve @username to channel ID if needed
            let channelId = channel.channelId;

            if (channelId.startsWith('@')) {
                // Use search to find the channel
                const searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
                    `part=snippet&type=channel&q=${encodeURIComponent(channelId)}&key=${apiKey}&maxResults=1`;

                const searchRes = await fetch(searchUrl);
                const searchData = await searchRes.json();

                if (searchData.items && searchData.items.length > 0) {
                    channelId = searchData.items[0].id.channelId;
                } else {
                    continue; // Skip if channel not found
                }
            }

            // Search for livestreams from this channel
            const startDate = new Date(eventStart);
            startDate.setDate(startDate.getDate() - 1); // 1 day before
            const publishedAfter = startDate.toISOString();

            const endDate = new Date(eventEnd);
            endDate.setDate(endDate.getDate() + 1); // 1 day after
            const publishedBefore = endDate.toISOString();

            // Perform searches in parallel
            const searchTypes = [
                { type: 'completed', filterDates: true },
                { type: 'live', filterDates: false },
                { type: 'upcoming', filterDates: false }
            ];

            const searchPromises = searchTypes.map(async ({ type, filterDates }) => {
                let url = `https://www.googleapis.com/youtube/v3/search?` +
                    `part=snippet&channelId=${channelId}&type=video&eventType=${type}` +
                    `&maxResults=5&key=${apiKey}`;

                if (filterDates) {
                    url += `&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}`;
                }

                try {
                    const res = await fetch(url);
                    const data = await res.json();
                    return { type, items: data.items || [] };
                } catch (e) {
                    console.error(`Error searching ${type} for ${channelId}:`, e);
                    return { type, items: [] };
                }
            });

            const results = await Promise.all(searchPromises);

            for (const { type, items } of results) {
                for (const item of items) {
                    // Avoid duplicates (if any)
                    if (videos.some(v => v.videoId === item.id.videoId)) continue;

                    videos.push({
                        videoId: item.id.videoId,
                        label: item.snippet.title,
                        publishedAt: item.snippet.publishedAt,
                        divisionHint: channel.divisionHint || extractDivisionFromTitle(item.snippet.title),
                        isLive: type === 'live',
                        isUpcoming: type === 'upcoming'
                    });
                }
            }
        } catch (error) {
            console.error(`Error searching channel ${channel.channelId}:`, error);
        }
    }

    return videos;
}

function extractDivisionFromTitle(title) {
    if (!title) return null;
    const match = title.match(/division\s*([a-z0-9]+)/i) ||
        title.match(/div\s*\.?\s*([a-z0-9]+)/i);
    return match ? match[1].toUpperCase() : null;
}

function normalizeStreams(videos, eventStart, eventEnd, divisions) {
    const streams = [];
    const eventStartDate = new Date(eventStart);
    const eventEndDate = new Date(eventEnd);
    const eventDays = Math.ceil((eventEndDate - eventStartDate) / (1000 * 60 * 60 * 24)) + 1;

    // Group videos by division hint
    const videosByDivision = {};
    const unassigned = [];

    for (const video of videos) {
        if (video.divisionHint) {
            if (!videosByDivision[video.divisionHint]) {
                videosByDivision[video.divisionHint] = [];
            }
            videosByDivision[video.divisionHint].push(video);
        } else {
            unassigned.push(video);
        }
    }

    // Match division hints to actual divisions
    const divisionMapping = {};
    if (divisions.length > 0) {
        for (const div of divisions) {
            const divName = (div.name || '').toUpperCase();
            // Try to match by name similarity
            for (const hint of Object.keys(videosByDivision)) {
                if (divName.includes(hint) || hint.includes(divName.charAt(divName.length - 1))) {
                    divisionMapping[hint] = div.id;
                }
            }
        }
    }

    // Create stream objects
    const usedVideoIds = new Set();

    // Process assigned videos
    for (const [hint, vids] of Object.entries(videosByDivision)) {
        const divisionId = divisionMapping[hint] || (divisions[0]?.id) || 1;

        for (let i = 0; i < vids.length && i < eventDays; i++) {
            const video = vids[i];
            if (usedVideoIds.has(video.videoId)) continue;
            usedVideoIds.add(video.videoId);

            const dayDate = new Date(eventStartDate);
            dayDate.setDate(eventStartDate.getDate() + i);

            streams.push({
                id: `stream-div-${divisionId}-day-${i}`,
                url: `https://www.youtube.com/watch?v=${video.videoId}`,
                videoId: video.videoId,
                streamStartTime: null,
                divisionId,
                dayIndex: i,
                label: eventDays > 1 ? `Day ${i + 1} - ${formatDate(dayDate)}` : 'Livestream',
                date: dayDate.toISOString(),
                source: 'detected',
                originalTitle: video.label
            });
        }
    }

    // Process unassigned videos (assign to first division or default)
    const defaultDivisionId = divisions[0]?.id || 1;
    for (let i = 0; i < unassigned.length && i < eventDays; i++) {
        const video = unassigned[i];
        if (usedVideoIds.has(video.videoId)) continue;
        usedVideoIds.add(video.videoId);

        const dayDate = new Date(eventStartDate);
        dayDate.setDate(eventStartDate.getDate() + i);

        streams.push({
            id: `stream-div-${defaultDivisionId}-day-${i}`,
            url: `https://www.youtube.com/watch?v=${video.videoId}`,
            videoId: video.videoId,
            streamStartTime: null,
            divisionId: defaultDivisionId,
            dayIndex: i,
            label: eventDays > 1 ? `Day ${i + 1} - ${formatDate(dayDate)}` : 'Livestream',
            date: dayDate.toISOString(),
            source: 'detected',
            originalTitle: video.label
        });
    }

    return streams;
}

function formatDate(date) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[date.getMonth()]} ${date.getDate()}`;
}

async function fetchEventDetails(sku, apiKey) {
    try {
        const response = await fetch(`https://events.vex.com/api/v2/events?sku[]=${sku}`, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) return null;

        const data = await response.json();
        return data.data?.[0] || null;
    } catch (e) {
        console.error('Error fetching event details:', e);
        return null;
    }
}

async function searchYoutubeByQuery(query, eventStart, eventEnd, apiKey) {
    const videos = [];
    try {
        // Search for videos within the event window
        const startDate = new Date(eventStart);
        startDate.setDate(startDate.getDate() - 1);
        const publishedAfter = startDate.toISOString();

        const endDate = new Date(eventEnd);
        endDate.setDate(endDate.getDate() + 1);
        const publishedBefore = endDate.toISOString();

        const searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
            `part=snippet&q=${encodeURIComponent(query)}&type=video` +
            `&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}` +
            `&maxResults=5&key=${apiKey}`;

        const res = await fetch(searchUrl);
        const data = await res.json();

        if (data.items) {
            for (const item of data.items) {
                // Filter out irrelevant results if possible (simple heuristic)
                if (item.snippet.title.toLowerCase().includes('live') ||
                    item.snippet.title.toLowerCase().includes('stream') ||
                    item.snippet.title.toLowerCase().includes('day') ||
                    item.snippet.title.toLowerCase().match(/v\drc/i)) {

                    videos.push({
                        videoId: item.id.videoId,
                        label: item.snippet.title,
                        publishedAt: item.snippet.publishedAt,
                        divisionHint: extractDivisionFromTitle(item.snippet.title),
                        isFallback: true
                    });
                }
            }
        }
    } catch (error) {
        console.error('Error searching YouTube by query:', error);
    }
    return videos;
}
