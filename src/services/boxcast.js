// BoxCast broadcast fetching and resolution for the Worlds page.
//
// Primary flow:
//   1. fetchChannelBroadcasts(channelId, year) → raw broadcast list
//   2. groupBroadcasts(broadcasts, divisionNames) → keyed by "DivName-DayN"
//   3. resolveBroadcast(grouped, divName, dayIndex, overrides) → single broadcast

const API_BASE = import.meta.env.DEV ? 'http://localhost:3000' : '';
const BOXCAST_API = 'https://api.boxcast.com';

export async function fetchChannelBroadcasts(channelId, year) {
    const params = new URLSearchParams({ channelId });
    if (year) params.set('year', year);

    // 1. Try the Vercel proxy (production + vercel dev)
    try {
        const res = await fetch(`${API_BASE}/api/worlds-broadcasts?${params}`);
        if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];
        }
    } catch (_) { /* proxy not running – fall through */ }

    // 2. Direct BoxCast API (works in plain vite dev if BoxCast allows CORS)
    const bcRes = await fetch(
        `${BOXCAST_API}/channels/${channelId}/broadcasts?l=100`,
        { headers: { Accept: 'application/json' } }
    );
    if (!bcRes.ok) throw new Error(`BoxCast API returned ${bcRes.status}`);

    let data = await bcRes.json();
    if (!Array.isArray(data)) data = data.data ?? [];
    if (year) data = data.filter((bc) => bc.starts_at?.startsWith(year));
    return data;
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
    const res = await fetch(
        `${BOXCAST_API}/broadcasts/${broadcastId}/view?${params}`,
        { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) throw new Error(`BoxCast view API returned ${res.status}`);
    return await res.json(); // { status, playlist, progress, settings, ... }
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
