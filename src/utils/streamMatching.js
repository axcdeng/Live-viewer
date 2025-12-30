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

    // Filter streams that have valid start times
    const streamsWithStartTime = streams.filter(stream => stream.streamStartTime);

    if (streamsWithStartTime.length === 0) return null;

    // Prefer streams from the same day, but accept any stream if needed
    const sameDayStreams = streamsWithStartTime.filter(stream =>
        stream.dayIndex === null || stream.dayIndex === matchDay
    );

    // Use same-day streams if available, otherwise use any available stream
    const candidateStreams = sameDayStreams.length > 0 ? sameDayStreams : streamsWithStartTime;

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
