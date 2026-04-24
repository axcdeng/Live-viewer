const STORAGE_KEY = 'vex_match_jumper_worlds_sync_offsets';

export const SYNC_SCOPE_DAY = 'day';
export const SYNC_SCOPE_DIVISION = 'division';
const DEFAULT_SCOPE = SYNC_SCOPE_DIVISION;

// Baseline calibration measured by hand per division. Applied silently under
// any user offset so jumps land accurately out of the box; the UI still shows
// 00:00 and user adjustments stack on top (effective = preset + user).
// Structure: WORLDS_SYNC_PRESETS[program][year][divisionName] = seconds
//   or { allDays: seconds, days: { [dayIdx]: seconds } } for per-day overrides.
const WORLDS_SYNC_PRESETS = {
    'V5RC HS': {
        '2026': {
            Arts: 0,
            Design: -47,
            Engineering: -50,
            Innovate: -55,
            Math: -51,
            Opportunity: -50,
            Research: -49,
            Science: -41,
            Spirit: -47,
            Technology: -48,
        },
    },
};

export function getWorldsSyncPresetOffset(target) {
    if (!target?.program || !target?.year || !target?.divisionName) return 0;
    const entry = WORLDS_SYNC_PRESETS[target.program]?.[target.year]?.[target.divisionName];
    if (entry == null) return 0;
    if (typeof entry === 'number') return entry;
    if (target.dayIdx !== undefined && entry.days && entry.days[target.dayIdx] != null) {
        return entry.days[target.dayIdx];
    }
    return entry.allDays ?? 0;
}

function readStore() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.error('Error reading Worlds sync offsets:', error);
        return {};
    }
}

function writeStore(store) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (error) {
        console.error('Error saving Worlds sync offsets:', error);
    }
}

function hasDivisionFields(target) {
    return !!(target?.program && target?.year && target?.divisionName);
}

function dayKey(target) {
    if (!hasDivisionFields(target) || target.dayIdx === undefined || !target.broadcastId) {
        return null;
    }
    return [target.program, target.year, target.divisionName, `day-${target.dayIdx}`, target.broadcastId].join('::');
}

function divisionKey(target) {
    if (!hasDivisionFields(target)) return null;
    return [target.program, target.year, target.divisionName, 'all-days'].join('::');
}

function scopeKey(target) {
    if (!hasDivisionFields(target)) return null;
    return [target.program, target.year, target.divisionName, 'scope'].join('::');
}

export function getWorldsSyncScope(target) {
    const key = scopeKey(target);
    if (!key) return DEFAULT_SCOPE;
    const store = readStore();
    const value = store[key];
    if (value === SYNC_SCOPE_DAY) return SYNC_SCOPE_DAY;
    if (value === SYNC_SCOPE_DIVISION) return SYNC_SCOPE_DIVISION;
    return DEFAULT_SCOPE;
}

export function setWorldsSyncScope(target, scope) {
    const key = scopeKey(target);
    if (!key) return;
    const normalized = scope === SYNC_SCOPE_DIVISION ? SYNC_SCOPE_DIVISION : SYNC_SCOPE_DAY;
    const store = readStore();
    store[key] = normalized;
    writeStore(store);
}

function offsetKeyForScope(target, scope) {
    return scope === SYNC_SCOPE_DIVISION ? divisionKey(target) : dayKey(target);
}

export function getWorldsSyncOffset(target) {
    const scope = getWorldsSyncScope(target);
    const key = offsetKeyForScope(target, scope);
    if (!key) return null;
    const store = readStore();
    return store[key] ?? null;
}

export function setWorldsSyncOffset(target, offsetSeconds, source = 'manual') {
    const scope = getWorldsSyncScope(target);
    const key = offsetKeyForScope(target, scope);
    if (!key) return null;

    const entry = {
        offsetSeconds: Math.round(offsetSeconds),
        source,
        scope,
        updatedAt: new Date().toISOString(),
    };

    const store = readStore();
    store[key] = entry;
    writeStore(store);
    return entry;
}

export function clearWorldsSyncOffset(target) {
    const scope = getWorldsSyncScope(target);
    const key = offsetKeyForScope(target, scope);
    if (!key) return;
    const store = readStore();
    delete store[key];
    writeStore(store);
}
