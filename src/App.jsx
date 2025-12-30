import React, { useState, useEffect, useRef } from 'react';
import { Settings, Play, RefreshCw, Loader, History, AlertCircle, X, Tv, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import YouTube from 'react-youtube';
import { format } from 'date-fns';
import { useQueryState } from 'nuqs';
import SettingsModal from './components/SettingsModal';
import WebcastSelector from './components/WebcastSelector';
import EventHistory from './components/EventHistory';
import StreamManager from './components/StreamManager';
import TeamList from './components/TeamList';
import WordPressHeader from './components/WordPressHeader';
import { getEventBySku, getTeamByNumber, getMatchesForEventAndTeam, getTeamsForEvent } from './services/robotevents';
import { extractVideoId, getStreamStartTime } from './services/youtube';
import { findWebcastCandidates } from './services/webcastDetection';
import { getCachedWebcast, setCachedWebcast, saveEventToHistory } from './services/eventCache';
import { calculateEventDays, getMatchDayIndex, findStreamForMatch, getGrayOutReason } from './utils/streamMatching';
import { parseCalendarDate } from './utils/dateUtils';
import { Analytics } from "@vercel/analytics/react";

function App() {
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [showEventHistory, setShowEventHistory] = useState(false);
    const [webcastCandidates, setWebcastCandidates] = useState([]);
    const [noWebcastsFound, setNoWebcastsFound] = useState(false);

    // URL search params for deep linking
    const [urlSku, setUrlSku] = useQueryState('sku');
    const [urlTeam, setUrlTeam] = useQueryState('team');
    const [urlMatch, setUrlMatch] = useQueryState('match'); // Selected match ID
    // Note: vid/live params will be dynamically managed based on stream count
    const [urlVid1, setUrlVid1] = useQueryState('vid1');
    const [urlVid2, setUrlVid2] = useQueryState('vid2');
    const [urlVid3, setUrlVid3] = useQueryState('vid3');
    const [urlLive1, setUrlLive1] = useQueryState('live1');
    const [urlLive2, setUrlLive2] = useQueryState('live2');
    const [urlLive3, setUrlLive3] = useQueryState('live3');
    const [urlVid, setUrlVid] = useQueryState('vid'); // Single day fallback
    const [urlLive, setUrlLive] = useQueryState('live'); // Single day fallback

    // Flag to prevent infinite loops during deep linking
    const [isDeepLinking, setIsDeepLinking] = useState(false);
    const hasDeepLinked = useRef(false);

    // Form inputs
    const [eventUrl, setEventUrl] = useState('');
    const [teamNumber, setTeamNumber] = useState('');

    // Data
    const [event, setEvent] = useState(null);
    const [team, setTeam] = useState(null);
    const [matches, setMatches] = useState([]);

    // Multi-stream support
    const [streams, setStreams] = useState([]);
    const [activeStreamId, setActiveStreamId] = useState(null);
    const [players, setPlayers] = useState({});

    // Loading states
    const [eventLoading, setEventLoading] = useState(false);
    const [teamLoading, setTeamLoading] = useState(false);
    const [error, setError] = useState('');

    // Sync state
    const [syncMode, setSyncMode] = useState(false);
    const [selectedMatchId, setSelectedMatchId] = useState(null);

    // Auto-save to history whenever event or streams change
    useEffect(() => {
        if (event && streams.length > 0) {
            // Only save if at least one stream has a URL
            const hasUrls = streams.some(s => s.url);
            if (hasUrls) {
                saveEventToHistory(event, streams);
            }
        }
    }, [event, streams]);

    // Deep linking: Load from URL params on mount
    useEffect(() => {
        if (hasDeepLinked.current || isDeepLinking) return;

        const loadFromUrl = async () => {
            // Check if we have URL params to load
            if (!urlSku) {
                return;
            }

            hasDeepLinked.current = true;
            setIsDeepLinking(true);

            try {
                // Load event from SKU
                const foundEvent = await getEventBySku(urlSku);
                setEvent(foundEvent);
                setEventUrl(`https://www.robotevents.com/${urlSku}.html`);

                // Initialize streams for the event
                const days = calculateEventDays(foundEvent.start, foundEvent.end);
                const newStreams = [];

                for (let i = 0; i < days; i++) {
                    const eventStartDate = parseCalendarDate(foundEvent.start);
                    const dayDate = new Date(eventStartDate);
                    dayDate.setDate(eventStartDate.getDate() + i);
                    const dateLabel = format(dayDate, 'MMM d');

                    // Determine URL for this stream from URL params
                    let streamUrl = '';
                    let videoId = null;

                    if (days === 1) {
                        // Single day: check vid or live params
                        if (urlVid) {
                            streamUrl = `https://www.youtube.com/watch?v=${urlVid}`;
                            videoId = urlVid;
                        } else if (urlLive) {
                            streamUrl = `https://www.youtube.com/live/${urlLive}`;
                            videoId = urlLive;
                        }
                    } else {
                        // Multi-day: check indexed params (vid1, vid2, live1, live2, etc.)
                        const dayNum = i + 1;
                        const vidParam = [urlVid1, urlVid2, urlVid3][i];
                        const liveParam = [urlLive1, urlLive2, urlLive3][i];

                        if (vidParam) {
                            streamUrl = `https://www.youtube.com/watch?v=${vidParam}`;
                            videoId = vidParam;
                        } else if (liveParam) {
                            streamUrl = `https://www.youtube.com/live/${liveParam}`;
                            videoId = liveParam;
                        }
                    }

                    newStreams.push({
                        id: `stream - day - ${i} `,
                        url: streamUrl,
                        videoId: videoId,
                        streamStartTime: null,
                        dayIndex: i,
                        label: days > 1 ? `Day ${i + 1} - ${dateLabel} ` : 'Livestream',
                        date: dayDate.toISOString()
                    });
                }

                setStreams(newStreams);
                if (newStreams.length > 0) {
                    setActiveStreamId(newStreams[0].id);
                }

                // Set team number if specified (search will be triggered by separate effect)
                if (urlTeam) {
                    setTeamNumber(urlTeam);
                }
            } catch (err) {
                console.error('Error loading from URL:', err);
                setError(`Failed to load from URL: ${err.message}`);
            } finally {
                // Delay resetting isDeepLinking to prevent URL sync effects from running too early
                // Give enough time for stream start times to be fetched
                setTimeout(() => {
                    setIsDeepLinking(false);
                }, 1000);
            }
        };

        loadFromUrl();
    }, []); // Only run on mount

    // Sync URL params when event changes
    useEffect(() => {
        if (isDeepLinking || hasDeepLinked.current && !event) {
            return;
        }

        if (event && event.sku) {
            setUrlSku(event.sku);
        } else {
            setUrlSku(null);
        }
    }, [event, setUrlSku, isDeepLinking]);

    // Sync URL params when streams change
    useEffect(() => {
        if (isDeepLinking) {
            return;
        }

        if (!event || streams.length === 0) {
            // Clear all video params
            setUrlVid(null);
            setUrlLive(null);
            setUrlVid1(null);
            setUrlVid2(null);
            setUrlVid3(null);
            setUrlLive1(null);
            setUrlLive2(null);
            setUrlLive3(null);
            return;
        }

        const days = streams.length;

        if (days === 1) {
            // Single day event
            const stream = streams[0];
            if (stream && stream.url) {
                const videoId = extractVideoId(stream.url);
                if (videoId) {
                    // Determine if it's a live URL or regular video URL
                    if (stream.url.includes('/live/')) {
                        setUrlLive(videoId);
                        setUrlVid(null);
                    } else {
                        setUrlVid(videoId);
                        setUrlLive(null);
                    }
                } else {
                    setUrlVid(null);
                    setUrlLive(null);
                }
            } else {
                setUrlVid(null);
                setUrlLive(null);
            }
            // Clear indexed params for single day
            setUrlVid1(null);
            setUrlVid2(null);
            setUrlVid3(null);
            setUrlLive1(null);
            setUrlLive2(null);
            setUrlLive3(null);
        } else {
            // Multi-day event - use indexed params
            // Clear single-day params
            setUrlVid(null);
            setUrlLive(null);

            // Set indexed params
            const setters = [
                { vid: setUrlVid1, live: setUrlLive1 },
                { vid: setUrlVid2, live: setUrlLive2 },
                { vid: setUrlVid3, live: setUrlLive3 }
            ];

            streams.forEach((stream, i) => {
                if (i >= 3) return; // Support up to 3 days for now

                const videoId = stream.url ? extractVideoId(stream.url) : null;
                const setter = setters[i];

                if (videoId) {
                    if (stream.url.includes('/live/')) {
                        setter.live(videoId);
                        setter.vid(null);
                    } else {
                        setter.vid(videoId);
                        setter.live(null);
                    }
                } else {
                    setter.vid(null);
                    setter.live(null);
                }
            });

            // Clear unused params
            for (let i = streams.length; i < 3; i++) {
                const setter = setters[i];
                setter.vid(null);
                setter.live(null);
            }
        }
    }, [streams, event, setUrlVid, setUrlLive, setUrlVid1, setUrlVid2, setUrlVid3, setUrlLive1, setUrlLive2, setUrlLive3, isDeepLinking]);

    // Sync URL params when team changes
    useEffect(() => {
        if (isDeepLinking) return;

        if (team && team.number) {
            setUrlTeam(team.number);
        } else if (!teamNumber) {
            setUrlTeam(null);
        }
    }, [team, teamNumber, setUrlTeam, isDeepLinking]);

    // Trigger team search after event loads from deep linking
    useEffect(() => {
        if (!isDeepLinking && hasDeepLinked.current && event && urlTeam && teamNumber && !team) {
            // Event has loaded from URL and we have a team to search for
            handleTeamSearch(urlTeam);
        }
    }, [event, urlTeam, teamNumber, team, isDeepLinking]);

    // Sync URL params when selected match changes
    useEffect(() => {
        if (isDeepLinking) return;

        if (selectedMatchId) {
            setUrlMatch(selectedMatchId.toString());
        } else {
            setUrlMatch(null);
        }
    }, [selectedMatchId, setUrlMatch, isDeepLinking]);

    // Helper: Get active stream object
    const getActiveStream = () => {
        return streams.find(s => s.id === activeStreamId) || streams[0] || null;
    };

    // Helper: Calculate event duration and initialize streams
    const initializeStreamsForEvent = (eventData) => {
        const days = calculateEventDays(eventData.start, eventData.end);
        const newStreams = [];

        for (let i = 0; i < days; i++) {
            // Calculate the date for this day using calendar dates
            const eventStartDate = parseCalendarDate(eventData.start);
            const dayDate = new Date(eventStartDate);
            dayDate.setDate(eventStartDate.getDate() + i);
            const dateLabel = format(dayDate, 'MMM d');

            newStreams.push({
                id: `stream - day - ${i} `,
                url: '',
                videoId: null,
                streamStartTime: null,
                dayIndex: i,
                label: days > 1 ? `Day ${i + 1} - ${dateLabel} ` : 'Livestream',
                date: dayDate.toISOString()
            });
        }

        setStreams(newStreams);
        if (newStreams.length > 0) {
            setActiveStreamId(newStreams[0].id);
        }
    };

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

            // Only reinitialize streams if it's a different event or no streams exist
            const isDifferentEvent = !event || event.id !== foundEvent.id;
            const hasExistingStreams = streams.length > 0 && streams.some(s => s.url);

            if (isDifferentEvent || !hasExistingStreams) {
                setEvent(foundEvent);
                // Initialize streams based on event duration
                initializeStreamsForEvent(foundEvent);
            } else {
                // Same event, just update event data without touching streams
                setEvent(foundEvent);
            }

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
                    // Populate first stream with cached URL
                    setStreams(prev => prev.map((s, idx) =>
                        idx === 0 ? { ...s, url: cached.url, videoId: cached.videoId } : s
                    ));
                }
            }

        } catch (err) {
            setError(err.message);
        } finally {
            setEventLoading(false);
        }
    };

    const handleWebcastSelect = (selectedVideoId, selectedUrl, method) => {
        // Populate first stream with selected webcast
        setStreams(prev => prev.map((s, idx) =>
            idx === 0 ? { ...s, url: selectedUrl, videoId: selectedVideoId } : s
        ));
        if (event) {
            setCachedWebcast(event.id, selectedVideoId, selectedUrl, method);
        }
        setNoWebcastsFound(false);
        setWebcastCandidates([]);
    };

    const handleLoadFromHistory = async (historyEntry) => {
        // Reconstruct event object
        let reconstructedEvent = {
            id: historyEntry.eventId,
            name: historyEntry.eventName,
            start: historyEntry.eventStart,
            end: historyEntry.eventEnd,
            sku: historyEntry.eventSku,
            program: historyEntry.eventProgram,
            season: historyEntry.eventSeason,
            divisions: historyEntry.eventDivisions
        };

        // If program, season, or divisions is missing (legacy history), fetch full event details
        if ((!reconstructedEvent.program || !reconstructedEvent.season || !reconstructedEvent.divisions) && reconstructedEvent.sku) {
            try {
                const fullEvent = await getEventBySku(reconstructedEvent.sku);
                reconstructedEvent = fullEvent;
                // Update history with full details
                saveEventToHistory(fullEvent, historyEntry.streams.map(s => ({
                    label: s.label,
                    url: s.url,
                    videoId: s.videoId,
                    dayIndex: s.dayIndex,
                    streamStartTime: s.streamStartTime
                })));
            } catch (err) {
                console.error('Failed to fetch full event details:', err);
            }
        }

        setEvent(reconstructedEvent);
        setEventUrl(`https://www.robotevents.com/${historyEntry.eventSku}.html`);

        // Restore streams
        const restoredStreams = historyEntry.streams.map((s, idx) => ({
            id: `stream-day-${idx}`,
            url: s.url || '',
            videoId: s.videoId || null,
            streamStartTime: s.streamStartTime || null,
            dayIndex: s.dayIndex,
            label: s.label,
            date: s.date
        }));

        setStreams(restoredStreams);
        if (restoredStreams.length > 0) {
            setActiveStreamId(restoredStreams[0].id);
        }
    };

    // Expanded matches state
    const [expandedMatchId, setExpandedMatchId] = useState(null);

    const handleTeamSearch = async (specificTeamNumber) => {
        const searchNumber = specificTeamNumber || teamNumber;
        setActiveTab('search'); // Switch to search tab when searching

        if (!event) {
            // Only show error if not during deep linking
            if (!isDeepLinking) {
                setError('Please find an event first');
            }
            return;
        }

        if (!searchNumber.trim()) {
            setError('Please enter a team number');
            return;
        }

        setTeamLoading(true);
        setError('');
        // Update the input field if searching via click
        if (specificTeamNumber) {
            setTeamNumber(specificTeamNumber);
        }

        try {
            setTeamLoading(true);
            setError('');
            const searchNumber = teamNumber.trim();

            // First, get all teams for this event
            const eventTeams = await getTeamsForEvent(event.id);

            // Find the team in the event (case-insensitive)
            const foundTeam = eventTeams.find(t => t.number.toUpperCase() === searchNumber.toUpperCase());

            if (!foundTeam) {
                throw new Error(`Team ${searchNumber} is not registered for this event.`);
            }

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

            console.warn('DEBUG: Match Data Loaded', {
                firstMatch: foundMatches[0],
                teamSearchingFor: foundTeam,
                alliancesOfFirstMatch: foundMatches[0]?.alliances
            });

            setMatches(foundMatches);
            // Reset expanded match when searching new team
            setExpandedMatchId(null);
        } catch (err) {
            console.error('DEBUG: Error in handleTeamSearch', err);
            setError(err.message);
        } finally {
            setTeamLoading(false);
        }
    };

    const handleManualSync = (match) => {
        // Find the appropriate stream for this match
        const matchStream = findStreamForMatch(match, streams, event?.start);

        if (!matchStream) {
            alert('No stream available for this match.');
            return;
        }

        const player = players[matchStream.id];
        if (!player) {
            alert('No player found. Load the stream first.');
            return;
        }

        const currentVideoTimeSec = player.getCurrentTime();
        const matchStartTimeMs = new Date(match.started).getTime();
        const calculatedStreamStart = matchStartTimeMs - (currentVideoTimeSec * 1000);

        // Update the stream's start time
        setStreams(prev => prev.map(s =>
            s.id === matchStream.id ? { ...s, streamStartTime: calculatedStreamStart } : s
        ));
        setSyncMode(false);
    };

    const jumpToMatch = (match) => {
        console.log('🎯 [JUMP TO MATCH] Starting jump:', {
            matchId: match.id,
            matchName: match.name,
            matchStarted: match.started,
            matchScheduled: match.scheduled
        });

        // Find the appropriate stream for this match
        const matchStream = findStreamForMatch(match, streams, event?.start);

        console.log('📺 [JUMP TO MATCH] Stream found:', {
            streamId: matchStream?.id,
            streamLabel: matchStream?.label,
            streamDayIndex: matchStream?.dayIndex,
            streamStartTime: matchStream?.streamStartTime ? new Date(matchStream.streamStartTime).toISOString() : null,
            allStreams: streams.map(s => ({
                id: s.id,
                label: s.label,
                dayIndex: s.dayIndex,
                streamStartTime: s.streamStartTime ? new Date(s.streamStartTime).toISOString() : null
            }))
        });

        if (!matchStream) {
            alert('No stream available for this match.');
            return;
        }

        // Pause the currently active player if switching streams
        if (matchStream.id !== activeStreamId && activeStreamId) {
            const currentPlayer = players[activeStreamId];
            if (currentPlayer && typeof currentPlayer.pauseVideo === 'function') {
                currentPlayer.pauseVideo();
            }
        }

        // Switch to the correct stream if not already active
        if (matchStream.id !== activeStreamId) {
            console.log('🔄 [JUMP TO MATCH] Switching streams:', {
                from: activeStreamId,
                to: matchStream.id
            });
            setActiveStreamId(matchStream.id);
        }

        const player = players[matchStream.id];
        if (!player) {
            alert('No player found for this stream. Please wait for it to load.');
            return;
        }

        if (!matchStream.streamStartTime) {
            alert('Please sync this stream first!');
            return;
        }

        const matchStartMs = new Date(match.started).getTime();
        const seekTimeSec = (matchStartMs - matchStream.streamStartTime) / 1000;

        console.log('⏰ [JUMP TO MATCH] Calculated seek time:', {
            matchStartMs,
            matchStartDate: new Date(matchStartMs).toISOString(),
            streamStartTimeMs: matchStream.streamStartTime,
            streamStartDate: new Date(matchStream.streamStartTime).toISOString(),
            differenceMs: matchStartMs - matchStream.streamStartTime,
            seekTimeSec,
            seekTimeFormatted: `${Math.floor(seekTimeSec / 60)}m ${Math.floor(seekTimeSec % 60)}s`
        });

        if (seekTimeSec < 0) {
            alert("This match happened before the stream started!");
            return;
        }

        player.seekTo(seekTimeSec, true);
        player.playVideo();
        setSelectedMatchId(match.id);

        console.log('✅ [JUMP TO MATCH] Jump complete, match selected:', match.id);
    };

    const adjustSync = (seconds) => {
        const activeStream = getActiveStream();
        if (!activeStream || !activeStream.streamStartTime) return;

        setStreams(prev => prev.map(s =>
            s.id === activeStream.id
                ? { ...s, streamStartTime: s.streamStartTime + (seconds * 1000) }
                : s
        ));
    };

    // Tab state
    const [activeTab, setActiveTab] = useState('search'); // 'search' or 'list'

    // Helper to render score
    const renderScore = (match, userAlliance, opponentAlliance) => {
        if (!match.started) return null;

        const isVIQC = event?.program?.code === 'VIQC' || event?.program?.code === 'VIQRC';

        if (isVIQC) {
            return <span className="font-bold text-[#4FCEEC]">{userAlliance.score}</span>;
        }

        // V5RC / VRC
        const userScore = userAlliance.score;
        const opponentScore = opponentAlliance.score;
        const userWon = userScore > opponentScore;
        const tie = userScore === opponentScore;

        return (
            <div className="flex gap-2 text-sm font-mono">
                <span className={`font-bold ${userAlliance.color === 'red' ? 'text-red-400' : 'text-blue-400'} ${userWon ? 'underline decoration-2' : ''}`}>
                    {userScore}
                </span>
                <span className="text-gray-600">-</span>
                <span className={`font-bold ${opponentAlliance.color === 'red' ? 'text-red-400' : 'text-blue-400'} ${!userWon && !tie ? 'underline decoration-2' : ''}`}>
                    {opponentScore}
                </span>
            </div>
        );
    };

    return (
        <div className="min-h-screen bg-black text-white font-sans selection:bg-[#4FCEEC] selection:text-black flex flex-col overflow-hidden">
            {/* WordPress Header */}
            <header className="bg-gray-900 border-b border-gray-800 z-50 backdrop-blur-md bg-opacity-80 flex-shrink-0">
                <WordPressHeader />
            </header>

            {/* Floating Controls (Bottom Left) */}
            <div className="fixed bottom-4 left-4 z-40 flex gap-2">
                <button
                    onClick={() => setShowEventHistory(true)}
                    className="p-3 bg-gray-900/90 hover:bg-gray-800 border border-gray-700 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm"
                    title="Event History"
                >
                    <History className="w-5 h-5 text-gray-300 hover:text-white" />
                </button>
                <button
                    onClick={() => setIsSettingsOpen(true)}
                    className="p-3 bg-gray-900/90 hover:bg-gray-800 border border-gray-700 rounded-full transition-all shadow-lg hover:shadow-xl backdrop-blur-sm"
                    title="Settings"
                >
                    <Settings className="w-5 h-5 text-gray-300 hover:text-white" />
                </button>
            </div>

            {/* Error Display */}
            {error && (
                <div className="max-w-[1600px] mx-auto mt-4 px-4 w-full flex-shrink-0">
                    <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl flex items-center gap-3 shadow-lg shadow-red-900/20">
                        <AlertCircle className="w-5 h-5 flex-shrink-0" />
                        <p className="font-medium">{error}</p>
                        <button onClick={() => setError('')} className="ml-auto hover:text-white">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            <main className="flex-1 w-full p-2 sm:p-4 min-h-0 sm:max-w-[1600px] sm:mx-auto">
                <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 h-full">
                    {/* Left Column: Stream & Stream Manager */}
                    <div className="xl:col-span-8 flex flex-col gap-6 min-h-0 overflow-y-auto pr-2">
                        {/* Stream Player */}
                        <div className="bg-gray-900 border border-gray-800 p-1 rounded-xl overflow-hidden flex-shrink-0">
                            <div className="bg-black rounded-lg overflow-hidden aspect-video relative group">
                                {event && streams.length > 0 ? (
                                    streams.map((stream) => (
                                        <div
                                            key={stream.id}
                                            style={{ display: stream.id === activeStreamId ? 'block' : 'none' }}
                                            className="w-full h-full"
                                        >
                                            {stream.videoId ? (
                                                <YouTube
                                                    videoId={stream.videoId}
                                                    opts={{
                                                        height: '100%',
                                                        width: '100%',
                                                        playerVars: {
                                                            autoplay: 0,
                                                            modestbranding: 1,
                                                        },
                                                    }}
                                                    onReady={(event) => {
                                                        setPlayers(prev => ({ ...prev, [stream.id]: event.target }));
                                                    }}
                                                    className="w-full h-full"
                                                />
                                            ) : (
                                                <div className="w-full h-full flex items-center justify-center text-slate-600">
                                                    <div className="text-center">
                                                        <Tv className="w-12 h-12 mx-auto mb-3 opacity-20" />
                                                        <p>Enter a stream URL for {stream.label} below</p>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                                        <div className="text-center">
                                            <Tv className="w-16 h-16 mx-auto mb-4 opacity-20" />
                                            <p className="text-xl font-medium">No Stream Selected</p>
                                            <p className="text-sm mt-2">Find an event to get started</p>
                                        </div>
                                    </div>
                                )}

                                {/* Stream Switcher Overlay */}
                                {streams.length > 1 && streams.filter(s => s.videoId).length > 0 && (
                                    <div className={`absolute top-4 right-4 flex gap-2 transition-opacity duration-300 ${getActiveStream()?.videoId ? 'opacity-0 group-hover:opacity-100' : ''
                                        }`}>
                                        {streams.filter(s => s.videoId).map((stream) => (
                                            <button
                                                key={stream.id}
                                                onClick={() => setActiveStreamId(stream.id)}
                                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors backdrop-blur-md ${activeStreamId === stream.id
                                                    ? 'bg-[#4FCEEC]/90 text-black'
                                                    : 'bg-black/60 text-white hover:bg-black/80'
                                                    }`}
                                            >
                                                {stream.label}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stream Manager (Livestream URLs) */}
                        {event && (
                            <div className="bg-gray-900 border border-gray-800 p-6 rounded-xl space-y-4 flex-shrink-0">
                                {webcastCandidates.length > 0 ? (
                                    <>
                                        <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                            <Tv className="w-5 h-5 text-[#4FCEEC]" />
                                            Livestream URL (Auto-detected)
                                        </h2>
                                        <WebcastSelector
                                            candidates={webcastCandidates}
                                            onSelect={handleWebcastSelect}
                                            event={event}
                                        />
                                    </>
                                ) : (
                                    <StreamManager
                                        event={event}
                                        streams={streams}
                                        onStreamsChange={setStreams}
                                        onWebcastSelect={handleWebcastSelect}
                                    />
                                )}
                                {noWebcastsFound && (
                                    <p className="text-yellow-500 text-xs">
                                        No webcasts found automatically. Please paste the URL manually.
                                        Check <a href={`https://www.robotevents.com/robot-competitions/vex-robotics-competition/${event.sku}.html#webcast`} target="_blank" rel="noopener noreferrer" className="underline hover:text-white">here</a>.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Right Column: Controls */}
                    <div className="xl:col-span-4 flex flex-col gap-4 xl:h-full xl:min-h-0">
                        {/* 3. Match List */}
                        <div className="bg-gray-900 border border-gray-800 p-5 rounded-xl space-y-3 flex-shrink-0">
                            <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">1. Find Event</h2>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={eventUrl}
                                    onChange={(e) => setEventUrl(e.target.value)}
                                    placeholder="Paste RobotEvents URL..."
                                    className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                    onKeyDown={(e) => e.key === 'Enter' && handleEventSearch()}
                                />
                                <button
                                    onClick={handleEventSearch}
                                    disabled={eventLoading}
                                    className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                                >
                                    {eventLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                                </button>
                            </div>
                            {event && (
                                <div className="p-3 bg-black border border-gray-700 rounded-lg">
                                    <p className="text-white font-semibold text-sm line-clamp-1" title={event.name}>{event.name}</p>
                                    <p className="text-xs text-gray-400 mt-1">{event.location?.venue}, {event.location?.city}</p>
                                </div>
                            )}
                        </div>

                        {/* Tabs */}
                        <div className="flex gap-1 bg-gray-900/50 p-1 rounded-lg flex-shrink-0">
                            <button
                                onClick={() => setActiveTab('search')}
                                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'search'
                                    ? 'bg-gray-800 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                                    }`}
                            >
                                Search by team
                            </button>
                            <button
                                onClick={() => setActiveTab('list')}
                                className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${activeTab === 'list'
                                    ? 'bg-gray-800 text-white shadow-sm'
                                    : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
                                    }`}
                            >
                                Team List
                            </button>
                        </div>

                        {/* Tab Content Panel */}
                        <div className="bg-gray-900 border border-gray-800 rounded-xl flex-1 flex flex-col min-h-0 overflow-hidden">
                            {activeTab === 'search' ? (
                                <>
                                    {/* Search Header */}
                                    <div className="p-5 border-b border-gray-800 space-y-3 flex-shrink-0 bg-gray-900 z-10">
                                        <h2 className="text-sm font-bold text-gray-400 uppercase tracking-wider">4. Find Team</h2>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={teamNumber}
                                                onChange={(e) => setTeamNumber(e.target.value)}
                                                placeholder="Team number (e.g., 11574A)"
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                                                onKeyDown={(e) => e.key === 'Enter' && handleTeamSearch()}
                                            />
                                            <button
                                                onClick={() => handleTeamSearch()}
                                                disabled={teamLoading || !event}
                                                className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black px-4 py-2 rounded-lg font-bold text-sm transition-colors flex items-center gap-2"
                                            >
                                                {teamLoading ? <Loader className="w-4 h-4 animate-spin" /> : 'Search'}
                                            </button>
                                        </div>
                                        {team && (
                                            <div className="p-3 bg-black border border-gray-700 rounded-lg">
                                                <p className="text-white font-semibold text-sm">{team.number} - {team.team_name}</p>
                                                <p className="text-xs text-gray-400">{team.organization}</p>
                                                {team.grade && (
                                                    <p className="text-xs text-cyan-400 mt-1">
                                                        {team.grade} {team.program?.code && `• ${team.program.code}`}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                    </div>

                                    {/* Matches List */}
                                    <div className="flex-1 overflow-y-auto p-4 min-h-0">
                                        {matches.length > 0 ? (
                                            <div className="space-y-4">
                                                <div className="flex justify-between items-center sticky top-0 bg-gray-900 pb-2 z-10">
                                                    <h2 className="text-sm font-bold text-white">Matches</h2>
                                                    <div className="flex items-center gap-3">
                                                        <div className="flex items-center gap-2 text-[10px]">
                                                            {(() => {
                                                                const syncedStreams = streams.filter(s => s.streamStartTime);
                                                                const isSynced = syncedStreams.length > 0;
                                                                return (
                                                                    <>
                                                                        <div className={`w-1.5 h-1.5 rounded-full ${isSynced ? 'bg-[#4FCEEC] shadow-[0_0_8px_rgba(79,206,236,0.6)]' : 'bg-red-500'}`} />
                                                                        <span className="text-gray-400">
                                                                            {isSynced ? 'Synced' : 'Not Synced'}
                                                                        </span>
                                                                    </>
                                                                );
                                                            })()}
                                                        </div>
                                                        {getActiveStream()?.streamStartTime && (
                                                            <div className="flex gap-1">
                                                                <button onClick={() => adjustSync(1)} className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">+1s</button>
                                                                <button onClick={() => adjustSync(-1)} className="px-1.5 py-0.5 bg-gray-800 hover:bg-gray-700 rounded text-[10px] text-white">-1s</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {(() => {
                                                    // Group matches by day
                                                    const matchesByDay = {};
                                                    matches.forEach(match => {
                                                        // Use started date or scheduled date or fallback to event start
                                                        const dateToUse = match.started || match.scheduled || event?.start;
                                                        const dayIndex = getMatchDayIndex(dateToUse, event?.start);
                                                        if (!matchesByDay[dayIndex]) {
                                                            matchesByDay[dayIndex] = [];
                                                        }
                                                        matchesByDay[dayIndex].push(match);
                                                    });

                                                    return Object.keys(matchesByDay).sort().map((dayIndex) => {
                                                        const dayMatches = matchesByDay[dayIndex];
                                                        const dayStream = streams.find(s => s.dayIndex === parseInt(dayIndex));
                                                        const dayLabel = dayStream?.label || `Day ${parseInt(dayIndex) + 1}`;

                                                        return (
                                                            <div key={dayIndex}>
                                                                {/* Day Header */}
                                                                <div className="flex items-center gap-2 mb-2 sticky top-0 bg-gray-900/95 backdrop-blur py-2 z-10">
                                                                    <div className="flex-1 h-px bg-gray-700"></div>
                                                                    <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                                                                        {dayLabel}
                                                                    </span>
                                                                    <div className="flex-1 h-px bg-gray-700"></div>
                                                                </div>

                                                                {/* Matches for this day */}
                                                                <div className="space-y-2 mb-4">
                                                                    {dayMatches.map((match, index) => {
                                                                        const hasStarted = !!match.started;
                                                                        // Fix: Ensure ID comparison is robust, check both ID and Number, and fallback to Name
                                                                        const alliance = match.alliances?.find(a => a.teams?.some(t =>
                                                                            String(t.team?.id) === String(team?.id) ||
                                                                            t.team?.number === team?.number ||
                                                                            t.team?.name === team?.number // Fallback if name holds the number
                                                                        ));

                                                                        const opponentAlliance = match.alliances?.find(a => a !== alliance);
                                                                        const matchName = match.name?.replace(/teamwork/gi, 'Qual') || match.name;

                                                                        // Check if match is available
                                                                        const grayOutReason = getGrayOutReason(match, streams, event?.start);
                                                                        const isGrayedOut = !!grayOutReason;
                                                                        const matchStream = findStreamForMatch(match, streams, event?.start);
                                                                        const canJump = matchStream && matchStream.streamStartTime;
                                                                        const isExpanded = expandedMatchId === match.id;

                                                                        // W/L Indicator Logic
                                                                        const isVIQC = event?.program?.code === 'VIQC' || event?.program?.code === 'VIQRC';
                                                                        let resultIndicator = null;
                                                                        if (hasStarted && alliance && opponentAlliance && !isVIQC) {
                                                                            const userScore = alliance.score;
                                                                            const opponentScore = opponentAlliance.score;
                                                                            if (userScore > opponentScore) {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-green-400 ml-1">W</span>;
                                                                            } else if (userScore < opponentScore) {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-red-400 ml-1">L</span>;
                                                                            } else {
                                                                                resultIndicator = <span className="text-[10px] font-bold text-gray-400 ml-1">T</span>;
                                                                            }
                                                                        }

                                                                        return (
                                                                            <div
                                                                                key={match.id}
                                                                                className={`rounded-lg border transition-all overflow-hidden ${selectedMatchId === match.id
                                                                                    ? 'bg-[#4FCEEC]/20 border-[#4FCEEC]'
                                                                                    : isGrayedOut
                                                                                        ? 'bg-black border-gray-800 opacity-50'
                                                                                        : 'bg-black border-gray-800 hover:border-gray-700'
                                                                                    }`}
                                                                                title={isGrayedOut ? grayOutReason : ''}
                                                                            >
                                                                                <div className="p-3 flex justify-between items-center gap-2">
                                                                                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setExpandedMatchId(isExpanded ? null : match.id)}>
                                                                                        <div className="flex items-center gap-2">
                                                                                            <h4 className="font-bold text-white text-sm truncate">{matchName}</h4>
                                                                                            {alliance && (
                                                                                                <div className="flex items-center">
                                                                                                    <div className={`w-2 h-2 rounded-full ${alliance.color === 'red' ? 'bg-red-500' : 'bg-blue-500'}`} title={`${alliance.color} alliance`} />
                                                                                                    {resultIndicator}
                                                                                                </div>
                                                                                            )}
                                                                                            {isExpanded ? <ChevronUp className="w-3 h-3 text-gray-500" /> : <ChevronDown className="w-3 h-3 text-gray-500" />}
                                                                                        </div>
                                                                                        <div className="flex items-center gap-2 mt-1">
                                                                                            <p className="text-xs text-gray-400">
                                                                                                {hasStarted ? format(new Date(match.started), 'h:mm a') : (match.scheduled ? format(new Date(match.scheduled), 'h:mm a') : 'TBD')}
                                                                                            </p>
                                                                                            {hasStarted && alliance && opponentAlliance && renderScore(match, alliance, opponentAlliance)}
                                                                                        </div>
                                                                                    </div>

                                                                                    {canJump ? (
                                                                                        <button
                                                                                            onClick={() => jumpToMatch(match)}
                                                                                            disabled={!hasStarted || isGrayedOut}
                                                                                            className="bg-[#4FCEEC] hover:bg-[#3db8d6] disabled:opacity-50 text-black p-2 rounded-lg flex-shrink-0 transition-colors"
                                                                                            title="Jump to match"
                                                                                        >
                                                                                            <Play className="w-3 h-3 fill-current" />
                                                                                        </button>
                                                                                    ) : (
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                setSelectedMatchId(match.id);
                                                                                                setSyncMode(true);
                                                                                            }}
                                                                                            disabled={!hasStarted || isGrayedOut}
                                                                                            className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 text-white p-2 rounded-lg flex-shrink-0 transition-colors"
                                                                                            title="Sync match"
                                                                                        >
                                                                                            <RefreshCw className="w-3 h-3" />
                                                                                        </button>
                                                                                    )}
                                                                                </div>

                                                                                {/* Expanded Team Details */}
                                                                                {isExpanded && (
                                                                                    <div className="bg-gray-900/50 border-t border-gray-800 p-3 text-xs space-y-2">
                                                                                        {/* Alliance Teams (or All Teams for VIQC) */}
                                                                                        {(isVIQC ? (match.alliances || []) : (alliance ? [alliance] : [])).length > 0 && (
                                                                                            <div>
                                                                                                <p className="text-gray-500 font-semibold mb-1">{isVIQC ? 'Teams' : 'Alliance'}</p>
                                                                                                <div className="flex flex-wrap gap-2">
                                                                                                    {(isVIQC ? match.alliances.flatMap(a => a.teams) : alliance?.teams)?.map(t => {
                                                                                                        if (!t?.team) return null;
                                                                                                        const teamLabel = t.team.number || t.team.name;
                                                                                                        return (
                                                                                                            <button
                                                                                                                key={t.team.id || Math.random()}
                                                                                                                onClick={() => handleTeamSearch(teamLabel)}
                                                                                                                className={`px-2 py-1 rounded border ${String(t.team.id) === String(team?.id)
                                                                                                                    ? 'bg-[#4FCEEC]/20 border-[#4FCEEC] text-[#4FCEEC]'
                                                                                                                    : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'}`}
                                                                                                            >
                                                                                                                {teamLabel}
                                                                                                            </button>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Opponent Teams (only if not VIQC) */}
                                                                                        {!isVIQC && opponentAlliance && (
                                                                                            <div>
                                                                                                <p className="text-gray-500 font-semibold mb-1">Opponents</p>
                                                                                                <div className="flex flex-wrap gap-2">
                                                                                                    {opponentAlliance.teams?.map(t => {
                                                                                                        if (!t?.team) return null;
                                                                                                        const teamLabel = t.team.number || t.team.name;
                                                                                                        return (
                                                                                                            <button
                                                                                                                key={t.team.id || Math.random()}
                                                                                                                onClick={() => handleTeamSearch(teamLabel)}
                                                                                                                className="px-2 py-1 rounded border bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                                                                                                            >
                                                                                                                {teamLabel}
                                                                                                            </button>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                            </div>
                                                                                        )}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        );
                                                    });
                                                })()}
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
                            ) : (
                                <TeamList
                                    event={event}
                                    onTeamSelect={handleTeamSearch}
                                />
                            )}
                        </div>
                    </div>
                </div>

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
                    onSelectEvent={handleLoadFromHistory}
                />

                {/* Copyright Footer */}
                <footer className="fixed bottom-4 right-4 text-xs text-slate-400 text-center sm:text-right max-w-xs sm:max-w-2xl">
                    <p className="bg-slate-900/80 backdrop-blur-sm px-4 py-2 rounded-lg border border-slate-700/50">
                        © 2025 RoboSTEM Foundation |{' '}
                        <a
                            href="https://forms.gle/R3XS6nXymbLc57RSA"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-cyan-400 hover:text-cyan-300 transition-colors"
                        >
                            Report Bugs
                        </a>
                        {' '}| Made with <span className="text-red-500">❤</span> by{' '}
                        <a
                            href="https://www.linkedin.com/in/axcdeng/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline hover:opacity-80 transition-opacity"
                        >
                            Alexander Deng
                        </a>
                    </p>
                </footer>
            </main>
            <Analytics debug={true} />
        </div>
    );
}

export default App;
