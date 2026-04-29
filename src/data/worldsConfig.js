// ---------------------------------------------------------------------------
// Worlds-specific data model
//
// Channel IDs are the durable identifiers. SKUs/division details live here
// so the runtime can fetch and resolve everything dynamically.
//
// broadcastOverrides: { 'DivisionName-Day0': 'boxcastBroadcastId' }
// Use only when title-parsing is ambiguous or a specific broadcast must
// be hard-pinned (e.g., duplicate streams, naming inconsistencies).
// ---------------------------------------------------------------------------

// Confirmed from BoxCast channel data (both years reuse same channel IDs).
// Division names must match the parenthetical in BoxCast broadcast titles exactly.
// e.g. "Qualification Matches (Innovate)" → 'Innovate'

const HS_DIVISIONS = [
    'Arts', 'Design', 'Engineering', 'Innovate', 'Math',
    'Opportunity', 'Research', 'Science', 'Spirit', 'Technology',
];

const MS_DIVISIONS_2025 = [
    // VRC MS only — excludes JROTC/VURC divisions also on this channel
    'Design', 'Engineering', 'Innovate', 'Opportunity', 'Research', 'Spirit',
];

const MS_DIVISIONS_2026 = [
    'Arts', 'Engineering', 'Innovate', 'Math', 'Science', 'Spirit', 'Technology',
];

const VURC_DIVISIONS_2025 = [
    'Math', 'Technology',
];

const VURC_DIVISIONS_2026 = [
    'Design', 'Opportunity', 'Research',
];

const VIQRC_ES_DIVISIONS = [
    'Arts', 'Engineering', 'Math', 'Science', 'Technology',
];

const VIQRC_MS_DIVISIONS = [
    'Design', 'Innovate', 'Opportunity', 'Research', 'Spirit',
];

export const WORLDS_CONFIG = {
    '2025': {
        'V5RC HS': {
            channelId: 'jmhkmkbdwsh3fg4pfoqn',
            sku: 'RE-V5RC-24-8909',
            eventStart: '2025-05-06',
            eventEnd: '2025-05-08',
            divisions: HS_DIVISIONS,
            numDays: 3,
            broadcastOverrides: {},
        },
        'V5RC MS': {
            channelId: 'rguwbt3mtvp4gseosarn',
            sku: 'RE-V5RC-24-8910',
            eventStart: '2025-05-09',
            eventEnd: '2025-05-11',
            divisions: MS_DIVISIONS_2025,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VURC': {
            channelId: 'yignzh2p52kbstxrrsl8',
            sku: null,
            eventStart: '2025-05-09',
            eventEnd: '2025-05-11',
            divisions: VURC_DIVISIONS_2025,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VIQRC ES': {
            channelId: 'forwjofkekkjndq5gdps',
            sku: null,
            eventStart: '2025-05-12',
            eventEnd: '2025-05-14',
            divisions: VIQRC_ES_DIVISIONS,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VIQRC MS': {
            channelId: 'sooczxjv6zfijyjnw3yn',
            sku: null,
            eventStart: '2025-05-12',
            eventEnd: '2025-05-14',
            divisions: VIQRC_MS_DIVISIONS,
            numDays: 3,
            broadcastOverrides: {},
        },
    },
    '2026': {
        'V5RC HS': {
            channelId: 'jmhkmkbdwsh3fg4pfoqn',
            sku: null,
            eventStart: '2026-04-21',
            eventEnd: '2026-04-24',
            divisions: HS_DIVISIONS,   // same channel reused; names confirmed in feed
            numDays: 4,
            broadcastOverrides: {},
        },
        'V5RC MS': {
            channelId: 'rguwbt3mtvp4gseosarn',
            sku: null,
            eventStart: '2026-04-25',
            eventEnd: '2026-04-27',
            divisions: MS_DIVISIONS_2026,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VURC': {
            channelId: 'yignzh2p52kbstxrrsl8',
            sku: null,
            eventStart: '2026-04-25',
            eventEnd: '2026-04-27',
            divisions: VURC_DIVISIONS_2026,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VIQRC ES': {
            channelId: 'forwjofkekkjndq5gdps',
            sku: null,
            eventStart: '2026-04-28',
            eventEnd: '2026-04-30',
            divisions: VIQRC_ES_DIVISIONS,
            numDays: 3,
            broadcastOverrides: {},
        },
        'VIQRC MS': {
            channelId: 'sooczxjv6zfijyjnw3yn',
            sku: null,
            eventStart: '2026-04-28',
            eventEnd: '2026-04-30',
            divisions: VIQRC_MS_DIVISIONS,
            numDays: 3,
            broadcastOverrides: {},
        },
    },
};

export const WORLDS_PROGRAMS = ['V5RC HS', 'V5RC MS', 'VURC', 'VIQRC ES', 'VIQRC MS'];
export const WORLDS_YEARS = ['2026', '2025'];

export function getProgConfig(year, program) {
    return WORLDS_CONFIG[year]?.[program] ?? null;
}
