import axios from 'axios';

const VIMEO_API_KEY = '716d01097ca63f108af49315abd26395';

/**
 * Extract Vimeo video ID from various URL formats
 * @param {string} url - Vimeo URL
 * @returns {string|null} Video ID or event ID
 */
export const extractVimeoId = (url) => {
    if (!url) return null;

    // Direct video: vimeo.com/123456789
    const directMatch = url.match(/vimeo\.com\/(\d+)/);
    if (directMatch && !url.includes('/event/')) {
        return directMatch[1];
    }

    // Event: vimeo.com/event/123456
    const eventMatch = url.match(/vimeo\.com\/event\/(\d+)/);
    if (eventMatch) {
        return eventMatch[1];
    }

    // Player embed: player.vimeo.com/video/123456789
    const embedMatch = url.match(/player\.vimeo\.com\/video\/(\d+)/);
    if (embedMatch) {
        return embedMatch[1];
    }

    return null;
};

/**
 * Check if URL is a Vimeo event page
 * @param {string} url - URL to check
 * @returns {boolean}
 */
export const isVimeoEvent = (url) => {
    return url && url.includes('vimeo.com/event/');
};

/**
 * Fetch metadata for a Vimeo video
 * Returns start time calculated from created_time (END) - duration
 * @param {string} videoId - Vimeo video ID
 * @returns {Promise<Object>} { startTime, duration, name, createdTime }
 */
export const getVimeoVideoMetadata = async (videoId) => {
    try {
        console.log('[Vimeo] Fetching metadata for video:', videoId);

        const response = await axios.get(`https://api.vimeo.com/videos/${videoId}`, {
            headers: {
                'Authorization': `Bearer ${VIMEO_API_KEY}`,
                'Accept': 'application/vnd.vimeo.*+json;version=3.4'
            }
        });

        const video = response.data;

        // created_time is the END time of the video
        const createdTime = new Date(video.created_time);
        const durationSeconds = video.duration;

        // Calculate start time: END - duration
        const startTime = new Date(createdTime.getTime() - (durationSeconds * 1000));

        console.log('[Vimeo] Video metadata:', {
            name: video.name,
            createdTime: createdTime.toISOString(),
            duration: durationSeconds,
            calculatedStartTime: startTime.toISOString()
        });

        return {
            startTime: startTime.getTime(), // Return as epoch ms
            duration: durationSeconds,
            name: video.name,
            createdTime: createdTime.getTime()
        };
    } catch (error) {
        console.error('[Vimeo] Error fetching video metadata:', error.message);
        if (error.response?.status === 404) {
            throw new Error('Video not found');
        }
        throw error;
    }
};

/**
 * Parse Vimeo event page HTML to extract video IDs
 * @param {string} eventId - Vimeo event ID
 * @returns {Promise<Array<string>>} Array of video IDs
 */
export const parseVimeoEventPage = async (eventId) => {
    try {
        console.log('[Vimeo Event] Fetching HTML for event:', eventId);

        const eventUrl = `https://vimeo.com/event/${eventId}`;

        // Try CORS proxy
        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(eventUrl)}`;
        const response = await axios.get(proxyUrl, { timeout: 10000 });

        const html = response.data;
        console.log('[Vimeo Event] HTML fetched, length:', html.length);

        // Extract video IDs from player.vimeo.com/video/* patterns
        const videoIds = new Set();

        // Method 1: iframe src with player.vimeo.com/video/ID
        const iframeRegex = /player\.vimeo\.com\/video\/(\d+)/g;
        let match;
        while ((match = iframeRegex.exec(html)) !== null) {
            videoIds.add(match[1]);
            console.log('[Vimeo Event] Found video ID in iframe:', match[1]);
        }

        // Method 2: data-video-id attributes
        const dataAttrRegex = /data-video-id="(\d+)"/g;
        while ((match = dataAttrRegex.exec(html)) !== null) {
            videoIds.add(match[1]);
            console.log('[Vimeo Event] Found video ID in data attribute:', match[1]);
        }

        // Method 3: vimeo.com/XXXXX links (excluding the event ID itself)
        const linkRegex = /vimeo\.com\/(\d{8,})/g;
        while ((match = linkRegex.exec(html)) !== null) {
            if (match[1] !== eventId) { // Don't include the event ID itself
                videoIds.add(match[1]);
                console.log('[Vimeo Event] Found video ID in link:', match[1]);
            }
        }

        const uniqueIds = Array.from(videoIds);
        console.log(`[Vimeo Event] Total unique video IDs found: ${uniqueIds.length}`, uniqueIds);

        return uniqueIds;
    } catch (error) {
        console.error('[Vimeo Event] Error fetching event page:', error.message);
        return [];
    }
};

/**
 * Parse a Vimeo event and return sorted streams with metadata
 * @param {string} eventId - Vimeo event ID
 * @param {number} eventDays - Number of days in the event
 * @param {Date} eventStartDate - Event start date
 * @returns {Promise<Array>} Array of stream objects sorted by start time
 */
export const parseVimeoEvent = async (eventId, eventDays, eventStartDate) => {
    console.log('[Vimeo Event] Parsing event:', eventId);

    // Get all video IDs from event page
    const videoIds = await parseVimeoEventPage(eventId);

    if (videoIds.length === 0) {
        console.warn('[Vimeo Event] No videos found in event');
        return null;
    }

    // Fetch metadata for each video
    console.log('[Vimeo Event] Fetching metadata for', videoIds.length, 'videos...');
    const metadataPromises = videoIds.map(id =>
        getVimeoVideoMetadata(id).catch(err => {
            console.error(`[Vimeo Event] Failed to fetch metadata for ${id}:`, err.message);
            return null;
        })
    );

    const metadataResults = await Promise.all(metadataPromises);

    // Filter out failed requests and pair with video IDs
    const videos = videoIds
        .map((id, index) => ({ id, metadata: metadataResults[index] }))
        .filter(v => v.metadata !== null);

    console.log('[Vimeo Event] Successfully fetched metadata for', videos.length, 'videos');

    // Sort by start time (earliest first = Day 1)
    videos.sort((a, b) => a.metadata.startTime - b.metadata.startTime);

    console.log('[Vimeo Event] Videos sorted by start time:',
        videos.map(v => ({
            id: v.id,
            startTime: new Date(v.metadata.startTime).toISOString()
        }))
    );

    // Convert to stream objects
    const streams = videos.slice(0, eventDays).map((video, index) => {
        const dayDate = new Date(eventStartDate);
        dayDate.setDate(dayDate.getDate() + index);
        const dateLabel = dayDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        return {
            url: `https://player.vimeo.com/video/${video.id}`,
            videoId: video.id,
            platform: 'vimeo',
            streamStartTime: video.metadata.startTime,
            dayIndex: index,
            label: eventDays > 1 ? `Day ${index + 1} - ${dateLabel}` : 'Livestream',
            name: video.metadata.name
        };
    });

    console.log('[Vimeo Event] Auto-assigned streams to days:', streams);

    return streams;
};
