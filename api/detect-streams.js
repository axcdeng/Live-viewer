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
    runtime: 'nodejs20.x', // Use Node.js runtime for KV support
    maxDuration: 10, // 10 second timeout
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

    try {
        // 1. Check cache first
        const cachedData = await kv.get(cacheKey);
        if (cachedData) {
            console.log(`[CACHE HIT] ${sku}`);
            return res.status(200).json({
                streams: cachedData.streams || [],
                cached: true,
                cachedAt: cachedData.cachedAt
            });
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

        // 6. Combine and normalize streams
        const allVideos = [...directVideos, ...channelVideos];
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
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; VEXStreamBot/1.0)'
            }
        });

        if (!response.ok) {
            console.error(`RobotEvents returned ${response.status}`);
            return links;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // Look for webcast links in various places
        const selectors = [
            '#webcast a',
            '.tab-content a[href*="youtube"]',
            '.tab-content a[href*="youtu.be"]',
            'a[href*="youtube.com/live"]',
            'a[href*="youtube.com/watch"]',
            'a[href*="youtube.com/@"]',
            'a[href*="youtube.com/channel"]',
            'a[href*="youtube.com/c/"]'
        ];

        const seen = new Set();

        for (const selector of selectors) {
            $(selector).each((_, el) => {
                const href = $(el).attr('href');
                if (href && !seen.has(href)) {
                    seen.add(href);

                    // Try to extract division info from surrounding text
                    const parentText = $(el).parent().text().toLowerCase();
                    const labelText = $(el).text().trim();

                    let divisionHint = null;
                    // Look for division patterns like "Division A", "Div 1", etc.
                    const divMatch = parentText.match(/division\s*([a-z0-9]+)/i) ||
                        labelText.match(/division\s*([a-z0-9]+)/i);
                    if (divMatch) {
                        divisionHint = divMatch[1].toUpperCase();
                    }

                    links.push({
                        url: href,
                        label: labelText,
                        divisionHint
                    });
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

            // Search for completed livestreams
            const searchUrl = `https://www.googleapis.com/youtube/v3/search?` +
                `part=snippet&channelId=${channelId}&type=video&eventType=completed` +
                `&publishedAfter=${publishedAfter}&publishedBefore=${publishedBefore}` +
                `&maxResults=10&key=${apiKey}`;

            const res = await fetch(searchUrl);
            const data = await res.json();

            if (data.items) {
                for (const item of data.items) {
                    videos.push({
                        videoId: item.id.videoId,
                        label: item.snippet.title,
                        publishedAt: item.snippet.publishedAt,
                        divisionHint: channel.divisionHint || extractDivisionFromTitle(item.snippet.title)
                    });
                }
            }

            // Also search for live streams currently happening
            const liveUrl = `https://www.googleapis.com/youtube/v3/search?` +
                `part=snippet&channelId=${channelId}&type=video&eventType=live` +
                `&maxResults=5&key=${apiKey}`;

            const liveRes = await fetch(liveUrl);
            const liveData = await liveRes.json();

            if (liveData.items) {
                for (const item of liveData.items) {
                    videos.push({
                        videoId: item.id.videoId,
                        label: item.snippet.title,
                        publishedAt: item.snippet.publishedAt,
                        divisionHint: channel.divisionHint || extractDivisionFromTitle(item.snippet.title),
                        isLive: true
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
