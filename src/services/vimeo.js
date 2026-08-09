// Vimeo event playback, without the Vimeo API.
//
// The paid API is out of reach, so everything here rides on public surfaces:
// the event embed URL, the free Player SDK (postMessage — no key), and
// /api/vimeo-clip, which scrapes the embed page for the current clip id.
//
// A Vimeo *event* is a recurring live channel; each broadcast session becomes a
// separate *clip* in its playlist. `?video=<clipId>` pins the embed to one
// session, which is how a past day keeps playing after the next day goes live.

const SDK_SRC = 'https://player.vimeo.com/api/player.js';

/**
 * Embed URL for one clip.
 *
 * Prefer the clip's own player URL: `player.vimeo.com/video/<id>?h=<hash>` is the
 * only form that actually pins a specific recording. The event embed looks like
 * it should — it takes a `?video=` parameter — but Vimeo silently ignores it and
 * always serves whichever clip the event is currently featuring, so the moment a
 * second broadcast starts, every earlier day would play the wrong footage.
 *
 * Without a hash there is nothing to pin with, so fall back to the event embed:
 * correct while that clip is the featured one, which is the case for a day being
 * broadcast right now.
 */
export const vimeoEmbedUrl = (eventId, videoId = null, { autoplay = false, hash = null } = {}) => {
    if (videoId && hash) {
        const params = new URLSearchParams({ h: String(hash) });
        if (autoplay) params.set('autoplay', '1');
        return `https://player.vimeo.com/video/${videoId}?${params}`;
    }

    if (!eventId) return null;
    const params = new URLSearchParams();
    if (videoId) params.set('video', String(videoId));
    if (autoplay) params.set('autoplay', '1');
    const query = params.toString();
    return `https://vimeo.com/event/${eventId}/embed${query ? `?${query}` : ''}`;
};

/** Public watch page — what the "Open in Vimeo" link points at. */
export const vimeoWatchUrl = (eventId, videoId = null) => {
    if (!eventId) return null;
    return videoId
        ? `https://vimeo.com/event/${eventId}/video/${videoId}`
        : `https://vimeo.com/event/${eventId}`;
};

/**
 * Pull a Vimeo event id (and clip id, when present) out of anything the admin
 * might paste: a bare id, an event URL, an embed URL, or a /video/ deep link.
 */
export const parseVimeoInput = (input) => {
    const text = String(input || '').trim();
    if (!text) return { eventId: null, videoId: null };

    // A bare number is ambiguous; treat it as an event id, which is what the
    // admin form asks for.
    if (/^\d+$/.test(text)) return { eventId: text, videoId: null };

    const eventId = text.match(/vimeo\.com\/event\/(\d+)/)?.[1] ?? null;
    const videoId =
        text.match(/[?&]video=(\d+)/)?.[1] ??
        text.match(/\/video\/(\d+)/)?.[1] ??
        null;

    return { eventId, videoId };
};

/**
 * Ask our own serverless endpoint which clip the event is pointing at right now.
 * Has to be server-side: vimeo.com sends no CORS headers, so the browser cannot
 * read the embed page itself.
 */
export const fetchCurrentVimeoClip = async (eventId, apiBase = '') => {
    const res = await fetch(`${apiBase}/api/vimeo-clip?eventId=${encodeURIComponent(eventId)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Vimeo lookup failed (${res.status})`);
    return data;
};

/** Resolve the embed hash for a clip id (server-side scrape; no API key). */
export const fetchVimeoClipHash = async (videoId, apiBase = '') => {
    const res = await fetch(`${apiBase}/api/vimeo-clip?videoId=${encodeURIComponent(videoId)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Hash lookup failed (${res.status})`);
    return data?.hash ?? null;
};

// ---------------------------------------------------------------------------
// Player SDK
// ---------------------------------------------------------------------------

let sdkPromise = null;

/** Load player.js once per page and hand back the global `Vimeo` namespace. */
export const loadVimeoSdk = () => {
    if (typeof window === 'undefined') return Promise.reject(new Error('No window'));
    if (window.Vimeo?.Player) return Promise.resolve(window.Vimeo);

    if (!sdkPromise) {
        sdkPromise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = SDK_SRC;
            script.async = true;

            script.addEventListener('load', () => {
                // `load` fires after the script body has run, so the global is
                // there — unless the file was served but did not evaluate (an ad
                // blocker returning an empty 200, say), which reads as success
                // and would otherwise throw `undefined.Player` at the call site.
                if (window.Vimeo?.Player) {
                    resolve(window.Vimeo);
                } else {
                    sdkPromise = null;
                    script.remove();
                    reject(new Error('The Vimeo player loaded but did not initialise'));
                }
            });

            script.addEventListener('error', () => {
                // Drop the failed tag as well as the promise. Leaving it in the
                // DOM used to poison the retry: a later attempt would find it,
                // attach listeners to an element whose load/error already fired,
                // and hang forever.
                sdkPromise = null;
                script.remove();
                reject(new Error('Could not load the Vimeo player'));
            });

            document.head.appendChild(script);
        });
    }

    return sdkPromise;
};

// ---------------------------------------------------------------------------
// Day → stream-start resolution
// ---------------------------------------------------------------------------

/**
 * The calendar date a match belongs to, in the event's own local time.
 *
 * RobotEvents timestamps carry the venue's UTC offset ("...T19:33:11-04:00"), so
 * slicing the date off the string gives the local competition day directly —
 * parsing into a Date would re-anchor it to the viewer's timezone and roll
 * late-evening matches into the next day for anyone further east.
 */
export const eventLocalDate = (isoString) => (isoString ? String(isoString).slice(0, 10) : null);

/** A match's effective time, preferring the real start over the schedule. */
export const matchTime = (match) => match?.started || match?.scheduled || null;

/**
 * When did this day's broadcast begin, in wall-clock terms?
 *
 * The admin gives us one anchor per day: a match, and how far into the video it
 * starts. Everything else follows, since the video runs in real time —
 *   streamStart = anchorMatchStart − anchorSeconds
 * and any other match on that day seeks to (itsStart − streamStart).
 *
 * `matches` is optional: passing the live match list re-reads the anchor's start
 * time so a RobotEvents revision does not drag every seek off by the same
 * amount. Without it we fall back to the time captured when the day was saved.
 */
export const resolveVimeoStreamStart = (day, matches = null) => {
    if (!day || day.anchorSeconds === null || day.anchorSeconds === undefined) return null;

    const live = matches?.find((m) => m.id === day.anchorMatchId);
    const anchorStartedAt = matchTime(live) || day.anchorStartedAt;
    if (!anchorStartedAt) return null;

    const anchorMs = new Date(anchorStartedAt).getTime();
    if (Number.isNaN(anchorMs)) return null;

    return anchorMs - Number(day.anchorSeconds) * 1000;
};

/** Days that are actually playable — a clip plus an anchor timestamp. */
export const configuredVimeoDays = (vimeo) =>
    (vimeo?.days ?? []).filter((day) => day && day.anchorSeconds !== null && day.anchorSeconds !== undefined);

// ---------------------------------------------------------------------------
// Timestamp formatting (the admin form speaks H:MM:SS)
// ---------------------------------------------------------------------------

/** "1:23:45" / "23:45" / "845" → seconds. Returns null if unparseable. */
export const parseTimestamp = (input) => {
    const text = String(input ?? '').trim();
    if (!text) return null;

    const parts = text.split(':').map((p) => p.trim());
    if (parts.some((p) => p === '' || !/^\d+(\.\d+)?$/.test(p))) return null;
    if (parts.length > 3) return null;

    // Right-aligned: the last part is always seconds, then minutes, then hours.
    const seconds = parts
        .map(Number)
        .reverse()
        .reduce((total, value, index) => total + value * 60 ** index, 0);

    return Number.isFinite(seconds) ? Math.floor(seconds) : null;
};

/** Seconds → "H:MM:SS", the same shape the Vimeo scrubber shows. */
export const formatTimestamp = (seconds) => {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '';
    const total = Math.max(0, Math.floor(Number(seconds)));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
