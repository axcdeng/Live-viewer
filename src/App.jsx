import React, { useState, useEffect, useRef } from 'react';
import { Settings, Play, RefreshCw, Loader, History, AlertCircle, X, Tv, Zap } from 'lucide-react';
import YouTube from 'react-youtube';
import { format } from 'date-fns';
import SettingsModal from './components/SettingsModal';
import WebcastSelector from './components/WebcastSelector';
import EventHistory from './components/EventHistory';
import { getEventBySku, getTeamByNumber, getMatchesForEventAndTeam } from './services/robotevents';
import { extractVideoId, getStreamStartTime } from './services/youtube';
import { findWebcastCandidates } from './services/webcastDetection';
import { getCachedWebcast, setCachedWebcast } from './services/eventCache';

function App() {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showEventHistory, setShowEventHistory] = useState(false);
    const [webcastCandidates, setWebcastCandidates] = useState([]);
    const [noWebcastsFound, setNoWebcastsFound] = useState(false);

    // Form inputs
    const [eventUrl, setEventUrl] = useState('');
    const [teamNumber, setTeamNumber] = useState('');

    // Data
    const [event, setEvent] = useState(null);
    const [team, setTeam] = useState(null);
    const [matches, setMatches] = useState([]);

    // Single-stream support
    const [webcastUrl, setWebcastUrl] = useState('');
    const [videoId, setVideoId] = useState(null);
    const [streamStartTime, setStreamStartTime] = useState(null);
    const [player, setPlayer] = useState(null);

    // Loading states
    const [eventLoading, setEventLoading] = useState(false);
    const [teamLoading, setTeamLoading] = useState(false);
    const [error, setError] = useState('');

    // Sync state
    const [syncMode, setSyncMode] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState(null);

    // Check for API key on mount
    useEffect(() => {
        const key = localStorage.getItem('robotevents_api_key');
        if (!key) {
            setIsSettingsOpen(true);
        }
    }, []);

    // Update videoId when URL changes
    useEffect(() => {
        if (webcastUrl) {
            const id = extractVideoId(webcastUrl);
            setVideoId(id);
        } else {
            setVideoId(null);
        }
    }, [webcastUrl]);

    // Auto-sync when videoId changes
    useEffect(() => {
        const fetchStartTime = async () => {
            if (videoId) {
                try {
                    const start = await getStreamStartTime(videoId);
                    if (start) {
                        setStreamStartTime(new Date(start).getTime());
                    }
                } catch (error) {
                    console.error('Error fetching stream start time:', error);
                }
            } else {
                setStreamStartTime(null);
            }
        };
        fetchStartTime();
    }, [videoId]);

    const handleEventSearch = async () => {
        if (!eventUrl.trim()) {
            setError('Please enter an event URL');
            return;
        }

        setEventLoading(true);
        setError('');
        setNoWebcastsFound(false);

        try {
            const skuMatch = eventUrl.match(/(RE-[A-Z0-9]+-\d{2}-\d{4})/);
            if (!skuMatch) {
                throw new Error('Invalid RobotEvents URL. Could not find SKU.');
            }
            const sku = skuMatch[1];
            const foundEvent = await getEventBySku(sku);
            setEvent(foundEvent);

            // Webcast detection
            const candidates = await findWebcastCandidates(foundEvent);
            if (candidates.length > 0) {
                setWebcastCandidates(candidates);
                // Auto-select first if only one direct video
                const directVideos = candidates.filter(c => c.type === 'direct-video');
                if (directVideos.length === 1) {
                    handleWebcastSelect(directVideos[0].videoId, directVideos[0].url, 'auto');
                }
            } else {
                setNoWebcastsFound(true);
                // Check cache
                const cached = getCachedWebcast(foundEvent.id);
                if (cached) {
                    setWebcastUrl(cached.url);
                }
            }

        } catch (err) {
            setError(err.message);
        } finally {
            setEventLoading(false);
        }
    };

    const handleWebcastSelect = (selectedVideoId, selectedUrl, method) => {
        setWebcastUrl(selectedUrl);
        if (event) {
            setCachedWebcast(event.id, selectedVideoId, selectedUrl, method);
        }
        setNoWebcastsFound(false);
        setWebcastCandidates([]);
    };

    const handleTeamSearch = async () => {
        if (!event) {
            setError('Please find an event first');
            return;
        }

        if (!teamNumber.trim()) {
            setError('Please enter a team number');
            return;
        }

        setTeamLoading(true);
        setError('');

        try {
            const foundTeam = await getTeamByNumber(teamNumber);
            setTeam(foundTeam);

            let foundMatches = await getMatchesForEventAndTeam(event.id, foundTeam.id);
            if (foundMatches.length === 0) {
                throw new Error('No matches found for this team at this event.');
            }

            // Sort: played matches first (oldest to newest), then unplayed matches
            foundMatches = foundMatches.sort((a, b) => {
                const aStarted = a.started ? new Date(a.started).getTime() : null;
                const bStarted = b.started ? new Date(b.started).getTime() : null;

                if (aStarted && bStarted) return aStarted - bStarted;
                if (aStarted && !bStarted) return -1;
                if (!aStarted && bStarted) return 1;
                return 0;
            });

            setMatches(foundMatches);
        } catch (err) {
            setError(err.message);
        } finally {
            setTeamLoading(false);
        }
    };

    const handleManualSync = (match) => {
        if (!player) {
            alert('No player found. Load the stream first.');
            return;
        }

        const currentVideoTimeSec = player.getCurrentTime();
        const matchStartTimeMs = new Date(match.started).getTime();
        const calculatedStreamStart = matchStartTimeMs - (currentVideoTimeSec * 1000);

        setStreamStartTime(calculatedStreamStart);
        setSyncMode(false);
    };

    const jumpToMatch = (match) => {
        if (!player) {
            alert('No player found. Load the stream first.');
            return;
        }

        if (!streamStartTime) {
            alert('Please sync this stream first!');
            return;
        }

        const matchStartMs = new Date(match.started).getTime();
        const seekTimeSec = (matchStartMs - streamStartTime) / 1000;

        if (seekTimeSec < 0) {
            alert("This match happened before the stream started!");
            return;
        }

        player.seekTo(seekTimeSec, true);
        player.playVideo();
        setSelectedMatchId(match.id);
    };

    const adjustSync = (seconds) => {
        if (!streamStartTime) return;
        setStreamStartTime(prev => prev + (seconds * 1000));
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-[#4FCEEC] selection:text-black">
            {/* Header */}
            <header className="bg-gray-900 border-b border-gray-800 p-4 sticky top-0 z-50 backdrop-blur-md bg-opacity-80">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="bg-[#4FCEEC] p-2 rounded-lg shadow-[0_0_15px_rgba(79,206,236,0.4)]">
                            <Zap className="w-6 h-6 text-black" />
                        </div>
                        <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-gray-400 bg-clip-text text-transparent">
                            VEX Match Jumper
                        </h1>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setShowEventHistory(true)}
                            className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
                            title="Event History"
                        >
                            <History className="w-5 h-5" />
                        </button>
                        <button
                            onClick={() => setIsSettingsOpen(true)}
                            className="p-2 hover:bg-gray-800 rounded-full transition-colors text-gray-400 hover:text-white"
                        >
                            <Settings className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </header>

            {/* Error Display */}
            {error && (
                <div className="max-w-4xl mx-auto mt-4 px-4">
                    <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg shadow-red-900/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p className="font-medium">{error}</p>
                        <button onClick={() => setError('')} className="ml-auto hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            <main className="max-w-4xl mx-auto p-4 space-y-6">
                {/* 1. Event Search */}
                <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4">
                    <h2 className="text-lg font-bold text-white">1. Find Event</h2>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={eventUrl}
                            onChange={(e) => setEventUrl(e.target.value)}
                            placeholder="Paste RobotEvents URL..."
                            className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                            onKeyDown={(e) => e.key === 'Enter' && handleEventSearch()}
                        />
                        <button
                            onClick={handleEventSearch}
                            disabled={eventLoading}
                            className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2"
                        >
                            {eventLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                        </button>
                    </div>
                    {event && (
                        <div className="p-3 bg-black border border-gray-700 rounded-lg">
                            <p className="text-white font-semibold">{event.name}</p>
                            <p className="text-xs text-gray-400">{event.location?.venue}, {event.location?.city}</p>
                        </div>
                    )}
                </div>

                {/* 2. Webcast Link */}
                {event && (
                    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4">
                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                            <Tv className="w-5 h-5 text-[#4FCEEC]" />
                            2. Livestream URL
                        </h2>

                        {webcastCandidates.length > 0 ? (
                            <WebcastSelector
                                candidates={webcastCandidates}
                                onSelect={handleWebcastSelect}
                                event={event}
                            />
                        ) : (
                            <>
                                <input
                                    type="text"
                                    value={webcastUrl}
                                    onChange={(e) => setWebcastUrl(e.target.value)}
                                    placeholder="https://www.youtube.com/watch?v=..."
                                    className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                />
                                {noWebcastsFound && (
                                    <p className="text-yellow-500 text-xs">
                                        No webcasts found automatically. Please paste the URL manually.
                                        Check <a href={`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${event.sku}.html#webcast`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">here</a>.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                )}

                {/* 3. YouTube Player */}
                {event && (
                    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4">
                        <h2 className="text-lg font-bold text-white">3. Stream</h2>
                        <div className="bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                            {videoId ? (
                                <YouTube
                                    videoId={videoId}
                                    opts={{
                                        height: '100%',
                                        width: '100%',
                                        playerVars: {
                                            autoplay: 0,
                                            modestbranding: 1,
                                        },
                                    }}
                                    onReady={(event) => setPlayer(event.target)}
                                    className="w-full h-full"
                                />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-slate-600">
                                    <div className="text-center">
                                        <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                        <p>Enter a stream URL above to watch</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* 4. Team Search */}
                {event && (
                    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4">
                        <h2 className="text-lg font-bold text-white">4. Find Team</h2>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={teamNumber}
                                onChange={(e) => setTeamNumber(e.target.value)}
                                placeholder="Team number (e.g., 11574A)"
                                className="flex-1 bg-black border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                onKeyDown={(e) => e.key === 'Enter' && handleTeamSearch()}
                            />
                            <button
                                onClick={handleTeamSearch}
                                disabled={teamLoading}
                                className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-6 py-3 rounded-lg font-bold transition-colors flex items-center gap-2"
                            >
                                {teamLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                            </button>
                        </div>
                        {team && (
                            <div className="p-3 bg-black border border-gray-700 rounded-lg">
                                <p className="text-white font-semibold">{team.number} - {team.team_name}</p>
                                <p className="text-xs text-gray-400">{team.organization}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Matches List */}
                {matches.length > 0 && (
                    <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold text-white">Matches</h2>
                            <div className="flex items-center gap-3">
                                <div className="flex items-center gap-2 text-xs">
                                    <div className={`w-2 h-2 rounded-full ${streamStartTime ? 'bg-[#4FCEEC] shadow-[0_0_8px_rgba(79,206,236,0.6)]' : 'bg-red-500'}`} />
                                    <span className="text-gray-400">{streamStartTime ? 'Synced' : 'Not Synced'}</span>
                                </div>
                                {streamStartTime && (
                                    <div className="flex gap-1">
                                        <button onClick={() => adjustSync(5)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">+5s</button>
                                        <button onClick={() => adjustSync(1)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">+1s</button>
                                        <button onClick={() => adjustSync(-1)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">-1s</button>
                                        <button onClick={() => adjustSync(-5)} className="px-2 py-1 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">-5s</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="space-y-2 max-h-96 overflow-y-auto">
                            {matches.map((match) => {
                                const hasStarted = !!match.started;
                                const alliance = match.alliances?.find(a => a.teams?.some(t => t.team?.id === team.id));
                                const matchName = match.name?.replace(/teamwork/gi, 'Qualification') || match.name;

                                return (
                                    <div
                                        key={match.id}
                                        className={`p-4 rounded-lg border transition-all ${selectedMatchId === match.id
                                            ? 'bg-[#4FCEEC]/20 border-[#4FCEEC]'
                                            : 'bg-black border-gray-800 hover:border-gray-700'
                                            }`}
                                    >
                                        <div className="flex justify-between items-center">
                                            <div className="flex-1">
                                                <h4 className="font-bold text-white">{matchName}</h4>
                                                <p className="text-xs text-gray-400">
                                                    {hasStarted ? format(new Date(match.started), 'h:mm a') : 'Not Yet Played'}
                                                </p>
                                            </div>
                                            {alliance && (
                                                <div className={`px-3 py-1 rounded text-xs font-bold uppercase mr-3 ${alliance.color === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
                                                    }`}>
                                                    {alliance.color}
                                                </div>
                                            )}
                                            {streamStartTime ? (
                                                <button
                                                    onClick={() => jumpToMatch(match)}
                                                    disabled={!hasStarted}
                                                    title={!hasStarted ? "Match hasn't been played yet" : ""}
                                                    className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 disabled:cursor-not-allowed text-black px-4 py-2 rounded-lg flex items-center gap-2 font-bold text-sm transition-colors"
                                                >
                                                    <Play className="w-4 h-4" /> JUMP
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => {
                                                        setSelectedMatchId(match.id);
                                                        setSyncMode(true);
                                                    }}
                                                    disabled={!hasStarted}
                                                    title={!hasStarted ? "Match hasn't been played yet" : "Sync to this match"}
                                                    className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg flex items-center gap-2 font-semibold text-sm transition-colors"
                                                >
                                                    <RefreshCw className="w-4 h-4" /> SYNC
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Sync Modal */}
                {syncMode && selectedMatchId && (
                    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
                        <div className="bg-gray-900 border-2 border-[#4FCEEC] p-8 rounded-2xl max-w-md text-center shadow-2xl shadow-[#4FCEEC]/20">
                            <h3 className="text-2xl font-bold text-[#4FCEEC] mb-4">Manual Sync</h3>
                            <p className="text-gray-300 mb-6">
                                Find the exact moment <strong className="text-white">{matches.find(m => m.id === selectedMatchId)?.name}</strong> starts in the video, then click SYNC NOW.
                            </p>
                            <div className="flex gap-3 justify-center">
                                <button
                                    onClick={() => handleManualSync(matches.find(m => m.id === selectedMatchId))}
                                    className="bg-[#4FCEEC] hover:bg-[#3db8d6] text-black px-8 py-3 rounded-lg font-bold transition-colors"
                                >
                                    SYNC NOW
                                </button>
                                <button
                                    onClick={() => setSyncMode(false)}
                                    className="bg-gray-800 hover:bg-gray-700 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Settings Modal */}
                <SettingsModal
                    isOpen={isSettingsOpen}
                    onClose={() => setIsSettingsOpen(false)}
                />

                {/* Event History Modal */}
                <EventHistory
                    isOpen={showEventHistory}
                    onClose={() => setShowEventHistory(false)}
                    onSelectEvent={(sku) => {
                        setShowEventHistory(false);
                    }}
                />
            </main>
        </div>
    );
}

export default App;
