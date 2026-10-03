import { format } from 'date-fns';
import { parseCalendarDate } from './dateUtils';

/**
 * Calculate the number of days an event spans
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {number} Number of days (minimum 1)
 */
export const calculateEventDays = (startDate, endDate) => {
    if (!startDate || !endDate) return 1;

    const start = parseCalendarDate(startDate);
    const end = parseCalendarDate(endDate);

    // Calculate difference in days (ceiling to count partial days)
    const diffTime = Math.abs(end - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    // An event starting and ending on the same day is 1 day
    // An event spanning Nov 1-2 is 2 days, etc.
    return Math.max(1, diffDays + 1);
};

/**
 * Does this stream have something to play?
 *
 * YouTube streams carry a `videoId` parsed out of a pasted URL. Vimeo streams
 * are pinned by their preset instead and carry a clip id, so a bare `videoId`
 * check reads them as empty.
 *
 * @param {Object} stream - Stream object
 * @returns {boolean}
 */
export const hasStreamVideo = (stream) =>
    stream?.provider === 'vimeo' ? !!stream.vimeoVideoId : !!stream?.videoId;

/**
 * Determine which day index (0-based) a match occurred on
 * @param {string} matchDate - ISO date string of match start
 * @param {string} eventStartDate - ISO date string of event start
 * @returns {number} Day index (0 for day 1, 1 for day 2, etc.)
 */
export const getMatchDayIndex = (matchDate, eventStartDate) => {
    if (!matchDate || !eventStartDate) return 0;

    // Parse as calendar dates to ensure we're comparing days correctly
    // regardless of time components
    const matchDay = parseCalendarDate(matchDate);
    const eventDay = parseCalendarDate(eventStartDate);

    const diffTime = matchDay - eventDay;
    const dayIndex = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    return Math.max(0, dayIndex);
};

/**
 * Which day of the event a stream went live on, counted the way match days
 * are: on the calendar of the UTC offset the event's dates come in, which is
 * the offset match times come in too.
 * @param {Object} stream - Stream object
 * @param {string} eventStartDate - ISO date string of event start
 * @returns {number|null} Day index, or null when unknown or not during the event
 */
export const getStreamDayIndex = (stream, eventStartDate) => {
    if (!stream?.streamStartTime || !eventStartDate) return null;

    const offset = /([+-])(\d{2}):?(\d{2})$/.exec(eventStartDate);
    const offsetMs = offset
        ? (offset[1] === '-' ? -1 : 1) * (Number(offset[2]) * 60 + Number(offset[3])) * 60000
        : 0;
    // The wall-clock date at that offset
    const date = new Date(stream.streamStartTime + offsetMs).toISOString().slice(0, 10);

    // A video from before the event, or weeks after it, is a wrong link, not a day.
    if (date < eventStartDate.slice(0, 10)) return null;
    const dayIndex = getMatchDayIndex(date, eventStartDate);
    return dayIndex > 14 ? null : dayIndex;
};

/**
 * A stream's label, by the day it went live.
 *
 * Preset streams are labelled by their day slot, a calendar day counted from
 * the event's start date, but streams are now picked by when they were live
 * (see streamLiveAtMatch), so a slot can hold another day's stream. Great
 * Planes 2026's Oct 2 stream sits in the Oct 1 slot. Once YouTube says when a
 * stream went live, it is labelled by that day; one live on its slot's day
 * keeps its label.
 * @param {Object} stream - Stream object
 * @param {string} eventStartDate - ISO date string of event start
 * @returns {string} Label
 */
export const getStreamLabel = (stream, eventStartDate) => {
    if (stream?.dayIndex === null || stream?.dayIndex === undefined) return stream?.label;
    const dayIndex = getStreamDayIndex(stream, eventStartDate);
    if (dayIndex === null || dayIndex === stream.dayIndex) return stream.label;
    return getDayLabel(dayIndex, eventStartDate);
};

/**
 * "Day 2 - Oct 2" for a day index of the event.
 * @param {number} dayIndex - Day index (0-based)
 * @param {string} eventStartDate - ISO date string of event start
 * @returns {string} Label
 */
export const getDayLabel = (dayIndex, eventStartDate) => {
    if (!eventStartDate) return `Day ${dayIndex + 1}`;
    const date = parseCalendarDate(eventStartDate);
    date.setDate(date.getDate() + dayIndex);
    return `Day ${dayIndex + 1} - ${format(date, 'MMM d')}`;
};

/**
 * Infer the day index for a match without a timestamp by looking at surrounding matches.
 * For elimination matches without timestamps, place them on the same day as the last 
 * qualification match that has a timestamp.
 * 
 * @param {Object} match - Match object that may not have started/scheduled
 * @param {Array} allMatches - All matches for the event (same division)
 * @param {string} eventStartDate - Event start date for day calculation
 * @returns {number} Inferred day index (0-based)
 */
export const inferMatchDayFromContext = (match, allMatches, eventStartDate) => {
    // If match already has a timestamp, use it directly
    const matchDate = match.started || match.scheduled;
    if (matchDate) {
        return getMatchDayIndex(matchDate, eventStartDate);
    }

    // For matches without timestamps, infer from surrounding matches
    // Strategy: Find the last qualification match with a timestamp in the same division
    const matchDivisionId = match.division?.id;

    // Filter to same division if applicable
    const divisionMatches = matchDivisionId
        ? allMatches.filter(m => m.division?.id === matchDivisionId)
        : allMatches;

    // Find all qualification matches with timestamps
    const qualMatchesWithTime = divisionMatches.filter(m => {
        const hasTime = m.started || m.scheduled;
        const isQual = m.name && (
            m.name.toLowerCase().includes('qual') ||
            m.name.toLowerCase().includes('practice') ||
            m.name.toLowerCase().includes('teamwork')
        );
        return hasTime && isQual;
    });

    if (qualMatchesWithTime.length > 0) {
        // Sort by time and get the last one
        const sortedQuals = qualMatchesWithTime.sort((a, b) => {
            const aTime = new Date(a.started || a.scheduled).getTime();
            const bTime = new Date(b.started || b.scheduled).getTime();
            return bTime - aTime; // Descending (latest first)
        });

        const lastQualTime = sortedQuals[0].started || sortedQuals[0].scheduled;
        return getMatchDayIndex(lastQualTime, eventStartDate);
    }

    // Fallback: Look for any match with a timestamp
    const anyMatchWithTime = divisionMatches.find(m => m.started || m.scheduled);
    if (anyMatchWithTime) {
        const time = anyMatchWithTime.started || anyMatchWithTime.scheduled;
        return getMatchDayIndex(time, eventStartDate);
    }

    // Ultimate fallback: Day 0
    return 0;
};

/**
 * The streams a match could play from: those with a known start time, from the
 * match's own division when it has any.
 * @param {Object} match - Match object
 * @param {Array} streams - Array of stream objects
 * @param {number} matchDay - Calendar day index of the match
 * @returns {Array} Candidate streams
 */
const candidateStreamsForMatch = (match, streams, matchDay) => {
    // Vimeo streams are pinned to a single broadcast day by an admin-supplied
    // anchor, so — unlike a pasted YouTube URL, which the fallbacks below are
    // happy to reuse across days — one must never stand in for another day's
    // match. Doing so would seek hours past the end of the recording. Drop them
    // before the fallbacks can reach for them.
    const eligible = streams.filter(stream =>
        stream.provider !== 'vimeo' || stream.dayIndex === matchDay
    );

    // Filter streams that have valid start times
    const streamsWithStartTime = eligible.filter(stream => stream.streamStartTime);

    // Filter by division if the match has a division ID
    const matchDivisionId = match.division?.id;
    if (matchDivisionId) {
        const divisionStreams = streamsWithStartTime.filter(stream =>
            stream.divisionId === matchDivisionId || !stream.divisionId
        );
        if (divisionStreams.length > 0) return divisionStreams;
    }
    return streamsWithStartTime;
};

/**
 * The stream that was live when a match started.
 *
 * Day slots are calendar days counted from the event's start date, so any date
 * with no matches shifts every later match onto the wrong stream. The Great
 * Planes Signature Event 2026 is dated Oct 1–3 with matches on Oct 2 and 3,
 * and its preset has one stream per match day: the Oct 2 matches went to the
 * stream that went live on Oct 3, and the Oct 3 matches to an empty third slot.
 *
 * Each stream's start time says which matches it covers, so the stream for a
 * match is the one that most recently went live at or before the match
 * started, and a match earlier than every stream belongs to the first. The
 * stream must also not have ended before the match: a match played the
 * morning before its day's stream went live (Score 2025's Qualifier #79) would
 * otherwise land a day into the previous day's video, past its end. A preset
 * whose days line up gets the same stream it always did. pickVideoId in
 * api/match-timestamp.js picks the same way.
 *
 * @param {Object} match - Match object
 * @param {Array} streams - Array of stream objects
 * @param {number} matchDay - Calendar day index of the match
 * @param {number} matchTimeMs - Match start time (epoch ms)
 * @returns {Object|null} Stream, or null when the stream times can't settle it
 *   and the calendar day has to decide
 */
const streamLiveAtMatch = (match, streams, matchDay, matchTimeMs) => {
    // A stream with a video but no start time (still loading, or YouTube has
    // none, like Speedway 2026's removed day-3 video) may be the one that was
    // live, and skipping it would seek past the end of the day before's video.
    const matchDivisionId = match.division?.id;
    const unknownStart = streams.some(stream =>
        hasStreamVideo(stream) && !stream.streamStartTime &&
        (!matchDivisionId || !stream.divisionId || stream.divisionId === matchDivisionId)
    );
    if (unknownStart) return null;

    const candidates = candidateStreamsForMatch(match, streams, matchDay);
    const startTimes = [...new Set(candidates.map(stream => stream.streamStartTime))].sort((a, b) => a - b);
    if (startTimes.length < 2) return null;

    const wentLive = startTimes.filter(time => time <= matchTimeMs);
    const startTime = wentLive.length ? wentLive[wentLive.length - 1] : startTimes[0];

    // One video can fill more than one day slot; keep the match's own day then.
    const live = candidates.filter(stream => stream.streamStartTime === startTime);
    const picked = live.find(stream => stream.dayIndex === matchDay) || live[0];

    // Nothing was live when the match started.
    if (wentLive.length && picked.streamEndTime && picked.streamEndTime < matchTimeMs) return null;

    return picked;
};

/**
 * Find the best stream for a given match
 * @param {Object} match - Match object with started/scheduled time
 * @param {Array} streams - Array of stream objects
 * @param {string} eventStartDate - Event start date for day calculation
 * @returns {Object|null} Stream object or null if no valid stream
 */
export const findStreamForMatch = (match, streams, eventStartDate) => {
    if (!match || !streams || streams.length === 0) return null;

    // If match hasn't started, we can't determine availability
    const matchStartTime = match.started || match.scheduled;
    if (!matchStartTime) return null;

    const matchDay = getMatchDayIndex(matchStartTime, eventStartDate);
    const matchTimeMs = new Date(matchStartTime).getTime();

    const liveStream = streamLiveAtMatch(match, streams, matchDay, matchTimeMs);
    if (liveStream) return liveStream;

    let candidateStreams = candidateStreamsForMatch(match, streams, matchDay);

    if (candidateStreams.length === 0) return null;

    // Otherwise prefer streams from the same day
    const sameDayStreams = candidateStreams.filter(stream =>
        stream.dayIndex === null || stream.dayIndex === undefined || stream.dayIndex === matchDay
    );

    // Use same-day streams if available, otherwise use any available stream
    candidateStreams = sameDayStreams.length > 0 ? sameDayStreams : candidateStreams;

    // Filter to only streams that started before the match
    const validStreams = candidateStreams.filter(stream =>
        stream.streamStartTime <= matchTimeMs
    );

    if (validStreams.length === 0) {
        // If no stream started before the match, use the earliest available stream
        // This allows jumping to matches even if the stream started late
        return candidateStreams.reduce((earliest, current) =>
            current.streamStartTime < earliest.streamStartTime ? current : earliest
        );
    }

    // Return the stream with start time CLOSEST to (but before) the match time
    return validStreams.reduce((closest, current) => {
        const closestDiff = matchTimeMs - closest.streamStartTime;
        const currentDiff = matchTimeMs - current.streamStartTime;
        return currentDiff < closestDiff ? current : closest;
    });
};

/**
 * Get the reason why a match is unavailable (grayed out)
 * @param {Object} match - Match object
 * @param {Array} streams - Array of stream objects
 * @param {string} eventStartDate - Event start date
 * @returns {string|null} Reason string or null if match is available
 */
export const getGrayOutReason = (match, streams, eventStartDate) => {
    if (!match) return null;

    const matchStartTime = match.started || match.scheduled;

    // If match hasn't been played/scheduled, it's not grayed out
    if (!matchStartTime) return null;

    // If no streams at all
    if (!streams || streams.length === 0) {
        return "No livestreams added yet. Add a stream URL above.";
    }

    const matchDay = getMatchDayIndex(matchStartTime, eventStartDate);
    const matchTimeMs = new Date(matchStartTime).getTime();
    const matchTimeFormatted = format(new Date(matchStartTime), 'h:mm a');

    // With start times to go by, the match's stream is whichever was live then,
    // whatever its day slot (see streamLiveAtMatch).
    const liveStream = streamLiveAtMatch(match, streams, matchDay, matchTimeMs);
    if (liveStream) {
        if (liveStream.streamStartTime <= matchTimeMs) return null;
        const streamStartFormatted = format(new Date(liveStream.streamStartTime), 'h:mm a');
        return `Stream started at ${streamStartFormatted}, but this match was at ${matchTimeFormatted}.`;
    }

    // Check if there's a stream for this day
    const streamsForDay = streams.filter(s =>
        s.dayIndex === null || s.dayIndex === matchDay
    );

    if (streamsForDay.length === 0) {
        return `No livestream for Day ${matchDay + 1}. Add a stream for this day to watch matches.`;
    }

    // Check if any stream has started yet
    const streamsWithStartTime = streamsForDay.filter(s => s.streamStartTime);

    if (streamsWithStartTime.length === 0) {
        return `Stream URL added but not loaded yet. The stream needs to load to detect start time.`;
    }

    // Check if any stream started early enough
    const validStream = streamsWithStartTime.find(s => s.streamStartTime <= matchTimeMs);

    if (!validStream) {
        const earliestStream = streamsWithStartTime
            .sort((a, b) => a.streamStartTime - b.streamStartTime)[0];
        const streamStartFormatted = format(new Date(earliestStream.streamStartTime), 'h:mm a');

        return `Stream started at ${streamStartFormatted}, but this match was at ${matchTimeFormatted}.`;
    }

    return null;
};
