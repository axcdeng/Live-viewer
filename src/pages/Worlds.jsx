import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
    Tv, X, ArrowUpRight, Globe, ChevronDown,
    Loader, Play, Zap, Trophy, Users, Medal, Search,
} from 'lucide-react';
import WordPressHeader from '../components/WordPressHeader';
import { WORLDS_PROGRAMS, WORLDS_YEARS, getProgConfig } from '../data/worldsConfig';
import { fetchChannelBroadcasts, groupBroadcasts, resolveBroadcast, fetchBroadcastPlaylist } from '../services/boxcast';
import { getEventBySku, findWorldsEvent, getMatchesForEvent, getRankingsForEvent } from '../services/robotevents';

// ---------------------------------------------------------------------------
// HLS Video Player
// ---------------------------------------------------------------------------

function HlsPlayer({ src, seekTo }) {
    const videoRef = useRef(null);
    const hlsRef = useRef(null);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || !src) return;
        if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }

        if (Hls.isSupported()) {
            const hls = new Hls({ enableWorker: true, lowLatencyMode: false });
            hlsRef.current = hls;
            hls.loadSource(src);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
            hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) console.error('[HLS]', d.type, d.details); });
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = src;
            video.play().catch(() => {});
        }
        return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
    }, [src]);

    useEffect(() => {
        if (!seekTo || seekTo <= 0) return;
        const video = videoRef.current;
        if (!video) return;
        const doSeek = () => { video.currentTime = seekTo; video.play().catch(() => {}); };
        if (video.readyState >= 1) doSeek();
        else video.addEventListener('loadedmetadata', doSeek, { once: true });
    }, [seekTo]);

    return <video ref={videoRef} controls className="w-full h-full bg-black" style={{ display: 'block' }} />;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SelectField({ label, value, onChange, options }) {
    return (
        <div className="space-y-1.5">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1 block">{label}</label>
            <div className="relative group">
                <select
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all appearance-none cursor-pointer hover:border-gray-600"
                >
                    {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover:text-[#4FCEEC] transition-colors">
                    <ChevronDown className="w-4 h-4" />
                </div>
            </div>
        </div>
    );
}

// Match card — exact same style as Viewer's Matches tab
function MatchCard({ match, onJump, canJump, highlightTeam }) {
    const matchName = match.name?.replace(/teamwork/gi, 'Qual') || match.name;
    const timeStr = match.started
        ? new Date(match.started).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : match.scheduled
        ? new Date(match.scheduled).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : null;

    const isSearchedTeam = (t) => {
        if (!highlightTeam) return false;
        return (t.team?.number || '').toLowerCase().includes(highlightTeam.toLowerCase());
    };

    return (
        <div className="bg-black border border-gray-800 hover:border-gray-600 rounded-lg p-3 transition-colors">
            <div className="flex justify-between items-start mb-2">
                <div>
                    <span className="font-bold text-[#4FCEEC]">{matchName}</span>
                    {timeStr && <span className="text-gray-500 text-xs ml-2">{timeStr}</span>}
                </div>
                <div className="flex gap-1">
                    <button
                        onClick={() => onJump(match)}
                        disabled={!canJump || !match.started}
                        className={`p-1.5 rounded-md transition-colors ${canJump && match.started
                            ? 'bg-[#4FCEEC]/10 text-[#4FCEEC] hover:bg-[#4FCEEC]/20'
                            : 'text-gray-700 cursor-not-allowed'
                        }`}
                        title={canJump && match.started ? 'Jump to match' : 'Jump unavailable'}
                    >
                        <Play className="w-3 h-3 fill-current" />
                    </button>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-xs">
                {match.alliances?.map((alliance) => (
                    <div key={alliance.color} className={`flex flex-col ${alliance.color === 'red' ? 'text-red-400' : 'text-blue-400'}`}>
                        <div className="flex items-end border-b border-gray-800 pb-1 mb-1">
                            <span className="font-mono text-lg font-bold opacity-90">
                                {alliance.score !== undefined && alliance.score !== null ? alliance.score : '—'}
                            </span>
                        </div>
                        <div className="flex flex-col gap-0.5">
                            {alliance.teams?.map((t) => (
                                <span
                                    key={t.team?.id ?? Math.random()}
                                    className={`${isSearchedTeam(t) ? 'bg-white/10 rounded px-1 -mx-1 font-bold text-white' : ''}`}
                                >
                                    {t.team?.number || t.team?.name || '—'}
                                </span>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TeamCard({ ranking, onSelect }) {
    // Rankings API returns team.name = team number (e.g. "63936D"), no separate team_name
    const teamNum = ranking.team?.name || ranking.team?.number || '—';
    return (
        <button
            onClick={() => onSelect && onSelect(teamNum)}
            className="w-full text-left bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-lg p-3 flex items-center justify-between group transition-all"
        >
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <span className="font-bold text-[#4FCEEC]">{teamNum}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><Trophy className="w-3 h-3" /> #{ranking.rank}</span>
                    <span className="text-green-400">{ranking.wins}W</span>
                    <span className="text-red-400">{ranking.losses}L</span>
                    <span>{ranking.ties}T</span>
                </div>
            </div>
            <Search className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </button>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Worlds() {
    const [showAppBanner, setShowAppBanner] = useState(true);

    // Selectors
    const [program, setProgram] = useState('V5RC HS');
    const [year, setYear] = useState('2026');
    const [selectedDivName, setSelectedDivName] = useState(null);
    const [selectedDayIdx, setSelectedDayIdx] = useState(0);

    // BoxCast data
    const [broadcasts, setBroadcasts] = useState({});
    const [broadcastsLoading, setBroadcastsLoading] = useState(false);

    // HLS playlist
    const [playlist, setPlaylist] = useState(null);
    const [playlistLoading, setPlaylistLoading] = useState(false);

    // Seek
    const [seekTo, setSeekTo] = useState(0);

    // RobotEvents data
    const [worldsEvent, setWorldsEvent] = useState(null);
    const [eventLoading, setEventLoading] = useState(false);
    const [matches, setMatches] = useState([]);
    const [matchesLoading, setMatchesLoading] = useState(false);
    const [rankings, setRankings] = useState([]);
    const [rankingsLoading, setRankingsLoading] = useState(false);

    // Right panel tab: 'findTeam' | 'rankings' | 'matches'
    const [activeTab, setActiveTab] = useState('matches');

    // Find Team tab state
    const [findTeamInput, setFindTeamInput] = useState('');
    const [findTeamQuery, setFindTeamQuery] = useState('');

    // Rankings tab state
    const [rankSearch, setRankSearch] = useState('');
    const [rankSort, setRankSort] = useState('rank'); // 'rank' | 'number'

    // Matches tab state
    const [matchSearch, setMatchSearch] = useState('');
    const [matchFilter, setMatchFilter] = useState('all'); // 'all' | 'quals' | 'elim'

    const [error, setError] = useState(null);

    // ---------------------------------------------------------------------------
    // Derived
    // ---------------------------------------------------------------------------

    const progConfig = useMemo(() => getProgConfig(year, program), [year, program]);
    const divisionNames = progConfig?.divisions ?? [];
    const isConfigured = !!progConfig && divisionNames.length > 0;

    const currentBroadcast = useMemo(() => {
        if (!selectedDivName || !progConfig) return null;
        return resolveBroadcast(broadcasts, selectedDivName, selectedDayIdx, progConfig.broadcastOverrides);
    }, [broadcasts, selectedDivName, selectedDayIdx, progConfig]);

    const availableDays = useMemo(() => {
        if (!selectedDivName || !progConfig) return [];
        return Array.from({ length: progConfig.numDays ?? 3 }, (_, i) => ({
            dayIdx: i,
            label: `Day ${i + 1}`,
            hasBroadcast: !!(broadcasts[`${selectedDivName}-Day${i}`] || progConfig.broadcastOverrides?.[`${selectedDivName}-Day${i}`]),
        }));
    }, [broadcasts, selectedDivName, progConfig]);

    const canJump = !!currentBroadcast?.starts_at && !!playlist;

    // Filtered + sorted rankings for Rankings tab
    const filteredRankings = useMemo(() => {
        let list = rankings;
        if (rankSearch.trim()) {
            const q = rankSearch.trim().toLowerCase();
            list = list.filter(r =>
                (r.team?.name || r.team?.number || '').toLowerCase().includes(q)
            );
        }
        if (rankSort === 'number') {
            list = [...list].sort((a, b) =>
                (a.team?.name || a.team?.number || '').localeCompare(
                    b.team?.name || b.team?.number || '', undefined, { numeric: true }
                )
            );
        }
        // 'rank' is already the default order from the API
        return list;
    }, [rankings, rankSearch, rankSort]);

    // Filtered matches for Matches tab
    const filteredMatches = useMemo(() => {
        let list = matches;
        if (matchFilter === 'quals') {
            list = list.filter(m => {
                const n = m.name?.toLowerCase() ?? '';
                return n.includes('qual') || n.includes('practice') || n.includes('teamwork');
            });
        } else if (matchFilter === 'elim') {
            list = list.filter(m => {
                const n = m.name?.toLowerCase() ?? '';
                return !n.includes('qual') && !n.includes('practice') && !n.includes('teamwork');
            });
        }
        if (matchSearch.trim()) {
            const q = matchSearch.trim().toLowerCase();
            list = list.filter(m =>
                m.name?.toLowerCase().includes(q) ||
                m.alliances?.some(a => a.teams?.some(t =>
                    (t.team?.number || '').toLowerCase().includes(q)
                ))
            );
        }
        return list;
    }, [matches, matchFilter, matchSearch]);

    // Find Team tab: filter matches to only those containing the searched team
    const findTeamMatches = useMemo(() => {
        if (!findTeamQuery.trim()) return [];
        const q = findTeamQuery.trim().toLowerCase();
        return matches.filter(m =>
            m.alliances?.some(a => a.teams?.some(t =>
                (t.team?.number || t.team?.name || '').toLowerCase().includes(q)
            ))
        );
    }, [matches, findTeamQuery]);

    // ---------------------------------------------------------------------------
    // Effects
    // ---------------------------------------------------------------------------

    useEffect(() => {
        setSelectedDivName(null);
        setSelectedDayIdx(0);
        setBroadcasts({});
        setPlaylist(null);
        setSeekTo(0);
        setWorldsEvent(null);
        setMatches([]);
        setRankings([]);
        setError(null);
        if (!isConfigured) return;

        setBroadcastsLoading(true);
        fetchChannelBroadcasts(progConfig.channelId, year)
            .then((raw) => setBroadcasts(groupBroadcasts(raw, divisionNames)))
            .catch((err) => setError('Could not load broadcasts: ' + err.message))
            .finally(() => setBroadcastsLoading(false));

        const sku = progConfig.sku;
        setEventLoading(true);
        (sku ? getEventBySku(sku) : findWorldsEvent(program, year))
            .then((evt) => { if (evt) setWorldsEvent(evt); })
            .catch(() => {})
            .finally(() => setEventLoading(false));
    }, [program, year]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        setPlaylist(null);
        setSeekTo(0);
        if (!currentBroadcast?.id || !progConfig?.channelId) return;
        setPlaylistLoading(true);
        fetchBroadcastPlaylist(currentBroadcast.id, progConfig.channelId)
            .then((data) => { if (data.playlist) setPlaylist(data.playlist); })
            .catch((err) => setError('Could not load stream: ' + err.message))
            .finally(() => setPlaylistLoading(false));
    }, [currentBroadcast]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!selectedDivName || !worldsEvent) { setMatches([]); setRankings([]); return; }
        const reDivision = worldsEvent.divisions?.find((d) =>
            d.name.toLowerCase().includes(selectedDivName.toLowerCase())
        );
        if (!reDivision) return;
        const eventForDiv = { ...worldsEvent, divisions: [reDivision] };

        setMatchesLoading(true);
        getMatchesForEvent(eventForDiv)
            .then(setMatches)
            .catch((err) => setError('Could not load matches: ' + err.message))
            .finally(() => setMatchesLoading(false));

        setRankingsLoading(true);
        getRankingsForEvent(worldsEvent.id, [reDivision])
            .then(setRankings)
            .catch(() => {})
            .finally(() => setRankingsLoading(false));
    }, [selectedDivName, worldsEvent]);

    // ---------------------------------------------------------------------------
    // Handlers
    // ---------------------------------------------------------------------------

    const handleDivisionSelect = (name) => {
        if (selectedDivName === name) { setSelectedDivName(null); setSelectedDayIdx(0); return; }
        setSelectedDivName(name);
        setSelectedDayIdx(0);
        setSeekTo(0);
        setFindTeamQuery('');
        setFindTeamInput('');
        setMatchSearch('');
        setRankSearch('');
        setMatches([]);
        setRankings([]);
    };

    const handleDaySelect = (idx) => { setSelectedDayIdx(idx); setSeekTo(0); };

    const handleJumpToMatch = useCallback((match) => {
        if (!canJump || !match.started) return;
        const sec = Math.max(0, Math.floor(
            (new Date(match.started).getTime() - new Date(currentBroadcast.starts_at).getTime()) / 1000
        ));
        setSeekTo(sec || 0.001);
    }, [canJump, currentBroadcast]);

    // ---------------------------------------------------------------------------
    // Render helpers
    // ---------------------------------------------------------------------------

    const TabButton = ({ id, label }) => (
        <button
            onClick={() => setActiveTab(id)}
            className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${
                activeTab === id ? 'bg-gray-800 text-white shadow-sm' : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
            }`}
        >
            {label}
        </button>
    );

    // ---------------------------------------------------------------------------
    // Render
    // ---------------------------------------------------------------------------

    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-[#4FCEEC] selection:text-black flex flex-col">
            {showAppBanner && (
                <div className="relative bg-gray-900/80 border-b border-gray-800 flex-shrink-0">
                    <div className="px-10 py-2.5 flex items-center justify-center">
                        <span className="text-sm font-light text-gray-300">
                            <a href="https://apps.apple.com/us/app/streamhop-vex-match-jumper/id6759777314" target="_blank" rel="noopener noreferrer" className="text-[#4FCEEC] hover:underline inline-flex items-center gap-1">
                                VEX Jumper is on iOS <ArrowUpRight className="w-3.5 h-3.5" />
                            </a>
                            {' '}— no more typing URLs at events. Jump to matches right from your phone.
                        </span>
                    </div>
                    <button onClick={() => setShowAppBanner(false)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors" aria-label="Dismiss">
                        <X className="w-4 h-4" />
                    </button>
                </div>
            )}

            <header className="bg-gray-900 border-b border-gray-800 z-50 backdrop-blur-md bg-opacity-80 flex-shrink-0">
                <WordPressHeader />
            </header>

            {error && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-6 py-3 rounded-lg z-50 shadow-xl flex items-center gap-3">
                    <span className="text-sm">{error}</span>
                    <button onClick={() => setError(null)} className="font-bold hover:text-black">✕</button>
                </div>
            )}

            <main className="flex-1 w-full p-2 sm:p-4 sm:max-w-[1600px] sm:mx-auto">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full">

                    {/* ── Left Column ─────────────────────────────────────────── */}
                    <div className="xl:col-span-8 flex flex-col gap-6">

                        {/* Player */}
                        <div className="bg-gray-900 border border-gray-800 p-1 rounded-xl overflow-hidden flex-shrink-0">
                            <div className="bg-black rounded-lg overflow-hidden aspect-video relative group">
                                {playlist ? (
                                    <HlsPlayer src={playlist} seekTo={seekTo} />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <div className="text-center">
                                            {playlistLoading
                                                ? <Loader className="w-8 h-8 mx-auto mb-3 opacity-40 animate-spin" />
                                                : <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                            }
                                            <p className="text-sm">
                                                {!isConfigured ? `${year} schedule coming soon`
                                                    : playlistLoading ? 'Loading stream…'
                                                    : selectedDivName ? 'No stream found for this division / day'
                                                    : 'Select a division to load its stream'}
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {/* Day switcher overlay */}
                                {selectedDivName && availableDays.length > 1 && (
                                    <div className={`absolute top-4 right-4 flex gap-1.5 pointer-events-auto transition-opacity duration-300 ${playlist ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                                        {availableDays.map((d) => (
                                            <button
                                                key={d.dayIdx}
                                                onClick={() => handleDaySelect(d.dayIdx)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors backdrop-blur-md border ${
                                                    selectedDayIdx === d.dayIdx
                                                        ? 'bg-[#4FCEEC]/90 text-black border-[#4FCEEC]'
                                                        : d.hasBroadcast
                                                        ? 'bg-black/60 text-white border-gray-700 hover:bg-black/80'
                                                        : 'bg-black/40 text-gray-600 border-gray-800 cursor-default'
                                                }`}
                                                disabled={!d.hasBroadcast}
                                            >
                                                {d.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Division switcher */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-4">
                                <Globe className="w-5 h-5 text-[#4FCEEC]" />
                                <h2 className="text-lg font-bold text-white">Divisions</h2>
                                {broadcastsLoading && <Loader className="w-3.5 h-3.5 text-gray-500 animate-spin ml-1" />}
                                <span className="ml-auto text-xs text-gray-500 font-medium uppercase tracking-wider">{program} · {year}</span>
                            </div>
                            {!isConfigured ? (
                                <p className="text-sm text-gray-600 py-2">Division schedule for {year} will appear here once announced.</p>
                            ) : (
                                <div className={`grid gap-2 ${divisionNames.length <= 6 ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-5'}`}>
                                    {divisionNames.map((name) => (
                                        <button
                                            key={name}
                                            onClick={() => handleDivisionSelect(name)}
                                            className={`px-3 py-2.5 rounded-lg text-sm font-medium transition-all border ${
                                                selectedDivName === name
                                                    ? 'bg-[#4FCEEC] text-black border-[#4FCEEC] shadow-lg shadow-[#4FCEEC]/20'
                                                    : 'bg-black/40 text-gray-300 border-gray-700 hover:border-gray-500 hover:text-white'
                                            }`}
                                        >
                                            {name}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* ── Right Column ─────────────────────────────────────────── */}
                    <div className="xl:col-span-4 flex flex-col gap-4">

                        {/* Program / Year selectors */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden flex-shrink-0">
                            <div className="p-4 flex items-center gap-2 border-b border-gray-800">
                                <Globe className="w-4 h-4 text-gray-400" />
                                <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Worlds</h2>
                                {eventLoading && <Loader className="w-3 h-3 text-gray-600 animate-spin ml-auto" />}
                            </div>
                            <div className="p-4">
                                <div className="flex gap-3">
                                    <div className="flex-1">
                                        <SelectField label="Program" value={program} onChange={setProgram}
                                            options={WORLDS_PROGRAMS.map((p) => ({ value: p, label: p }))} />
                                    </div>
                                    <div className="w-28">
                                        <SelectField label="Year" value={year} onChange={setYear}
                                            options={WORLDS_YEARS.map((y) => ({ value: y, label: y }))} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Tab panel — always visible */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl flex flex-col flex-shrink-0">

                            {/* Tab bar */}
                            <div className="p-3 border-b border-gray-800">
                                <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg">
                                    <TabButton id="findTeam" label="Find Team" />
                                    <TabButton id="rankings" label="Rankings" />
                                    <TabButton id="matches" label="Matches" />
                                </div>
                            </div>

                            {/* ── Find Team tab ── */}
                            {activeTab === 'findTeam' && (
                                <>
                                    <div className="p-4 border-b border-gray-800 space-y-3">
                                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Find Team</h2>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={findTeamInput}
                                                onChange={(e) => setFindTeamInput(e.target.value)}
                                                placeholder="Team number (e.g., 8977A)"
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                                onKeyDown={(e) => e.key === 'Enter' && setFindTeamQuery(findTeamInput)}
                                            />
                                            <button
                                                onClick={() => setFindTeamQuery(findTeamInput)}
                                                disabled={!findTeamInput.trim() || !selectedDivName}
                                                className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm transition-colors"
                                            >
                                                Search
                                            </button>
                                        </div>
                                        {!selectedDivName && (
                                            <p className="text-xs text-gray-600">Select a division first to search for team matches.</p>
                                        )}
                                    </div>
                                    <div className="overflow-y-auto h-[520px] px-4 pb-4">
                                        {findTeamQuery && findTeamMatches.length > 0 ? (
                                            <div className="space-y-2 pt-4">
                                                <p className="text-xs text-gray-500 mb-3">{findTeamMatches.length} matches for <span className="text-[#4FCEEC] font-bold">{findTeamQuery.toUpperCase()}</span></p>
                                                {findTeamMatches.map((m) => (
                                                    <MatchCard key={m.id} match={m} canJump={canJump} onJump={handleJumpToMatch} highlightTeam={findTeamQuery} />
                                                ))}
                                            </div>
                                        ) : findTeamQuery ? (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                                                <p className="text-sm">No matches found for <span className="text-[#4FCEEC]">{findTeamQuery.toUpperCase()}</span>.</p>
                                            </div>
                                        ) : (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                                                <div className="p-3 bg-gray-800/50 rounded-full">
                                                    <Zap className="w-6 h-6 opacity-50" />
                                                </div>
                                                <p className="text-sm">Search for a team to see matches</p>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            {/* ── Rankings tab ── */}
                            {activeTab === 'rankings' && (
                                <>
                                    <div className="p-4 border-b border-gray-800 space-y-3">
                                        {/* Search */}
                                        <div className="flex items-center gap-2 bg-gray-800 px-3 py-2 rounded-lg">
                                            <Search className="w-4 h-4 text-gray-400 shrink-0" />
                                            <input
                                                type="text"
                                                placeholder="Search teams..."
                                                value={rankSearch}
                                                onChange={(e) => setRankSearch(e.target.value)}
                                                className="bg-transparent border-none focus:outline-none text-sm w-full text-white placeholder-gray-500"
                                            />
                                        </div>
                                        {/* Sort pills */}
                                        <div className="flex gap-2">
                                            <button
                                                onClick={() => setRankSort('rank')}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${rankSort === 'rank' ? 'bg-[#4FCEEC] text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                                            >
                                                <Trophy className="w-3 h-3" /> Rank
                                            </button>
                                            <button
                                                onClick={() => setRankSort('number')}
                                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${rankSort === 'number' ? 'bg-[#4FCEEC] text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}
                                            >
                                                <Users className="w-3 h-3" /> Default
                                            </button>
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto h-[520px] p-3 space-y-2">
                                        {!selectedDivName ? (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                                                <Trophy className="w-8 h-8 opacity-20" />
                                                <p className="text-sm">Select a division to view rankings.</p>
                                            </div>
                                        ) : rankingsLoading ? (
                                            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                                                <Loader className="w-4 h-4 animate-spin" />
                                                <span className="text-sm">Loading rankings…</span>
                                            </div>
                                        ) : filteredRankings.length === 0 ? (
                                            <p className="text-xs text-gray-600 text-center py-6">
                                                {rankSearch ? `No teams found for "${rankSearch}".` : `Rankings not yet published for ${selectedDivName}.`}
                                            </p>
                                        ) : (
                                            filteredRankings.map((r) => (
                                                <TeamCard
                                                    key={r.team?.id ?? r.rank}
                                                    ranking={r}
                                                    onSelect={(num) => {
                                                        setFindTeamInput(num);
                                                        setFindTeamQuery(num);
                                                        setActiveTab('findTeam');
                                                    }}
                                                />
                                            ))
                                        )}
                                    </div>
                                </>
                            )}

                            {/* ── Matches tab ── */}
                            {activeTab === 'matches' && (
                                <>
                                    <div className="p-4 border-b border-gray-800 space-y-3">
                                        <input
                                            type="text"
                                            value={matchSearch}
                                            onChange={(e) => setMatchSearch(e.target.value)}
                                            placeholder="Search matches (e.g. #10, QF, 1698A)"
                                            className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                        />
                                        <div className="flex gap-2">
                                            {['all', 'quals', 'elim'].map((f) => (
                                                <button
                                                    key={f}
                                                    onClick={() => setMatchFilter(f)}
                                                    className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                                                        matchFilter === f ? 'bg-[#4FCEEC] text-black' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                                                    }`}
                                                >
                                                    {f === 'quals' ? 'Quals' : f === 'elim' ? 'Elims' : 'All Matches'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="overflow-y-auto h-[520px] px-4 pb-4">
                                        {!selectedDivName ? (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500 space-y-2">
                                                <div className="p-3 bg-gray-800/50 rounded-full">
                                                    <Zap className="w-6 h-6 opacity-50" />
                                                </div>
                                                <p className="text-sm">Select a division to view matches.</p>
                                            </div>
                                        ) : matchesLoading ? (
                                            <div className="flex items-center justify-center py-8 gap-2 text-gray-500">
                                                <Loader className="w-4 h-4 animate-spin" />
                                                <span className="text-sm">Loading matches…</span>
                                            </div>
                                        ) : !worldsEvent && !eventLoading ? (
                                            <p className="text-xs text-gray-600 text-center py-6">Match data unavailable — event not found on RobotEvents.</p>
                                        ) : filteredMatches.length === 0 ? (
                                            <p className="text-xs text-gray-600 text-center py-6">No matches found.</p>
                                        ) : (
                                            <div className="space-y-2 pt-4">
                                                {filteredMatches.map((m) => (
                                                    <MatchCard key={m.id} match={m} canJump={canJump} onJump={handleJumpToMatch} highlightTeam={matchSearch} />
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
