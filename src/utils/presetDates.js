import { useEffect, useState } from 'react';
import { getEventsBySkus } from '../services/robotevents';
import { parseCalendarDate } from './dateUtils';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Event dates for a list of presets, looked up from RobotEvents by SKU since a
 * preset only stores the SKU. Returns { [SKU]: { start, end } }, empty until the
 * lookup lands; a preset whose event wasn't found has no entry.
 */
export function usePresetDates(presets) {
    const [dates, setDates] = useState({});
    const skuKey = [...new Set(presets.map(p => (p.sku || '').toUpperCase()).filter(Boolean))].sort().join(',');

    useEffect(() => {
        if (!skuKey) return;
        let cancelled = false;
        getEventsBySkus(skuKey.split(','))
            .then(events => {
                if (cancelled) return;
                const found = {};
                for (const ev of events) {
                    if (ev.sku && ev.start) found[ev.sku.toUpperCase()] = { start: ev.start, end: ev.end };
                }
                setDates(found);
            })
            .catch(err => console.error('Failed to fetch preset event dates', err));
        return () => { cancelled = true; };
    }, [skuKey]);

    return dates;
}

export const getPresetDates = (dates, preset) => dates[(preset.sku || '').toUpperCase()] || null;

// The event's calendar days in local time: midnight of its first day up to
// midnight after its last, matching how the rest of the app reads event dates.
const eventSpan = ({ start, end }) => ({
    from: parseCalendarDate(start).getTime(),
    to: parseCalendarDate(end || start).getTime() + DAY_MS,
});

export const isEventLive = (eventDates, now = Date.now()) => {
    if (!eventDates) return false;
    const { from, to } = eventSpan(eventDates);
    return now >= from && now < to;
};

// Presets with no known dates go last, in their saved order.
const byDatedFirst = (a, b, compare) => {
    if (!a.eventDates || !b.eventDates) return (a.eventDates ? 0 : 1) - (b.eventDates ? 0 : 1);
    return compare(a.eventDates, b.eventDates);
};

const withDates = (presets, dates) => presets.map((preset, index) => ({ preset, index, eventDates: getPresetDates(dates, preset) }));

/**
 * Presets ordered by event start, 'later' (newest first) or 'earlier'. Returns
 * { preset, index, eventDates } so callers can still address the preset by its
 * position in the saved list.
 */
export const sortPresetsByDate = (presets, dates, order = 'later') => {
    const sign = order === 'earlier' ? 1 : -1;
    return withDates(presets, dates).sort((a, b) =>
        byDatedFirst(a, b, (x, y) => sign * (parseCalendarDate(x.start) - parseCalendarDate(y.start)))
    );
};

/**
 * Presets ordered by how close their event is to now: running events first, then
 * whichever is nearest, whether it is coming up or just finished.
 */
export const sortPresetsByProximity = (presets, dates, now = Date.now()) => {
    const distance = (eventDates) => {
        const { from, to } = eventSpan(eventDates);
        if (now < from) return from - now;
        if (now >= to) return now - to;
        return 0;
    };
    return withDates(presets, dates).sort((a, b) =>
        byDatedFirst(a, b, (x, y) => distance(x) - distance(y))
    );
};
