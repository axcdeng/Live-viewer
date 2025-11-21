// Event cache service for storing webcast selections and history

const CACHE_KEY = 'vex_match_jumper_event_cache';
const HISTORY_KEY = 'vex_match_jumper_history';

const getCache = () => {
    try {
        const cache = localStorage.getItem(CACHE_KEY);
        return cache ? JSON.parse(cache) : {};
    } catch (error) {
        console.error('Error reading cache:', error);
        return {};
    }
};

const saveCache = (cache) => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch (error) {
        console.error('Error saving cache:', error);
    }
};

const getHistory = () => {
    try {
        const history = localStorage.getItem(HISTORY_KEY);
        return history ? JSON.parse(history) : [];
    } catch (error) {
        console.error('Error reading history:', error);
        return [];
    }
};

const saveHistory = (history) => {
    try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
        console.error('Error saving history:', error);
    }
};

export const getCachedWebcast = (eventId) => {
    const cache = getCache();
    return cache[eventId] || null;
};

export const setCachedWebcast = (eventId, videoId, url, method = 'user-selected') => {
    const cache = getCache();
    const timestamp = new Date().toISOString();

    const entry = {
        videoId,
        url,
        selectedAt: timestamp,
        method,
        history: cache[eventId]?.history || []
    };

    // Add to history
    entry.history.push({
        timestamp,
        action: 'selected',
        videoId,
        url,
        method
    });

    cache[eventId] = entry;
    saveCache(cache);
    return entry;
};

// Save complete event with streams
export const saveEventToHistory = (event, streams) => {
    const history = getHistory();
    const timestamp = new Date().toISOString();

    // Check if event already exists
    const existingIndex = history.findIndex(item => item.eventId === event.id);

    const entry = {
        eventId: event.id,
        eventName: event.name,
        eventStart: event.start,
        eventEnd: event.end,
        eventSku: event.sku,
        eventProgram: event.program,
        streams: streams.map(s => ({
            label: s.label,
            url: s.url,
            videoId: s.videoId,
            dayIndex: s.dayIndex,
            streamStartTime: s.streamStartTime
        })),
        lastAccessed: timestamp,
        firstAccessed: existingIndex >= 0 ? history[existingIndex].firstAccessed : timestamp
    };

    if (existingIndex >= 0) {
        history[existingIndex] = entry;
    } else {
        history.unshift(entry); // Add to beginning
    }

    // Keep only last 20 events
    if (history.length > 20) {
        history.splice(20);
    }

    saveHistory(history);
    return entry;
};

export const getEventHistory = (eventId) => {
    const cache = getCache();
    return cache[eventId] || null;
};

export const getAllHistory = () => {
    return getHistory();
};

export const deleteHistoryEntry = (eventId) => {
    const history = getHistory();
    const filtered = history.filter(item => item.eventId !== eventId);
    saveHistory(filtered);
};

export const clearAllHistory = () => {
    saveHistory([]);
};

export const addEventHistoryEntry = (eventId, action, metadata) => {
    const cache = getCache();
    const timestamp = new Date().toISOString();

    if (!cache[eventId]) {
        cache[eventId] = {
            history: []
        };
    }

    cache[eventId].history.push({
        timestamp,
        action,
        ...metadata
    });

    saveCache(cache);
};

export const clearEventCache = (eventId) => {
    const cache = getCache();
    delete cache[eventId];
    saveCache(cache);
};

export const exportCache = () => {
    return JSON.stringify(getCache(), null, 2);
};

export const importCache = (jsonString) => {
    try {
        const imported = JSON.parse(jsonString);
        saveCache(imported);
        return true;
    } catch (error) {
        console.error('Error importing cache:', error);
        return false;
    }
};
