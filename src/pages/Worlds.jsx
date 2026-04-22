import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Hls from 'hls.js';
import {
    Tv, Globe, ChevronDown,
    Loader, Play, Zap, Trophy, Users, Medal, Search,
    Rewind, FastForward, RotateCcw, RotateCw, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight, Info,
} from 'lucide-react';
import WordPressHeader from '../components/WordPressHeader';
import JumperMobileBanner from '../components/JumperMobileBanner';
import { WORLDS_PROGRAMS, WORLDS_YEARS, getProgConfig } from '../data/worldsConfig';
import { fetchChannelBroadcasts, groupBroadcasts, resolveBroadcast, fetchBroadcastPlaylist } from '../services/boxcast';
import { getEventBySku, findWorldsEvent, getMatchesForEvent, getRankingsForEvent } from '../services/robotevents';
import { getMatchDayIndex, inferMatchDayFromContext } from '../utils/streamMatching';
import { getWorldsSyncOffset, setWorldsSyncOffset, clearWorldsSyncOffset } from '../services/worldsSyncOffsets';

// ---------------------------------------------------------------------------
// HLS Video Player
// ---------------------------------------------------------------------------

const MATCH_TIME_SANITY_WINDOW_MS = 30 * 60 * 1000;

function getEffectiveMatchTimestamp(match) {
    const started = match?.started;
    const scheduled = match?.scheduled;

    if (started && scheduled) {
        const diff = Math.abs(new Date(started).getTime() - new Date(scheduled).getTime());
        return diff > MATCH_TIME_SANITY_WINDOW_MS ? scheduled : started;
    }

    return started || scheduled || null;
}

function compareMatchesChronologically(a, b) {
    const aTime = getEffectiveMatchTimestamp(a);
    const bTime = getEffectiveMatchTimestamp(b);

    if (aTime && bTime) {
        const timeDiff = new Date(aTime).getTime() - new Date(bTime).getTime();
        if (timeDiff !== 0) return timeDiff;
    } else if (aTime) {
        return -1;
    } else if (bTime) {
        return 1;
    }

    const roundDiff = (a.round ?? Number.MAX_SAFE_INTEGER) - (b.round ?? Number.MAX_SAFE_INTEGER);
    if (roundDiff !== 0) return roundDiff;

    const instanceDiff = (a.instance ?? Number.MAX_SAFE_INTEGER) - (b.instance ?? Number.MAX_SAFE_INTEGER);
    if (instanceDiff !== 0) return instanceDiff;

    const matchNumDiff = (a.matchnum ?? Number.MAX_SAFE_INTEGER) - (b.matchnum ?? Number.MAX_SAFE_INTEGER);
    if (matchNumDiff !== 0) return matchNumDiff;

    return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
}

function getWorldsMatchDayIndex(match, allMatches, eventStartDate) {
    const matchTime = getEffectiveMatchTimestamp(match);
    if (matchTime && eventStartDate) {
        return getMatchDayIndex(matchTime, eventStartDate);
    }
    return inferMatchDayFromContext(match, allMatches, eventStartDate);
}

function groupMatchesByDay(list, allMatches, eventStartDate, dayLabels = []) {
    const matchesByDay = {};

    [...list].sort(compareMatchesChronologically).forEach((match) => {
        const dayIndex = getWorldsMatchDayIndex(match, allMatches, eventStartDate);
        if (!matchesByDay[dayIndex]) matchesByDay[dayIndex] = [];
        matchesByDay[dayIndex].push(match);
    });

    return Object.keys(matchesByDay)
        .map((dayIndex) => {
            const idx = Number(dayIndex);
            return {
                dayIndex: idx,
                label: dayLabels.find((d) => d.dayIdx === idx)?.label || `Day ${idx + 1}`,
                matches: matchesByDay[dayIndex],
            };
        })
        .sort((a, b) => a.dayIndex - b.dayIndex);
}

function formatOffsetInputValue(totalSeconds) {
    const absSeconds = Math.max(0, Math.round(totalSeconds));
    const minutes = Math.floor(absSeconds / 60);
    const seconds = absSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseOffsetInputValue(value) {
    const trimmed = value.trim();
    if (!trimmed) return 0;

    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed);
    }

    const parts = trimmed.split(':');
    if (parts.length !== 2 || !/^\d+$/.test(parts[0]) || !/^\d{1,2}$/.test(parts[1])) {
        return null;
    }

    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (seconds >= 60) return null;

    return (minutes * 60) + seconds;
}

function formatOffsetSummary(offsetSeconds) {
    if (!offsetSeconds) return '00:00';
    return `${offsetSeconds > 0 ? '+' : '-'}${formatOffsetInputValue(Math.abs(offsetSeconds))}`;
}

function truncateLabel(label, maxLength = 26) {
    if (!label) return '';
    return label.length > maxLength ? `${label.slice(0, maxLength - 1)}…` : label;
}

function HlsPlayer({ src, seekRequest, mediaRef }) {
    const fallbackVideoRef = useRef(null);
    const videoRef = mediaRef ?? fallbackVideoRef;
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
        if (!seekRequest || seekRequest.time <= 0) return;
        const video = videoRef.current;
        if (!video) return;
        const doSeek = () => { video.currentTime = seekRequest.time; video.play().catch(() => {}); };
        if (video.readyState >= 1) doSeek();
        else video.addEventListener('loadedmetadata', doSeek, { once: true });
    }, [seekRequest]);

    return <video ref={videoRef} controls className="w-full h-full bg-black" style={{ display: 'block' }} />;
}

function PlaybackControls({ canControl, canSync, onSeek, onSynced }) {
    return (
        <div className={`flex items-center bg-black/40 border border-gray-800 rounded-xl p-1 px-1 transition-all duration-300 ${canControl ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(-60)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 1m">
                    <Rewind className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">1M</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(-30)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 30s">
                    <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">30S</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(-10)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 10s">
                    <RotateCcw className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">10S</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(-5)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 5s">
                    <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">5S</span>
            </div>

            <div className="h-4 w-px bg-gray-800 mx-1" />

            <div className="flex flex-col items-center px-1">
                <button
                    onClick={onSynced}
                    disabled={!canSync}
                    className={`p-1 rounded-lg transition-colors ${canSync ? 'hover:bg-[#4FCEEC]/20 text-[#4FCEEC]' : 'text-[#4FCEEC]/35 cursor-not-allowed'}`}
                    title="Jump to Synced Start"
                >
                    <Play className="w-3.5 h-3.5 fill-current" />
                </button>
                <span className={`text-[7px] font-bold uppercase tracking-wider -mt-0.5 pointer-events-none ${canSync ? 'text-[#4FCEEC]/70' : 'text-[#4FCEEC]/35'}`}>Synced</span>
            </div>

            <div className="h-4 w-px bg-gray-800 mx-1" />

            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(5)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 5s">
                    <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">5S</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(10)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 10s">
                    <RotateCw className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">10S</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(30)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 30s">
                    <ChevronsRight className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">30S</span>
            </div>
            <div className="flex flex-col items-center">
                <button onClick={() => onSeek(60)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 1m">
                    <FastForward className="w-3.5 h-3.5" />
                </button>
                <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">1M</span>
            </div>
        </div>
    );
}

function HoverInfoCard({ title, body, className = '' }) {
    return (
        <div className={`relative group/info ${className}`}>
            <button
                type="button"
                className="rounded-full p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-[#4FCEEC]"
                aria-label={title}
            >
                <Info className="w-3.5 h-3.5" />
            </button>
            <div className="pointer-events-none absolute right-0 bottom-full z-[120] mb-3 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-800 bg-[#0b1220] p-3 text-left shadow-2xl shadow-black/50 opacity-0 translate-y-1 transition-all duration-150 group-hover/info:pointer-events-auto group-hover/info:opacity-100 group-hover/info:translate-y-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#4FCEEC]">{title}</div>
                <div className="mt-1 text-xs leading-5 text-gray-300">{body}</div>
            </div>
        </div>
    );
}

function SyncCalibrationStrip({
    disabled,
    offsetSeconds,
    offsetInput,
    offsetDirection,
    offsetInputInvalid,
    onOffsetInputChange,
    onOffsetInputCommit,
    onOffsetDirectionChange,
    onOffsetReset,
    canCalibrate,
    calibrationLabel,
    onUseCurrentFrame,
}) {
    return (
        <div className={`space-y-3 transition-all duration-300 ${disabled ? 'opacity-40 pointer-events-none' : 'opacity-100'}`}>
            <div className="flex flex-wrap items-center gap-2.5">
                <div className="flex items-center gap-1.5 min-w-0 mr-1">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">Offset</span>
                    <HoverInfoCard
                        title="Offset Help"
                        body="Use this when every jump is consistently off by about the same amount. Use + when the stream needs a positive correction and - when it needs a negative correction."
                    />
                </div>

                <div className="flex items-center rounded-lg border border-gray-800 bg-black/50 p-0.5 shrink-0">
                    <button
                        onClick={() => onOffsetDirectionChange('later')}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${offsetDirection === 'later' ? 'bg-[#4FCEEC] text-black' : 'text-gray-500 hover:text-white'}`}
                        title="Later offset"
                    >
                        Later
                    </button>
                    <button
                        onClick={() => onOffsetDirectionChange('earlier')}
                        className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors ${offsetDirection === 'earlier' ? 'bg-[#4FCEEC] text-black' : 'text-gray-500 hover:text-white'}`}
                        title="Earlier offset"
                    >
                        Earlier
                    </button>
                    <button
                        onClick={onOffsetReset}
                        className={`ml-1 flex h-7 w-7 items-center justify-center rounded-md transition-colors ${offsetSeconds ? 'text-gray-400 hover:bg-gray-800 hover:text-white' : 'text-gray-700 cursor-not-allowed'}`}
                        title="Reset offset"
                        aria-label="Reset offset"
                        disabled={!offsetSeconds}
                    >
                        <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                </div>

                <input
                    type="text"
                    value={offsetInput}
                    onChange={(e) => onOffsetInputChange(e.target.value)}
                    onBlur={onOffsetInputCommit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            e.currentTarget.blur();
                        }
                    }}
                    inputMode="numeric"
                    placeholder="00:00"
                    className={`h-9 w-20 rounded-lg border px-2 text-xs font-semibold text-center outline-none transition-colors shrink-0 ${offsetInputInvalid ? 'border-red-500 bg-red-500/10 text-red-100' : 'border-gray-800 bg-black/50 text-white focus:border-[#4FCEEC]'}`}
                />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-800/80 pt-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-500">Calibrate</span>
                        <HoverInfoCard
                            title="Calibration Help"
                            body="Best method: jump to a match, scrub to the real start in the video, then press Use Current Frame. That saves the correction for this division and day."
                        />
                    </div>
                    <p className="mt-1 text-xs text-gray-300">
                        {canCalibrate ? `Ready to calibrate with ${truncateLabel(calibrationLabel, 40)}.` : calibrationLabel}
                    </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    {offsetInputInvalid && (
                        <span className="text-[11px] font-medium text-red-300">Use `mm:ss`</span>
                    )}
                    <HoverInfoCard
                        title="Quick Reminder"
                        body="1. Jump to a match. 2. Drag the video to the real start. 3. Press Use Current Frame once. After that, later jumps on this stream should land much closer."
                    />
                    <button
                        onClick={onUseCurrentFrame}
                        disabled={!canCalibrate}
                        className={`rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-colors shrink-0 ${canCalibrate ? 'bg-[#4FCEEC] text-black hover:bg-[#3db8d6]' : 'bg-gray-900 text-gray-600 cursor-not-allowed'}`}
                    >
                        Use Current Frame
                    </button>
                </div>
            </div>
        </div>
    );
}

function InlineSelectField({ value, onChange, options, className = '' }) {
    return (
        <div className={`relative group ${className}`}>
            <select
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2.5 pr-9 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all appearance-none cursor-pointer hover:border-gray-600"
            >
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-500 group-hover:text-[#4FCEEC] transition-colors">
                <ChevronDown className="w-4 h-4" />
            </div>
        </div>
    );
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
    const matchTime = getEffectiveMatchTimestamp(match);
    const timeStr = matchTime
        ? new Date(matchTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        : null;

    const isSearchedTeam = (t) => {
        if (!highlightTeam) return false;
        return (t.team?.number || t.team?.name || '').toLowerCase().includes(highlightTeam.toLowerCase());
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
                        disabled={!canJump}
                        className={`p-1.5 rounded-md transition-colors ${canJump
                            ? 'bg-[#4FCEEC]/10 text-[#4FCEEC] hover:bg-[#4FCEEC]/20'
                            : 'text-gray-700 cursor-not-allowed'
                        }`}
                        title={canJump ? 'Jump to match' : 'Jump unavailable'}
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
    const teamNum = ranking.team?.name || ranking.team?.number || '—';
    const stats = [
        { label: 'WP', value: ranking.wp },
        { label: 'AP', value: ranking.ap },
        { label: 'SP', value: ranking.sp },
    ];

    return (
        <button
            onClick={() => onSelect && onSelect(teamNum)}
            className="w-full text-left bg-gray-800/50 hover:bg-gray-800 border border-gray-800 hover:border-gray-700 rounded-xl p-3.5 group transition-all"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <span className="font-bold text-lg text-[#4FCEEC] tracking-tight">{teamNum}</span>
                    </div>
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-black/40 border border-gray-700 px-2.5 py-1 text-[10px] font-medium text-gray-300">
                        <span className="text-gray-500">Record</span>
                        <span className="text-green-400">{ranking.wins}W</span>
                        <span className="text-red-400">{ranking.losses}L</span>
                        <span className="text-gray-400">{ranking.ties}T</span>
                    </div>
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-1.5 rounded-full bg-[#4FCEEC]/12 border border-[#4FCEEC]/30 px-2.5 py-1 text-[11px] font-semibold text-[#7ae3f7]">
                        <Trophy className="w-3 h-3" />
                        #{ranking.rank ?? '—'}
                    </div>
                    <Search className="w-4 h-4 text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
                {stats.map((stat) => (
                    <div
                        key={stat.label}
                        className="rounded-lg border border-gray-800 bg-black/35 px-2.5 py-2"
                    >
                        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                            {stat.label}
                        </div>
                        <div className="mt-0.5 text-sm font-semibold text-white">
                            {stat.value ?? '—'}
                        </div>
                    </div>
                ))}
            </div>
        </button>
    );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function Worlds() {
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
    const [seekRequest, setSeekRequest] = useState(null);
    const [pendingSeekRequest, setPendingSeekRequest] = useState(null);
    const [lastJumpContext, setLastJumpContext] = useState(null);
    const [activeOffsetSeconds, setActiveOffsetSeconds] = useState(0);
    const [offsetInput, setOffsetInput] = useState('00:00');
    const [offsetDirection, setOffsetDirection] = useState('later');
    const [offsetInputInvalid, setOffsetInputInvalid] = useState(false);
    const [isSyncCardOpen, setIsSyncCardOpen] = useState(true);
    const playerVideoRef = useRef(null);

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

    const eventStartDate = worldsEvent?.start || progConfig?.eventStart || null;
    const activeSyncTarget = useMemo(() => {
        if (!program || !year || !selectedDivName || selectedDayIdx === undefined || !currentBroadcast?.id) return null;
        return {
            program,
            year,
            divisionName: selectedDivName,
            dayIdx: selectedDayIdx,
            broadcastId: currentBroadcast.id,
        };
    }, [program, year, selectedDivName, selectedDayIdx, currentBroadcast?.id]);

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
        } else {
            list = [...list].sort((a, b) => {
                const aRank = Number.isFinite(a.rank) ? a.rank : Number.MAX_SAFE_INTEGER;
                const bRank = Number.isFinite(b.rank) ? b.rank : Number.MAX_SAFE_INTEGER;
                if (aRank !== bRank) return aRank - bRank;
                return (a.team?.name || a.team?.number || '').localeCompare(
                    b.team?.name || b.team?.number || '', undefined, { numeric: true }
                );
            });
        }
        return list;
    }, [rankings, rankSearch, rankSort]);

    // Filtered matches for Matches tab
    const filteredMatches = useMemo(() => {
        let list = [...matches];
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
                    (t.team?.number || t.team?.name || '').toLowerCase().includes(q)
                ))
            );
        }
        return list.sort(compareMatchesChronologically);
    }, [matches, matchFilter, matchSearch]);

    // Find Team tab: filter matches to only those containing the searched team
    const findTeamMatches = useMemo(() => {
        if (!findTeamQuery.trim()) return [];
        const q = findTeamQuery.trim().toLowerCase();
        return matches.filter(m =>
            m.alliances?.some(a => a.teams?.some(t =>
                (t.team?.number || t.team?.name || '').toLowerCase().includes(q)
            ))
        ).sort(compareMatchesChronologically);
    }, [matches, findTeamQuery]);

    const groupedFilteredMatches = useMemo(
        () => groupMatchesByDay(filteredMatches, matches, eventStartDate, availableDays),
        [filteredMatches, matches, eventStartDate, availableDays]
    );

    const groupedFindTeamMatches = useMemo(
        () => groupMatchesByDay(findTeamMatches, matches, eventStartDate, availableDays),
        [findTeamMatches, matches, eventStartDate, availableDays]
    );

    // ---------------------------------------------------------------------------
    // Effects
    // ---------------------------------------------------------------------------

    useEffect(() => {
        setSelectedDivName(null);
        setSelectedDayIdx(0);
        setBroadcasts({});
        setPlaylist(null);
        setSeekRequest(null);
        setPendingSeekRequest(null);
        setLastJumpContext(null);
        setActiveOffsetSeconds(0);
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
        setSeekRequest(null);
        if (!currentBroadcast?.id || !progConfig?.channelId) return;
        setPlaylistLoading(true);
        fetchBroadcastPlaylist(currentBroadcast.id, progConfig.channelId)
            .then((data) => { if (data.playlist) setPlaylist(data.playlist); })
            .catch((err) => setError('Could not load stream: ' + err.message))
            .finally(() => setPlaylistLoading(false));
    }, [currentBroadcast]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        const entry = activeSyncTarget ? getWorldsSyncOffset(activeSyncTarget) : null;
        setActiveOffsetSeconds(entry?.offsetSeconds ?? 0);
    }, [activeSyncTarget]);

    useEffect(() => {
        setOffsetDirection(activeOffsetSeconds >= 0 ? 'later' : 'earlier');
        setOffsetInput(formatOffsetInputValue(Math.abs(activeOffsetSeconds)));
        setOffsetInputInvalid(false);
    }, [activeOffsetSeconds]);

    useEffect(() => {
        if (!playlist || !currentBroadcast?.id || !pendingSeekRequest) return;
        if (pendingSeekRequest.broadcastId !== currentBroadcast.id) return;

        setSeekRequest({
            time: pendingSeekRequest.time,
            nonce: Date.now(),
        });
        setPendingSeekRequest(null);
    }, [playlist, currentBroadcast, pendingSeekRequest]);

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
        setSeekRequest(null);
        setPendingSeekRequest(null);
        setFindTeamQuery('');
        setFindTeamInput('');
        setMatchSearch('');
        setRankSearch('');
        setMatches([]);
        setRankings([]);
    };

    const handleDaySelect = (idx) => {
        setSelectedDayIdx(idx);
        setSeekRequest(null);
        setPendingSeekRequest(null);
    };

    const handleSeek = useCallback((seconds) => {
        const video = playerVideoRef.current;
        if (!video || !Number.isFinite(video.currentTime)) return;
        video.currentTime = Math.max(0, video.currentTime + seconds);
    }, []);

    const isSameSyncTarget = useCallback((a, b) => (
        !!a &&
        !!b &&
        a.program === b.program &&
        a.year === b.year &&
        a.divisionName === b.divisionName &&
        a.dayIdx === b.dayIdx &&
        a.broadcastId === b.broadcastId
    ), []);

    const getOffsetSecondsForTarget = useCallback((target) => {
        if (!target) return 0;
        if (isSameSyncTarget(target, activeSyncTarget)) return activeOffsetSeconds;
        return getWorldsSyncOffset(target)?.offsetSeconds ?? 0;
    }, [isSameSyncTarget, activeSyncTarget, activeOffsetSeconds]);

    const persistOffsetForTarget = useCallback((target, offsetSeconds, source) => {
        if (!target) return null;

        const normalizedSeconds = Math.round(offsetSeconds);
        if (normalizedSeconds === 0) {
            clearWorldsSyncOffset(target);
            if (isSameSyncTarget(target, activeSyncTarget)) {
                setActiveOffsetSeconds(0);
            }
            return null;
        }

        const entry = setWorldsSyncOffset(target, normalizedSeconds, source);
        if (entry && isSameSyncTarget(target, activeSyncTarget)) {
            setActiveOffsetSeconds(entry.offsetSeconds);
        }
        return entry;
    }, [isSameSyncTarget, activeSyncTarget]);

    const jumpToContext = useCallback((context) => {
        if (!context) return;

        const syncTarget = {
            program,
            year,
            divisionName: context.divisionName,
            dayIdx: context.dayIdx,
            broadcastId: context.broadcastId,
        };
        const offsetSeconds = getOffsetSecondsForTarget(syncTarget);
        const effectiveJumpSeconds = Math.max(0.001, context.baseJumpSeconds - offsetSeconds);
        const nextSeekRequest = {
            broadcastId: context.broadcastId,
            time: effectiveJumpSeconds,
        };

        if (
            selectedDivName !== context.divisionName ||
            selectedDayIdx !== context.dayIdx ||
            currentBroadcast?.id !== context.broadcastId ||
            !playlist
        ) {
            setPendingSeekRequest(nextSeekRequest);
            if (selectedDivName !== context.divisionName) setSelectedDivName(context.divisionName);
            if (selectedDayIdx !== context.dayIdx) setSelectedDayIdx(context.dayIdx);
            return;
        }

        setSeekRequest({
            time: nextSeekRequest.time,
            nonce: Date.now(),
        });
    }, [program, year, getOffsetSecondsForTarget, selectedDivName, selectedDayIdx, currentBroadcast, playlist]);

    const handleJumpToMatch = useCallback((match) => {
        if (!selectedDivName || !progConfig || !eventStartDate) return;

        const matchTime = getEffectiveMatchTimestamp(match);
        if (!matchTime || new Date(matchTime).getTime() > Date.now()) return;

        const targetDayIdx = getWorldsMatchDayIndex(match, matches, eventStartDate);
        const targetBroadcast = resolveBroadcast(
            broadcasts,
            selectedDivName,
            targetDayIdx,
            progConfig.broadcastOverrides
        );

        if (!targetBroadcast?.starts_at || !targetBroadcast?.id) return;

        const baseJumpSeconds = Math.max(
            0,
            Math.floor((new Date(matchTime).getTime() - new Date(targetBroadcast.starts_at).getTime()) / 1000)
        );
        const jumpContext = {
            matchId: match.id,
            matchLabel: match.name?.replace(/teamwork/gi, 'Qual') || match.name || 'Match',
            matchTimestamp: matchTime,
            broadcastId: targetBroadcast.id,
            divisionName: selectedDivName,
            dayIdx: targetDayIdx,
            baseJumpSeconds: baseJumpSeconds || 0.001,
        };
        setLastJumpContext(jumpContext);
        jumpToContext(jumpContext);
    }, [selectedDivName, progConfig, eventStartDate, matches, broadcasts, jumpToContext]);

    const handleJumpToSynced = useCallback(() => {
        if (!lastJumpContext) return;
        jumpToContext(lastJumpContext);
    }, [lastJumpContext, jumpToContext]);

    const canJumpToMatch = useCallback((match) => {
        if (!selectedDivName || !progConfig || !eventStartDate) return false;
        const matchTime = getEffectiveMatchTimestamp(match);
        if (!matchTime || new Date(matchTime).getTime() > Date.now()) return false;

        const targetDayIdx = getWorldsMatchDayIndex(match, matches, eventStartDate);
        const targetBroadcast = resolveBroadcast(
            broadcasts,
            selectedDivName,
            targetDayIdx,
            progConfig.broadcastOverrides
        );

        return !!targetBroadcast?.starts_at;
    }, [selectedDivName, progConfig, eventStartDate, matches, broadcasts]);

    const commitActiveOffsetInput = useCallback(() => {
        const parsedSeconds = parseOffsetInputValue(offsetInput);
        if (parsedSeconds === null) {
            setOffsetInputInvalid(true);
            return false;
        }

        const signedOffset = offsetDirection === 'later' ? parsedSeconds : -parsedSeconds;
        persistOffsetForTarget(activeSyncTarget, signedOffset, 'manual');
        setOffsetInputInvalid(false);
        return true;
    }, [offsetInput, offsetDirection, activeSyncTarget, persistOffsetForTarget]);

    const handleOffsetDirectionChange = useCallback((nextDirection) => {
        setOffsetDirection(nextDirection);
        const parsedSeconds = parseOffsetInputValue(offsetInput);
        if (parsedSeconds === null) {
            setOffsetInputInvalid(offsetInput.trim().length > 0);
            return;
        }

        const signedOffset = nextDirection === 'later' ? parsedSeconds : -parsedSeconds;
        persistOffsetForTarget(activeSyncTarget, signedOffset, 'manual');
        setOffsetInputInvalid(false);
    }, [offsetInput, activeSyncTarget, persistOffsetForTarget]);

    const handleOffsetReset = useCallback(() => {
        persistOffsetForTarget(activeSyncTarget, 0, 'manual');
        setOffsetInputInvalid(false);
    }, [activeSyncTarget, persistOffsetForTarget]);

    const canCalibrateCurrentFrame = !!(
        lastJumpContext &&
        playlist &&
        currentBroadcast?.id === lastJumpContext.broadcastId &&
        selectedDivName === lastJumpContext.divisionName &&
        selectedDayIdx === lastJumpContext.dayIdx
    );

    const handleUseCurrentFrameCalibration = useCallback(() => {
        if (!canCalibrateCurrentFrame || !lastJumpContext) return;

        const video = playerVideoRef.current;
        if (!video || !Number.isFinite(video.currentTime)) return;

        const calibrationTarget = {
            program,
            year,
            divisionName: lastJumpContext.divisionName,
            dayIdx: lastJumpContext.dayIdx,
            broadcastId: lastJumpContext.broadcastId,
        };
        const calibratedOffset = Math.round(lastJumpContext.baseJumpSeconds - video.currentTime);
        persistOffsetForTarget(calibrationTarget, calibratedOffset, 'calibrated');
        setOffsetInputInvalid(false);
    }, [canCalibrateCurrentFrame, lastJumpContext, program, year, persistOffsetForTarget]);

    const calibrationLabel = canCalibrateCurrentFrame
        ? lastJumpContext?.matchLabel
        : lastJumpContext
        ? 'Jump back to that stream to calibrate'
        : 'Jump to a match first';
    const syncCardSummary = activeSyncTarget
        ? formatOffsetSummary(activeOffsetSeconds)
        : 'Choose a division first';

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
            <JumperMobileBanner />

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
                                    <HlsPlayer src={playlist} seekRequest={seekRequest} mediaRef={playerVideoRef} />
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

                                {selectedDivName && (
                                    <div className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${playlist ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                                        {availableDays.length > 1 && (
                                            <div className="absolute top-4 right-4 flex gap-2 pointer-events-auto">
                                                {availableDays.map((d) => (
                                                    <button
                                                        key={d.dayIdx}
                                                        onClick={() => handleDaySelect(d.dayIdx)}
                                                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors backdrop-blur-md ${
                                                            selectedDayIdx === d.dayIdx
                                                                ? 'bg-[#4FCEEC]/90 text-black'
                                                                : 'bg-black/60 text-white hover:bg-black/80'
                                                        } ${!d.hasBroadcast ? 'opacity-50' : ''}`}
                                                        disabled={!d.hasBroadcast}
                                                    >
                                                        {d.label}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
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
                                <div className="ml-auto">
                                    <PlaybackControls
                                        canControl={!!playlist}
                                        canSync={!!lastJumpContext}
                                        onSeek={handleSeek}
                                        onSynced={handleJumpToSynced}
                                    />
                                </div>
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
                        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 flex-shrink-0">
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 shrink-0">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Worlds</h2>
                                    {eventLoading && <Loader className="w-3 h-3 text-gray-600 animate-spin" />}
                                </div>
                                <InlineSelectField
                                    value={program}
                                    onChange={setProgram}
                                    options={WORLDS_PROGRAMS.map((p) => ({ value: p, label: p }))}
                                    className="flex-1 min-w-0"
                                />
                                <InlineSelectField
                                    value={year}
                                    onChange={setYear}
                                    options={WORLDS_YEARS.map((y) => ({ value: y, label: y }))}
                                    className="w-28 shrink-0"
                                />
                            </div>
                        </div>

                        {/* Sync calibration */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl flex-shrink-0 overflow-visible">
                            <button
                                onClick={() => setIsSyncCardOpen((open) => !open)}
                                className="w-full px-4 py-3.5 flex items-center justify-between gap-3 hover:bg-gray-800/40 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0 text-left">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Sync Calibration</h2>
                                            <HoverInfoCard
                                                title="How Sync Works"
                                                body="If your jumps are always early or late by about the same amount, save that correction here. For best results: jump to a match, scrub to the real start, then press Use Current Frame once."
                                                className="-mr-1"
                                            />
                                        </div>
                                        <p className="text-xs text-gray-500 mt-1">
                                            {syncCardSummary}
                                            {activeSyncTarget ? ` • ${selectedDivName} • Day ${selectedDayIdx + 1}` : ''}
                                        </p>
                                    </div>
                                </div>
                                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${isSyncCardOpen ? 'rotate-180' : ''}`} />
                            </button>

                            {isSyncCardOpen && (
                                <div className="border-t border-gray-800 px-4 py-3.5 overflow-visible">
                                    <SyncCalibrationStrip
                                        disabled={!activeSyncTarget}
                                        offsetSeconds={activeOffsetSeconds}
                                        offsetInput={offsetInput}
                                        offsetDirection={offsetDirection}
                                        offsetInputInvalid={offsetInputInvalid}
                                        onOffsetInputChange={setOffsetInput}
                                        onOffsetInputCommit={commitActiveOffsetInput}
                                        onOffsetDirectionChange={handleOffsetDirectionChange}
                                        onOffsetReset={handleOffsetReset}
                                        canCalibrate={canCalibrateCurrentFrame}
                                        calibrationLabel={calibrationLabel}
                                        onUseCurrentFrame={handleUseCurrentFrameCalibration}
                                    />
                                </div>
                            )}
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
                                            <div className="space-y-6 pt-4">
                                                <p className="text-xs text-gray-500 mb-3">{findTeamMatches.length} matches for <span className="text-[#4FCEEC] font-bold">{findTeamQuery.toUpperCase()}</span></p>
                                                {groupedFindTeamMatches.map((group) => (
                                                    <div key={group.dayIndex}>
                                                        <div className="flex items-center gap-2 mb-2 sticky top-0 bg-gray-900/95 backdrop-blur py-2 z-10 -mx-4 px-4">
                                                            <div className="flex-1 h-px bg-gray-700"></div>
                                                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                                                                {group.label}
                                                            </span>
                                                            <div className="flex-1 h-px bg-gray-700"></div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {group.matches.map((m) => (
                                                                <MatchCard
                                                                    key={m.id}
                                                                    match={m}
                                                                    canJump={canJumpToMatch(m)}
                                                                    onJump={handleJumpToMatch}
                                                                    highlightTeam={findTeamQuery}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
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
                                            <div className="space-y-6 pt-4">
                                                {groupedFilteredMatches.map((group) => (
                                                    <div key={group.dayIndex}>
                                                        <div className="flex items-center gap-2 mb-2 sticky top-0 bg-gray-900/95 backdrop-blur py-2 z-10 -mx-4 px-4">
                                                            <div className="flex-1 h-px bg-gray-700"></div>
                                                            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                                                                {group.label}
                                                            </span>
                                                            <div className="flex-1 h-px bg-gray-700"></div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            {group.matches.map((m) => (
                                                                <MatchCard
                                                                    key={m.id}
                                                                    match={m}
                                                                    canJump={canJumpToMatch(m)}
                                                                    onJump={handleJumpToMatch}
                                                                    highlightTeam={matchSearch}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
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
