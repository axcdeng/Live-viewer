// BoxCast broadcast fetching and resolution for the Worlds page.
//
// Primary flow:
//   1. fetchChannelBroadcasts(channelId, year) → raw broadcast list
//   2. groupBroadcasts(broadcasts, divisionNames) → keyed by "DivName-DayN"
//   3. resolveBroadcast(grouped, divName, dayIndex, overrides) → single broadcast

const BOXCAST_API = 'https://api.boxcast.com';
const DEV_BOXCAST_PROXY = '/__boxcast';

export async function fetchChannelBroadcasts(channelId, year) {
    const params = new URLSearchParams({ channelId });
    if (year) params.set('year', year);

    const requestPath = `/channels/${channelId}/broadcasts?l=100`;
    const urlsToTry = [];

    if (import.meta.env.DEV) {
        urlsToTry.push(`${DEV_BOXCAST_PROXY}${requestPath}`);
    }

    const proxyUrl = getBroadcastProxyUrl(params);
    if (proxyUrl) {
        urlsToTry.push(proxyUrl);
    }

    urlsToTry.push(`${BOXCAST_API}${requestPath}`);

    let lastError = null;

    for (const url of [...new Set(urlsToTry)]) {
        try {
            let data = await fetchJson(url);
            if (year) data = data.filter((bc) => bc.starts_at?.startsWith(year));
            return data;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error('Failed to fetch BoxCast broadcasts');
}

// ---------------------------------------------------------------------------
// Grouping
//
// For each broadcast we:
//   1. Find which division it belongs to (title contains division name)
//   2. Extract the calendar date from starts_at
//   3. Group by division + date
//   4. Sort dates per division → assign sequential dayIndex (0-based)
//   5. Within each date group pick the longest-duration broadcast
//
// Result key format: "DivisionName-DayN"  (e.g. "Math-Day0")
// ---------------------------------------------------------------------------
export function groupBroadcasts(broadcasts, divisionNames) {
    // { divName → { dateStr → broadcast[] } }
    const byDivDate = {};

    for (const bc of broadcasts) {
        if (!bc.starts_at) continue;

        const divName = matchDivisionName(bc.name, divisionNames);
        if (!divName) continue;

        // Use the first 10 chars of starts_at as the date key.
        // Works for both "2025-04-25T08:00:00-05:00" and "2025-04-25T13:00:00Z".
        const dateStr = bc.starts_at.substring(0, 10);

        if (!byDivDate[divName]) byDivDate[divName] = {};
        if (!byDivDate[divName][dateStr]) byDivDate[divName][dateStr] = [];
        byDivDate[divName][dateStr].push(bc);
    }

    const result = {};

    for (const [divName, dateGroups] of Object.entries(byDivDate)) {
        const sortedDates = Object.keys(dateGroups).sort();

        sortedDates.forEach((dateStr, dayIdx) => {
            const bcs = dateGroups[dateStr];
            const longest = pickLongest(bcs);
            if (longest) {
                result[`${divName}-Day${dayIdx}`] = longest;
            }
        });
    }

    return result;
}

// ---------------------------------------------------------------------------
// Resolution
//
// Returns the broadcast object for the given division+day, checking the
// override map first. If an override entry is a string (broadcast ID rather
// than a full object), wraps it so callers always get a consistent shape.
// ---------------------------------------------------------------------------
export function resolveBroadcast(grouped, divisionName, dayIndex, broadcastOverrides = {}) {
    const key = `${divisionName}-Day${dayIndex}`;

    const overrideVal = broadcastOverrides[key];
    if (overrideVal) {
        if (typeof overrideVal === 'string') {
            return { id: overrideVal, starts_at: null, _isOverride: true };
        }
        return overrideVal;
    }

    return grouped[key] ?? null;
}

// ---------------------------------------------------------------------------
// Playlist fetch (for native HLS playback)
//
// Calls BoxCast /broadcasts/{id}/view and returns the signed m3u8 playlist
// URL along with status ("live", "recorded", "pregame", etc).
// ---------------------------------------------------------------------------
export async function fetchBroadcastPlaylist(broadcastId, channelId) {
    const params = new URLSearchParams({
        channel_id: channelId,
        host: 'jumper.robostem.org',
        extended: 'true',
    });

    const requestPath = `/broadcasts/${broadcastId}/view?${params}`;
    const urlsToTry = [];

    if (import.meta.env.DEV) {
        urlsToTry.push(`${DEV_BOXCAST_PROXY}${requestPath}`);
    }

    urlsToTry.push(`${BOXCAST_API}${requestPath}`);

    let lastError = null;

    for (const url of urlsToTry) {
        try {
            return await fetchJson(url);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError ?? new Error('Failed to fetch BoxCast stream');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function matchDivisionName(title, divisionNames) {
    const lower = title.toLowerCase();
    for (const name of divisionNames) {
        if (lower.includes(name.toLowerCase())) return name;
    }
    return null;
}

function pickLongest(broadcasts) {
    return broadcasts.reduce((best, bc) => {
        if (!best) return bc;
        const dur = durationMs(bc);
        const bestDur = durationMs(best);
        return dur > bestDur ? bc : best;
    }, null);
}

function durationMs(bc) {
    if (!bc.starts_at || !bc.stops_at) return 0;
    return new Date(bc.stops_at) - new Date(bc.starts_at);
}

async function fetchJson(url) {
    const res = await fetch(url, {
        headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
        throw new Error(`BoxCast API returned ${res.status}`);
    }

    const data = await res.json();
    return Array.isArray(data) ? data : data.data ?? data;
}

function getBroadcastProxyUrl(params) {
    if (!import.meta.env.DEV) {
        return `/api/worlds-broadcasts?${params}`;
    }

    if (typeof window !== 'undefined' && window.location.port === '3000') {
        return `/api/worlds-broadcasts?${params}`;
    }

    return null;
}
