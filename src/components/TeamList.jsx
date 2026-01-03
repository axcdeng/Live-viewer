import React, { useState, useEffect } from 'react';
import { Users, Trophy, Medal, Globe, Loader, Search, AlertTriangle } from 'lucide-react';
import { getTeamsForEvent, getRankingsForEvent, getSkillsForEvent, getWorldSkillsForTeams } from '../services/robotevents';

const TeamList = ({ event, onTeamSelect, multiDivisionMode, divisionsFromPreset }) => {
    const [teams, setTeams] = useState([]);
    const [rankings, setRankings] = useState({});
    const [skills, setSkills] = useState({});
    const [worldSkills, setWorldSkills] = useState({});
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState('default'); // default, rank, skills, world_skills
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedDivisionId, setSelectedDivisionId] = useState(null);

    useEffect(() => {
        if (!event) return;
        loadData();
    }, [event]);

    const loadData = async () => {
        setLoading(true);
        try {
            // 1. Fetch Teams
            const teamsData = await getTeamsForEvent(event.id);
            setTeams(teamsData);

            // 2. Fetch Event Rankings
            // Pass event.divisions so the API can fetch from division-specific endpoints if needed
            const rankingsData = await getRankingsForEvent(event.id, event.divisions || []);
            const rankingsMap = {};
            rankingsData.forEach(r => {
                if (r.team) {
                    rankingsMap[r.team.id] = {
                        rank: r.rank,
                        wins: r.wins,
                        losses: r.losses,
                        ties: r.ties,
                        wp: r.wp,
                        ap: r.ap,
                        sp: r.sp,
                        division: r.division // Capture division info
                    };
                }
            });
            setRankings(rankingsMap);

            // 3. Fetch Event Skills
            const skillsData = await getSkillsForEvent(event.id);
            const skillsMap = {};
            skillsData.forEach(s => {
                if (s.team) {
                    // Skills endpoint returns multiple entries (driver, programming, etc.)
                    // We want the combined score usually, or the highest rank
                    // The API returns 'rank' field for combined skills entries
                    if (s.type === 'driver' || s.type === 'programming') return; // Skip individual if combined exists
                    // Actually, usually type is 'skills' for combined or we look for rank
                    // Let's just map by team ID and store the rank and score
                    if (!skillsMap[s.team.id] || s.score > skillsMap[s.team.id].score) {
                        skillsMap[s.team.id] = { rank: s.rank, score: s.score };
                    }
                }
            });
            // Re-process skills to ensure we have the best rank/score
            // Actually, the /skills endpoint lists all runs. We need to find the entry that represents the ranking.
            // Usually, RobotEvents returns a list where type='driver' or 'programming'.
            // Wait, there is a separate endpoint for skills rankings? No, /skills returns the list.
            // Let's assume the API returns ranked list or we sort it.
            // For now, let's just store the highest score found for the team.

            // Better approach: The /skills endpoint returns a list of skills runs. 
            // We need to aggregate them. Or maybe there is a /skills/rankings endpoint?
            // Checking RobotEvents API docs (mental check): /events/{id}/skills usually returns the list of skills runs.
            // Actually, let's just use the `rank` from the response if available, or sort by score.

            const skillsMapFinal = {};
            // Group by team
            const teamSkills = {};
            skillsData.forEach(s => {
                if (!s.team) return;
                if (!teamSkills[s.team.id]) teamSkills[s.team.id] = { driver: 0, programming: 0, score: 0 };
                if (s.type === 'driver') teamSkills[s.team.id].driver = Math.max(teamSkills[s.team.id].driver, s.score);
                if (s.type === 'programming') teamSkills[s.team.id].programming = Math.max(teamSkills[s.team.id].programming, s.score);
                teamSkills[s.team.id].score = teamSkills[s.team.id].driver + teamSkills[s.team.id].programming;
            });

            // Convert to map with score
            Object.keys(teamSkills).forEach(teamId => {
                skillsMapFinal[teamId] = { score: teamSkills[teamId].score };
            });
            setSkills(skillsMapFinal);


            // 4. Fetch World Skills (if season is available)
            if (event.season) {
                const teamIds = teamsData.map(t => t.id);
                const worldSkillsData = await getWorldSkillsForTeams(event.season.id, teamIds);
                const worldSkillsMap = {};
                worldSkillsData.forEach(ws => {
                    if (ws.team) {
                        // World skills data also needs aggregation or checking rank
                        // The /seasons/{id}/skills endpoint returns ranked entries if we don't filter?
                        // When filtering by team, we get their entries.
                        // We should look for the entry with the highest score/rank.
                        if (!worldSkillsMap[ws.team.id] || ws.rank < worldSkillsMap[ws.team.id].rank) {
                            worldSkillsMap[ws.team.id] = { rank: ws.rank, score: ws.score };
                        }
                    }
                });
                setWorldSkills(worldSkillsMap);
            }

        } catch (err) {
            console.error('Error loading team list data:', err);
        } finally {
            setLoading(false);
        }
    };

    const getSortedTeams = () => {
        let filtered = teams;

        // Division Filter
        if (multiDivisionMode && selectedDivisionId) {
            filtered = filtered.filter(t => rankings[t.id]?.division?.id === selectedDivisionId);
        }

        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            filtered = filtered.filter(t =>
                t.number.toLowerCase().includes(q) ||
                (t.team_name && t.team_name.toLowerCase().includes(q))
            );
        }

        switch (viewMode) {
            case 'rank':
                return [...filtered].sort((a, b) => {
                    const rankA = rankings[a.id]?.rank || 9999;
                    const rankB = rankings[b.id]?.rank || 9999;
                    return rankA - rankB;
                });
            case 'skills':
                return [...filtered].sort((a, b) => {
                    const scoreA = skills[a.id]?.score || 0;
                    const scoreB = skills[b.id]?.score || 0;
                    return scoreB - scoreA;
                });
            case 'world_skills':
                return [...filtered].sort((a, b) => {
                    const rankA = worldSkills[a.id]?.rank || 9999;
                    const rankB = worldSkills[b.id]?.rank || 9999;
                    return rankA - rankB;
                });
            default: // 'default' - sort by number
                return [...filtered].sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
        }
    };

    const sortedTeams = getSortedTeams();

    return (
        <div className="h-full flex flex-col bg-gray-900 text-white">
            {/* Header & Filters */}
            <div className="p-4 border-b border-gray-800 space-y-4">
                <div className="flex items-center gap-2 bg-gray-800 p-2 rounded-lg">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search teams..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="bg-transparent border-none focus:outline-none text-sm w-full text-white placeholder-gray-500"
                    />
                </div>

                {/* Division Filter */}
                {multiDivisionMode && event?.divisions?.length > 1 && (
                    <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
                        <button
                            onClick={() => setSelectedDivisionId(null)}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase whitespace-nowrap ${!selectedDivisionId
                                ? 'bg-white/10 text-white'
                                : 'text-gray-500 hover:text-gray-300'
                                }`}
                        >
                            All
                        </button>
                        {event.divisions.map((div) => (
                            <button
                                key={div.id}
                                onClick={() => setSelectedDivisionId(div.id)}
                                className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all uppercase whitespace-nowrap ${selectedDivisionId === div.id
                                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                                    : 'bg-gray-800/40 text-gray-500 border border-transparent hover:text-gray-400'
                                    }`}
                            >
                                {div.name}
                            </button>
                        ))}
                    </div>
                )}

                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <button
                        onClick={() => setViewMode('default')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${viewMode === 'default'
                            ? 'bg-[#4FCEEC] text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        <Users className="w-3 h-3" />
                        Default
                    </button>
                    <button
                        onClick={() => setViewMode('rank')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${viewMode === 'rank'
                            ? 'bg-[#4FCEEC] text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        <Trophy className="w-3 h-3" />
                        Rank
                    </button>
                    <button
                        onClick={() => setViewMode('skills')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${viewMode === 'skills'
                            ? 'bg-[#4FCEEC] text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        <Medal className="w-3 h-3" />
                        Skills
                    </button>
                    <button
                        onClick={() => setViewMode('world_skills')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${viewMode === 'world_skills'
                            ? 'bg-[#4FCEEC] text-black'
                            : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                            }`}
                    >
                        <Globe className="w-3 h-3" />
                        World Skills
                    </button>
                </div>
            </div>

            {/* Divisions from Preset Disclaimer */}
            {divisionsFromPreset && (
                <div className="mx-2 mt-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-orange-400 flex-shrink-0 mt-0.5" />
                    <div className="text-xs text-orange-300">
                        <span className="font-bold">Divisions not yet published.</span>
                        <span className="text-orange-400/80 ml-1">The official division assignments are not available from RobotEvents yet. Division filters may not work correctly until they are released.</span>
                    </div>
                </div>
            )}

            {/* Team List */}
            <div className="overflow-y-auto p-2 space-y-2 h-[600px]">
                {viewMode === 'world_skills' ? (
                    <div className="flex flex-col items-center justify-center h-64 text-center px-4">
                        <Globe className="w-12 h-12 text-gray-600 mb-4" />
                        <h3 className="text-lg font-medium text-gray-300 mb-2">Coming Soon!</h3>
                        <p className="text-sm text-gray-500">World Skills rankings are not yet available. Check back later!</p>
                    </div>
                ) : loading ? (
                    <div className="flex justify-center items-center h-32">
                        <Loader className="w-6 h-6 text-[#4FCEEC] animate-spin" />
                    </div>
                ) : sortedTeams.length === 0 ? (
                    <div className="text-center text-gray-500 py-8 text-sm">
                        No teams found
                    </div>
                ) : (
                    sortedTeams.map(team => {
                        const rankingData = rankings[team.id];
                        const skillScore = skills[team.id]?.score;
                        const worldRank = worldSkills[team.id]?.rank;

                        return (
                            <button
                                key={team.id}
                                onClick={() => onTeamSelect(team.number)}
                                className="w-full bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg p-3 flex items-center justify-between group transition-all text-left"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        {rankingData && viewMode === 'rank' && (
                                            <span className="text-sm font-medium text-gray-400 w-6">#{rankingData.rank}</span>
                                        )}
                                        <span className="font-bold text-[#4FCEEC]">{team.number}</span>
                                        <span className="text-xs text-gray-400 truncate max-w-[100px]">{team.team_name}</span>
                                        {multiDivisionMode && rankingData?.division && (
                                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-700 text-gray-400 uppercase tracking-tight">
                                                {rankingData.division.name}
                                            </span>
                                        )}
                                    </div>

                                    {/* Show ranking details when in rank view mode */}
                                    {viewMode === 'rank' && rankingData && (
                                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                                            <span className="flex items-center gap-0.5">
                                                <span className="text-gray-400">W-L-T:</span>
                                                <span className="text-gray-300">{rankingData.wins}-{rankingData.losses}-{rankingData.ties}</span>
                                            </span>
                                            <span className="text-gray-700">|</span>
                                            <span className="flex items-center gap-1">
                                                <span className="text-gray-400">WP:</span>
                                                <span className="text-gray-300">{rankingData.wp}</span>
                                                <span className="text-gray-700">/</span>
                                                <span className="text-gray-400">AP:</span>
                                                <span className="text-gray-300">{rankingData.ap}</span>
                                                <span className="text-gray-700">/</span>
                                                <span className="text-gray-400">SP:</span>
                                                <span className="text-gray-300">{rankingData.sp}</span>
                                            </span>
                                        </div>
                                    )}

                                    {/* Show other stats when NOT in rank view mode */}
                                    {viewMode !== 'rank' && (
                                        <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                                            {rankingData && (
                                                <span className="flex items-center gap-1">
                                                    <Trophy className="w-3 h-3" /> #{rankingData.rank}
                                                </span>
                                            )}
                                            {skillScore !== undefined && (
                                                <span className="flex items-center gap-1">
                                                    <Medal className="w-3 h-3" /> {skillScore}
                                                </span>
                                            )}
                                            {worldRank && (
                                                <span className="flex items-center gap-1">
                                                    <Globe className="w-3 h-3" /> #{worldRank}
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Search className="w-4 h-4 text-gray-400" />
                                </div>
                            </button>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default TeamList;
