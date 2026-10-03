import { SYNC_SCOPE_DAY, SYNC_SCOPE_DIVISION } from './worldsSyncOffsets';

// Manual sync offsets for the event Viewer, saved per browser. Same model as
// the Worlds offsets: a division either shares one offset across all its days,
// or keeps one per day's video. Target shape:
//   { sku, divisionId, dayIndex, videoKey }
// where videoKey identifies the recording (YouTube or Vimeo video id), so a
// saved correction is dropped once that day's stream is swapped for another.
const STORAGE_KEY = 'vex_match_jumper_event_sync_offsets';
// Per-day by default: a multi-day event usually starts its stream at a
// different time each day, so one shared correction is rarely right.
const DEFAULT_SCOPE = SYNC_SCOPE_DAY;

function readStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.error('Error reading event sync offsets:', error);
        return {};
    }
}

function writeStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
        console.error('Error saving event sync offsets:', error);
    }
}

function hasDivisionFields(target) {
    return !!(target?.sku && target?.divisionId != null);
}

function dayKey(target) {
    if (!hasDivisionFields(target) || target.dayIndex == null || !target.videoKey) return null;
    return [target.sku, target.divisionId, `day-${target.dayIndex}`, target.videoKey].join('::');
}

function divisionKey(target) {
    if (!hasDivisionFields(target)) return null;
    return [target.sku, target.divisionId, 'all-days'].join('::');
}

function scopeKey(target) {
    if (!hasDivisionFields(target)) return null;
    return [target.sku, target.divisionId, 'scope'].join('::');
}

export function getEventSyncScope(target) {
    const key = scopeKey(target);
    if (!key) return DEFAULT_SCOPE;
    const value = readStore()[key];
    return value === SYNC_SCOPE_DAY || value === SYNC_SCOPE_DIVISION ? value : DEFAULT_SCOPE;
}

export function setEventSyncScope(target, scope) {
    const key = scopeKey(target);
    if (!key) return;
    const store = readStore();
    store[key] = scope === SYNC_SCOPE_DIVISION ? SYNC_SCOPE_DIVISION : SYNC_SCOPE_DAY;
    writeStore(store);
}

function offsetKey(target) {
    return getEventSyncScope(target) === SYNC_SCOPE_DIVISION ? divisionKey(target) : dayKey(target);
}

export function getEventSyncOffset(target) {
    const key = offsetKey(target);
    if (!key) return 0;
    return readStore()[key]?.offsetSeconds ?? 0;
}

// Saving 0 clears the entry rather than storing a no-op correction.
export function setEventSyncOffset(target, offsetSeconds, source = 'manual') {
    const key = offsetKey(target);
    if (!key) return 0;
    const store = readStore();
    const rounded = Math.round(offsetSeconds);
    if (rounded) {
        store[key] = { offsetSeconds: rounded, source, updatedAt: new Date().toISOString() };
    } else {
        delete store[key];
    }
    writeStore(store);
    return rounded;
}

// Offsets only apply in MANUAL mode, so the mode is remembered per event too;
// otherwise a saved correction would sit unused on the next visit.
export function getEventSyncManual(sku) {
    if (!sku) return false;
    return readStore()[`${sku}::manual`] === true;
}

export function setEventSyncManual(sku, manual) {
    if (!sku) return;
    const store = readStore();
    if (manual) {
        store[`${sku}::manual`] = true;
    } else {
        delete store[`${sku}::manual`];
    }
    writeStore(store);
}

// A stream whose start couldn't be detected gets pinned from a frame the user
// picked. That start belongs to the recording, so it is saved per video rather
// than under a scope.
function pinnedStartKey(target) {
    const key = dayKey(target);
    return key && `${key}::start`;
}

export function getPinnedStreamStart(target) {
    const key = pinnedStartKey(target);
    if (!key) return null;
    return readStore()[key] ?? null;
}

export function setPinnedStreamStart(target, streamStartTime) {
    const key = pinnedStartKey(target);
    if (!key) return;
    const store = readStore();
    store[key] = Math.round(streamStartTime);
    writeStore(store);
}
