import axios from 'axios';

const BASE_URL = 'https://events.vex.com/api/v2';
const DEFAULT_API_KEY = import.meta.env.VITE_DEFAULT_ROBOTEVENTS_API_KEY;

const getClient = () => {
    const userKey = localStorage.getItem('robotevents_api_key');
    const apiKey = userKey || DEFAULT_API_KEY;

    return axios.create({
        baseURL: BASE_URL,
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: 'application/json',
        },
    });
};

export const getEventBySku = async (sku) => {
    const client = getClient();
    // Search for the event by SKU
    const response = await client.get('/events', {
        params: {
            sku: sku,
        },
    });

    if (response.data.data && response.data.data.length > 0) {
        return response.data.data[0];
    }
    throw new Error('Event not found');
};

export const getTeamByNumber = async (number) => {
    const client = getClient();
    const response = await client.get('/teams', {
        params: {
            number: number,
            my_teams: false
        },
    });

    // Filter to find exact match if needed, though API usually does good job
    const team = response.data.data.find(t => t.number === number);
    if (team) return team;

    if (response.data.data.length > 0) return response.data.data[0];

    throw new Error('Team not found');
};

export const getMatchesForEvent = async (event) => {
    const client = getClient();
    let allMatches = [];

    try {
        // Use divisions from the event object if available
        // If not, try default division ID 1 as a last resort hail mary
        const divisions = event.divisions && event.divisions.length > 0
            ? event.divisions
            : [{ id: 1, name: 'Default Division' }];

        // Fetch matches from each division
        for (const division of divisions) {
            let page = 1;
            let lastPage = 1;

            do {
                try {
                    const response = await client.get(`/events/${event.id}/divisions/${division.id}/matches`, {
                        params: {
                            page,
                            per_page: 250
                        }
                    });

                    allMatches = [...allMatches, ...response.data.data];
                    lastPage = response.data.meta.last_page;
                } catch (err) {
                    console.warn(`Failed to fetch matches for division ${division.id}`, err);
                    // If division 1 fails and it was our guessed default, we might just be out of luck
                    // But usually event.divisions should be populated.
                    break;
                }
                page++;
            } while (page <= lastPage);
        }

    } catch (error) {
        console.error('Error fetching matches:', error);
        throw new Error(`Could not fetch matches: ${error.response?.data?.message || error.message}`);
    }

    // Sort by start time, putting unplayed matches at the end
    return allMatches.sort((a, b) => {
        // Use started time if available, otherwise scheduled time, otherwise Infinity (future)
        const getMatchTime = (m) => {
            if (m.started) return new Date(m.started).getTime();
            if (m.scheduled) return new Date(m.scheduled).getTime();
            return Infinity; // Unplayed/Unscheduled matches go to the end
        };

        const aTime = getMatchTime(a);
        const bTime = getMatchTime(b);

        // If both are Infinity (unplayed), sort by match name/number if possible
        if (aTime === Infinity && bTime === Infinity) {
            // Simple alphanumeric sort for match names (e.g., Q1, Q2)
            // Use numeric comparison for the number part if possible, but basic localeCompare is a good start
            return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
        }

        return aTime - bTime;
    });
};

export const getMatchesForEventAndTeam = async (eventId, teamId) => {
    const client = getClient();
    let allMatches = [];

    try {
        // First, try to get matches through divisions
        try {
            const divisionsResponse = await client.get(`/events/${eventId}/divisions`);
            const divisions = divisionsResponse.data.data;

            // Fetch matches from each division
            for (const division of divisions) {
                let page = 1;
                let lastPage = 1;

                do {
                    const response = await client.get(`/events/${eventId}/divisions/${division.id}/matches`, {
                        params: {
                            page,
                            per_page: 250
                        }
                    });

                    allMatches = [...allMatches, ...response.data.data];
                    lastPage = response.data.meta.last_page;
                    page++;
                } while (page <= lastPage);
            }
        } catch (divisionError) {
            // This is expected for some events that don't expose divisions
            console.warn('Divisions endpoint not available (404), falling back to team-based fetch.');

            // Fallback: Try to fetch all matches for the team across all their events
            // Then filter for this specific event
            let page = 1;
            let lastPage = 1;

            do {
                const response = await client.get(`/teams/${teamId}/matches`, {
                    params: {
                        page,
                        per_page: 250,
                        event: [eventId]
                    }
                });

                allMatches = [...allMatches, ...response.data.data];
                lastPage = response.data.meta.last_page;
                page++;
            } while (page <= lastPage);
        }
    } catch (error) {
        console.error('Error fetching matches:', error);
        throw new Error(`Could not fetch matches: ${error.response?.data?.message || error.message}`);
    }

    // Filter matches where the team is playing (in case we got extra data)
    const teamMatches = allMatches.filter(match => {
        return match.alliances && match.alliances.some(alliance =>
            alliance.teams && alliance.teams.some(t => t.team && t.team.id === teamId)
        );
    });

    // Sort by start time, putting unplayed matches at the end
    return teamMatches.sort((a, b) => {
        // Use started time if available, otherwise scheduled time, otherwise Infinity (future)
        const getMatchTime = (m) => {
            if (m.started) return new Date(m.started).getTime();
            if (m.scheduled) return new Date(m.scheduled).getTime();
            return Infinity; // Unplayed/Unscheduled matches go to the end
        };

        const aTime = getMatchTime(a);
        const bTime = getMatchTime(b);

        // If both are Infinity (unplayed), sort by match name/number if possible
        if (aTime === Infinity && bTime === Infinity) {
            // Simple alphanumeric sort for match names (e.g., Q1, Q2)
            return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
        }

        return aTime - bTime;
    });
};

export const getTeamsForEvent = async (eventId) => {
    const client = getClient();
    let allTeams = [];
    let page = 1;
    let lastPage = 1;

    try {
        do {
            const response = await client.get(`/events/${eventId}/teams`, {
                params: {
                    page,
                    per_page: 250
                }
            });
            allTeams = [...allTeams, ...response.data.data];
            lastPage = response.data.meta.last_page;
            page++;
        } while (page <= lastPage);
        return allTeams;
    } catch (error) {
        console.error('Error fetching teams:', error);
        return [];
    }
};

export const getRankingsForEvent = async (eventId, divisions = []) => {
    const client = getClient();
    let allRankings = [];

    // Use divisions from the event object if available, default to ID 1
    const targetDivisions = divisions && divisions.length > 0
        ? divisions
        : [{ id: 1, name: 'Default Division' }];

    if (divisions.length === 0) {
        console.log('No divisions provided for rankings fetch, defaulting to Division 1');
    }

    try {
        for (const division of targetDivisions) {
            let dPage = 1;
            let dLastPage = 1;
            do {
                const response = await client.get(`/events/${eventId}/divisions/${division.id}/rankings`, {
                    params: { page: dPage, per_page: 250 }
                });
                allRankings = [...allRankings, ...response.data.data];
                dLastPage = response.data.meta.last_page;
                dPage++;
            } while (dPage <= dLastPage);
        }
        return allRankings;
    } catch (error) {
        // Suppress 404s as they might mean rankings aren't published yet
        if (error.response && error.response.status !== 404) {
            console.warn('Could not fetch division rankings', error);
        }
        return [];
    }
};

export const getSkillsForEvent = async (eventId) => {
    const client = getClient();
    let allSkills = [];
    let page = 1;
    let lastPage = 1;

    try {
        do {
            const response = await client.get(`/events/${eventId}/skills`, {
                params: {
                    page,
                    per_page: 250
                }
            });
            allSkills = [...allSkills, ...response.data.data];
            lastPage = response.data.meta.last_page;
            page++;
        } while (page <= lastPage);
        return allSkills;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // console.warn('Skills not found for event');
        } else {
            console.error('Error fetching skills:', error);
        }
        return [];
    }
};

export const getWorldSkillsForTeams = async (seasonId, teamIds) => {
    // The RobotEvents API v2 does not currently support bulk fetching of skills for specific teams
    // or a generic /skills endpoint that we can filter by team list efficiently.
    // Endpoints like /skills and /seasons/{id}/skills return 404.
    // To avoid errors, we return an empty list.
    console.warn('World Skills API not available for bulk fetch.');
    return [];
};


export const getActiveSeasons = async () => {
    const client = getClient();
    try {
        // Fetch all seasons that are currently marked as active
        const response = await client.get('/seasons', {
            params: { active: true }
        });
        return response.data.data;
    } catch (error) {
        console.error('Error fetching active seasons:', error);
        return [];
    }
};

// Search for a VEX Worlds Championship event by program and year.
// Used by the Worlds page to load the correct RobotEvents event without
// requiring a hardcoded SKU. Falls back gracefully if not found.
const PROGRAM_CODES = {
    'V5RC HS':  ['VRC', 'V5RC'],
    'V5RC MS':  ['VRC', 'V5RC'],
    'VURC':     ['VURC', 'VEXU'],
    'VIQRC ES': ['VIQRC', 'VIQC'],
    'VIQRC MS': ['VIQRC', 'VIQC'],
};

const PROGRAM_GRADE_KEYWORD = {
    'V5RC HS':  'high school',
    'V5RC MS':  'middle school',
    'VIQRC ES': 'elementary',
    'VIQRC MS': 'middle school',
};

export const findWorldsEvent = async (program, year) => {
    const client = getClient();
    try {
        const res = await client.get('/events', {
            params: {
                start: `${year}-04-01`,
                end:   `${year}-06-15`,
                per_page: 50,
            },
        });

        const events = res.data.data ?? [];
        const programCodes = PROGRAM_CODES[program] ?? PROGRAM_CODES['V5RC HS'];
        const gradeKeyword = PROGRAM_GRADE_KEYWORD[program] ?? null;

        // Filter to world-level events for the requested program family.
        // RobotEvents may also return local "Worlds Scrimmage" events in this range,
        // so we exclude scrimmages and prefer the official championship records.
        const worldEvents = events.filter((e) => {
            const name = e.name.toLowerCase();
            const code = (e.program?.code ?? '').toUpperCase();
            return programCodes.includes(code) && name.includes('world');
        });

        if (!worldEvents.length) return null;

        const nonScrimmageEvents = worldEvents.filter((e) => {
            const name = e.name.toLowerCase();
            return !name.includes('scrimmage');
        });

        const championshipEvents = nonScrimmageEvents.filter((e) => {
            const name = e.name.toLowerCase();
            return name.includes('world championship');
        });

        const candidates = championshipEvents.length
            ? championshipEvents
            : (nonScrimmageEvents.length ? nonScrimmageEvents : worldEvents);

        if (gradeKeyword) {
            const exactGradeMatch = candidates.find((e) =>
                e.name.toLowerCase().includes(gradeKeyword)
            );
            if (exactGradeMatch) return exactGradeMatch;
        }

        return [...candidates].sort((a, b) => {
            const aDivisions = a.divisions?.length ?? 0;
            const bDivisions = b.divisions?.length ?? 0;
            if (bDivisions !== aDivisions) return bDivisions - aDivisions;
            return new Date(b.start ?? 0) - new Date(a.start ?? 0);
        })[0] ?? null;
    } catch (err) {
        console.warn('[findWorldsEvent] failed:', err.message);
        return null;
    }
};

// Locate which division of a Worlds event a team belongs to. Used by the
// Find Team flow on the Worlds page so users don't have to know the
// division up front.
//
// Strategy: resolve the team at the event (number is unique within the
// event's program family), then probe each division's match list with a
// team filter — the first non-empty division is the team's home. Falls
// back to rankings, which still indicates assignment if the schedule
// hasn't been posted yet.
export const findTeamDivisionAtEvent = async (event, teamNumber) => {
    if (!event?.id || !teamNumber) return null;
    const client = getClient();
    const number = teamNumber.trim().toUpperCase();
    if (!number) return null;

    let team = null;
    try {
        const res = await client.get(`/events/${event.id}/teams`, {
            params: { 'number[]': [number], per_page: 5 },
        });
        const list = res.data?.data ?? [];
        team = list.find((t) => (t.number ?? '').toUpperCase() === number) ?? list[0] ?? null;
    } catch {
        // ignore — team lookup failures fall through to "not found"
    }
    if (!team) return null;

    const divisions = event.divisions ?? [];
    if (!divisions.length) return { team, division: null };

    const probe = async (path) => Promise.all(divisions.map(async (d) => {
        try {
            const r = await client.get(
                `/events/${event.id}/divisions/${d.id}/${path}`,
                { params: { 'team[]': [team.id], per_page: 1 } }
            );
            return (r.data?.data ?? []).length > 0 ? d : null;
        } catch {
            return null;
        }
    }));

    const matchHits = await probe('matches');
    let division = matchHits.find((d) => d !== null) ?? null;

    if (!division) {
        const rankingHits = await probe('rankings');
        division = rankingHits.find((d) => d !== null) ?? null;
    }

    return { team, division };
};

export const getEventsForTeam = async (teamId, seasonIds = null) => {
    const client = getClient();
    try {
        const params = {
            'team[]': teamId,
            per_page: 50
        };

        if (seasonIds) {
            // Allow passing a single ID or an array of IDs
            params['season[]'] = Array.isArray(seasonIds) ? seasonIds : [seasonIds];
        }

        const response = await client.get('/events', { params });

        return response.data.data;
    } catch (error) {
        console.error('Error fetching events for team:', error);
        throw new Error('Could not fetch events for team');
    }
};
