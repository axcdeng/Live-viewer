import axios from 'axios';

const BASE_URL = 'https://www.robotevents.com/api/v2';
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

export const searchEvents = async (query) => {
    const client = getClient();
    // Check if it's a SKU
    const skuMatch = query.match(/(RE-[A-Z0-9]+-\d{2}-\d{4})/);
    if (skuMatch) {
        // Return as an array to match search results format
        try {
            const event = await getEventBySku(skuMatch[1]);
            return [event];
        } catch (e) {
            return [];
        }
    }

    // Search by name
    const response = await client.get('/events', {
        params: {
            name: query,
            per_page: 20
        },
    });

    const results = response.data.data || [];

    // Sort results to prioritize Signature events and relevance
    return results.sort((a, b) => {
        // 1. Prioritize exact name matches
        const aExact = a.name.toLowerCase() === query.toLowerCase();
        const bExact = b.name.toLowerCase() === query.toLowerCase();
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;

        // 2. Prioritize 'Signature' level
        const aSig = a.level === 'Signature';
        const bSig = b.level === 'Signature';
        if (aSig && !bSig) return -1;
        if (!aSig && bSig) return 1;

        // 3. Sort by date (newest first)
        return new Date(b.start) - new Date(a.start);
    });
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

