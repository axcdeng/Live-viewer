const STORAGE_KEY = 'vex_match_jumper_worlds_sync_offsets';

function readOffsets() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.error('Error reading Worlds sync offsets:', error);
        return {};
    }
}

function writeOffsets(offsets) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets));
    } catch (error) {
        console.error('Error saving Worlds sync offsets:', error);
    }
}

function serializeKey(key) {
    if (!key?.program || !key?.year || !key?.divisionName || key?.dayIdx === undefined || !key?.broadcastId) {
        return null;
    }

    return [
        key.program,
        key.year,
        key.divisionName,
        `day-${key.dayIdx}`,
        key.broadcastId,
    ].join('::');
}

export function getWorldsSyncOffset(key) {
    const storageKey = serializeKey(key);
    if (!storageKey) return null;

    const offsets = readOffsets();
    return offsets[storageKey] ?? null;
}

export function setWorldsSyncOffset(key, offsetSeconds, source = 'manual') {
    const storageKey = serializeKey(key);
    if (!storageKey) return null;

    const offsets = readOffsets();
    const entry = {
        offsetSeconds: Math.round(offsetSeconds),
        source,
        updatedAt: new Date().toISOString(),
    };

    offsets[storageKey] = entry;
    writeOffsets(offsets);
    return entry;
}

export function clearWorldsSyncOffset(key) {
    const storageKey = serializeKey(key);
    if (!storageKey) return;

    const offsets = readOffsets();
    delete offsets[storageKey];
    writeOffsets(offsets);
}
