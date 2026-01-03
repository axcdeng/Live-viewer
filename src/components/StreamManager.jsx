import React, { useState, useEffect, useRef } from 'react';
import { Tv, Plus, X, Loader, AlertTriangle, Rewind, FastForward, RotateCcw, RotateCw, Play, ChevronsLeft, ChevronsRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import { extractVideoId, getStreamStartTime } from '../services/youtube';
import { getMatchDayIndex } from '../utils/streamMatching';

/**
 * StreamManager component - Manages multiple livestream inputs
 * Auto-creates stream boxes based on event duration
 * Allows adding backup streams
 */
function StreamManager({
    event,
    streams,
    onStreamsChange,
    onWebcastSelect,
    onSeek,
    onJumpToSyncedStart,
    canControl,
    multiDivisionMode,
    onMultiDivisionModeChange,
    activeDivisionId,
    onActiveDivisionIdChange
}) {
    const [feedback, setFeedback] = useState(null);
    const feedbackTimeout = useRef(null);

    const triggerFeedback = (text, isPositive = true) => {
        if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
        setFeedback({ text, isPositive, key: Date.now() });
        feedbackTimeout.current = setTimeout(() => setFeedback(null), 1000);
    };

    const handleSeekClick = (seconds) => {
        onSeek(seconds);
        const sign = seconds > 0 ? '+' : '-';
        const absVal = Math.abs(seconds);
        const text = absVal >= 60 ? `${sign}${absVal / 60}m` : `${sign}${absVal}s`;
        triggerFeedback(text, seconds > 0);
    };

    const handleSyncedClick = () => {
        onJumpToSyncedStart();
        triggerFeedback('Synced!', true);
    };

    const [loading, setLoading] = useState({});
    const [errors, setErrors] = useState({});

    // Track which videoIds we've already fetched to prevent duplicate fetches
    const fetchedVideoIds = useRef(new Set());

    // Validate stream dates against event dates
    const validateStreamDate = (stream) => {
        if (!stream.streamStartTime || !event) return null;

        const streamDate = new Date(stream.streamStartTime);

        // Convert timestamp to ISO string for getMatchDayIndex
        const streamDateISO = streamDate.toISOString();

        // Get the day index this stream should match based on its actual date
        const actualDayIndex = getMatchDayIndex(streamDateISO, event.start);

        // Check if stream's actual day differs from its assigned day
        // Also ignore extreme differences (e.g. > 14 days) which imply data error/year mismatch
        if (stream.dayIndex !== null && actualDayIndex !== stream.dayIndex && Math.abs(actualDayIndex - stream.dayIndex) < 14) {
            // Find if there's another stream for the correct day
            const correctDayStream = streams.find(s => s.dayIndex === actualDayIndex);

            return {
                mismatch: true,
                streamDate: format(streamDate, 'MMM d, yyyy'),
                expectedDay: stream.dayIndex + 1,
                actualDay: actualDayIndex + 1,
                canSwap: correctDayStream !== undefined,
                correctDayStreamId: correctDayStream?.id
            };
        }

        return null;
    };

    const swapStreams = (streamId1, streamId2) => {
        const stream1 = streams.find(s => s.id === streamId1);
        const stream2 = streams.find(s => s.id === streamId2);

        if (!stream1 || !stream2) return;

        // Swap URLs, videoIds, and streamStartTimes
        const updatedStreams = streams.map(s => {
            if (s.id === streamId1) {
                return {
                    ...s,
                    url: stream2.url,
                    videoId: stream2.videoId,
                    streamStartTime: stream2.streamStartTime
                };
            } else if (s.id === streamId2) {
                return {
                    ...s,
                    url: stream1.url,
                    videoId: stream1.videoId,
                    streamStartTime: stream1.streamStartTime
                };
            }
            return s;
        });

        onStreamsChange(updatedStreams);
    };

    // Fetch stream start times when stream URLs change
    useEffect(() => {
        // Only clear the cache when the set of videoIds actually changes
        const currentVideoIds = streams.map(s => s.videoId).filter(Boolean).sort().join(',');
        const previousVideoIds = Array.from(fetchedVideoIds.current).sort().join(',');

        if (currentVideoIds !== previousVideoIds) {
            fetchedVideoIds.current.clear();
        }

        const fetchStreamTimes = async () => {
            for (const stream of streams) {
                // Check if  we should fetch: has videoId, doesn't have start time, not loading, and haven't fetched this ID before
                if (stream.videoId && !stream.streamStartTime && !loading[stream.id] && !fetchedVideoIds.current.has(stream.videoId)) {
                    // Mark this videoId as being fetched
                    fetchedVideoIds.current.add(stream.videoId);

                    setLoading(prev => ({ ...prev, [stream.id]: true }));
                    setErrors(prev => ({ ...prev, [stream.id]: null }));

                    try {
                        const result = await getStreamStartTime(stream.videoId);
                        if (result && result.status === 'started' && result.startTime) {
                            updateStream(stream.id, {
                                streamStartTime: new Date(result.startTime).getTime()
                            });
                            setErrors(prev => ({ ...prev, [stream.id]: null }));
                        } else if (result && result.status === 'scheduled') {
                            // Stream is scheduled but not started yet
                            setErrors(prev => ({
                                ...prev,
                                [stream.id]: 'This livestream has not started yet.'
                            }));
                        } else {
                            // Stream start time not available
                            setErrors(prev => ({
                                ...prev,
                                [stream.id]: 'Unable to detect stream start time. You\'ll need to manually sync.'
                            }));
                        }
                    } catch (error) {
                        console.error(`Error fetching stream start time for ${stream.id}:`, error);
                        setErrors(prev => ({
                            ...prev,
                            [stream.id]: 'Error loading stream info. Check your YouTube API key in settings.'
                        }));
                    } finally {
                        setLoading(prev => ({ ...prev, [stream.id]: false }));
                    }
                }
            }
        };

        fetchStreamTimes();
    }, [streams.map(s => s.videoId).join(',')]); // Only re-run when video IDs change

    const updateStream = (streamId, updates) => {
        onStreamsChange(prevStreams =>
            prevStreams.map(s =>
                s.id === streamId ? { ...s, ...updates } : s
            )
        );
    };

    const handleStreamUrlChange = async (streamId, url) => {
        // Extract video ID if URL is valid
        const videoId = extractVideoId(url);

        // Update all properties at once to avoid race conditions
        if (videoId) {
            updateStream(streamId, { url, videoId, streamStartTime: null });
        } else if (!url) {
            updateStream(streamId, { url: '', videoId: null, streamStartTime: null });
        } else {
            // URL is present but invalid video ID
            updateStream(streamId, { url });
        }
    };

    const addStream = () => {
        const newStream = {
            id: `stream-backup-${Date.now()}`,
            url: '',
            videoId: null,
            streamStartTime: null,
            dayIndex: null, // Backup stream
            label: `Backup Stream`
        };
        onStreamsChange([...streams, newStream]);
    };

    const removeStream = (streamId) => {
        // Don't allow removing the last stream
        if (streams.length <= 1) return;

        const filtered = streams.filter(s => s.id !== streamId);
        onStreamsChange(filtered);
    };

    return (
        <div className="space-y-4">
            {/* Main header row - everything on one line on large screens */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
                {/* Left side: Title + Toggle + Division Tabs */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0 flex-1">
                    <h3 className="text-white font-bold flex items-center gap-2 whitespace-nowrap">
                        <Tv className="w-5 h-5 text-[#4FCEEC]" />
                        Livestream URLs
                    </h3>

                    {/* Multi-Division Toggle */}
                    {event?.divisions?.length > 1 && (
                        <button
                            onClick={() => onMultiDivisionModeChange(!multiDivisionMode)}
                            className={`text-[10px] font-bold px-2 py-1 rounded border transition-all whitespace-nowrap ${multiDivisionMode
                                ? 'bg-purple-500/20 border-purple-500/50 text-purple-300'
                                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-400'
                                }`}
                            title={multiDivisionMode ? "Disable Multi-Division Mode" : "Enable Multi-Division Mode"}
                        >
                            {multiDivisionMode ? 'DIVISIONS: ON' : 'DIVISIONS: OFF'}
                        </button>
                    )}

                    {/* Division Switcher Tabs - inline but can wrap */}
                    {multiDivisionMode && event?.divisions?.length > 1 && (
                        <div className="flex gap-1 bg-black/40 p-1 rounded-lg border border-gray-800/50">
                            {event.divisions.map((div) => (
                                <button
                                    key={div.id}
                                    onClick={() => onActiveDivisionIdChange(div.id)}
                                    className={`px-3 py-1.5 rounded-md text-[10px] font-bold transition-all uppercase tracking-wider whitespace-nowrap ${activeDivisionId === div.id
                                        ? 'bg-[#4FCEEC] text-black shadow-lg shadow-[#4FCEEC]/20'
                                        : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800'
                                        }`}
                                >
                                    {div.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* Right side: Controls - stays on the right */}
                <div className="flex items-center gap-3 flex-shrink-0">
                    {/* Playback Controls */}
                    <div className="flex items-center gap-3">
                        {/* Playback Controls Container */}
                        <div className="relative group">
                            {/* Feedback Overlay */}
                            {feedback && (
                                <div
                                    key={feedback.key}
                                    className={`absolute -top-10 left-1/2 -translate-x-1/2 pointer-events-none px-3 py-1 rounded-full text-[10px] font-bold z-50 animate-feedback-pill shadow-lg border border-white/10 ${feedback.isPositive ? 'bg-[#4FCEEC] text-black' : 'bg-gray-800 text-white'
                                        }`}
                                >
                                    {feedback.text}
                                </div>
                            )}

                            <div className={`flex items-center bg-black/40 border border-gray-800 rounded-xl p-1 px-1 transition-all duration-300 ${canControl ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                                {/* Back Buttons */}
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(-60)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 1m">
                                        <Rewind className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">1M</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(-30)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 30s">
                                        <ChevronsLeft className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">30S</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(-10)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 10s">
                                        <RotateCcw className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">10S</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(-5)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Back 5s">
                                        <ChevronLeft className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">5S</span>
                                </div>

                                <div className="h-4 w-px bg-gray-800 mx-1" />

                                {/* Sync Button */}
                                <div className="flex flex-col items-center px-1">
                                    <button onClick={handleSyncedClick} className="p-1 hover:bg-[#4FCEEC]/20 text-[#4FCEEC] rounded-lg transition-colors" title="Jump to Synced Start">
                                        <Play className="w-3.5 h-3.5 fill-current" />
                                    </button>
                                    <span className="text-[7px] font-bold text-[#4FCEEC]/70 uppercase tracking-wider -mt-0.5 pointer-events-none">Synced</span>
                                </div>

                                <div className="h-4 w-px bg-gray-800 mx-1" />

                                {/* Forward Buttons */}
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(5)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 5s">
                                        <ChevronRight className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">5S</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(10)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 10s">
                                        <RotateCw className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">10S</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(30)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 30s">
                                        <ChevronsRight className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">30S</span>
                                </div>
                                <div className="flex flex-col items-center">
                                    <button onClick={() => handleSeekClick(60)} className="p-1 hover:bg-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors" title="Forward 1m">
                                        <FastForward className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="text-[7px] font-bold text-gray-500 uppercase tracking-wider -mt-0.5 pointer-events-none">1M</span>
                                </div>
                            </div>
                        </div>

                        <button
                            onClick={addStream}
                            className="text-xs px-3 py-1.5 bg-[#4FCEEC]/10 hover:bg-[#4FCEEC]/20 text-[#4FCEEC] border border-[#4FCEEC]/20 rounded-lg transition-colors flex items-center gap-1 shrink-0"
                        >
                            <Plus className="w-3.5 h-3.5" />
                            Add Extra Stream
                        </button>

                        <style>{`
                            @keyframes feedback-pill {
                                0% { transform: translate(-50%, 10px); opacity: 0; scale: 0.8; }
                                15% { transform: translate(-50%, 0); opacity: 1; scale: 1; }
                                85% { transform: translate(-50%, 0); opacity: 1; scale: 1; }
                                100% { transform: translate(-50%, -10px); opacity: 0; scale: 0.9; }
                            }
                            .animate-feedback-pill {
                                animation: feedback-pill 1s ease-out forwards;
                            }
                            .scrollbar-hide {
                                -ms-overflow-style: none;
                                scrollbar-width: none;
                            }
                            .scrollbar-hide::-webkit-scrollbar {
                                display: none;
                            }
                        `}</style>
                    </div>
                </div>
            </div>

            <div className="space-y-3">
                {(() => {
                    const targetDivisionId = multiDivisionMode ? activeDivisionId : (event?.divisions?.[0]?.id || 1);

                    // Filter streams: Match division ID OR no divisionID (global/backup)
                    let filteredStreams = streams.filter(s =>
                        s.divisionId === targetDivisionId ||
                        s.divisionId === null ||
                        s.divisionId === undefined
                    );

                    // Safeguard: If filtration hides everything but we have streams, show them all (or fallback to defaults)
                    // This prevents "invisible inputs" bug if IDs mismatch
                    if (filteredStreams.length === 0 && streams.length > 0) {
                        console.warn("Stream filter hidden all streams. Falling back to showing all.");
                        filteredStreams = streams;
                    }

                    return filteredStreams.map((stream) => {
                        const validation = validateStreamDate(stream);

                        return (
                            <div key={stream.id}>
                                <StreamInput
                                    stream={stream}
                                    loading={loading[stream.id]}
                                    error={errors[stream.id]}
                                    canRemove={streams.length > 1}
                                    onUrlChange={(url) => handleStreamUrlChange(stream.id, url)}
                                    onRemove={() => removeStream(stream.id)}
                                />

                                {/* Date validation warning */}
                                {validation && validation.mismatch && (
                                    <div className="mt-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
                                        <div className="flex items-start gap-2">
                                            <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
                                            <div className="flex-1">
                                                <p className="text-sm text-orange-300 font-semibold">
                                                    Stream date mismatch detected
                                                </p>
                                                <p className="text-xs text-orange-400/80 mt-1">
                                                    This stream is from {validation.streamDate}, which matches Day {validation.actualDay} of the event,
                                                    but it's assigned to Day {validation.expectedDay}.
                                                </p>
                                                {validation.canSwap && (
                                                    <button
                                                        onClick={() => swapStreams(stream.id, validation.correctDayStreamId)}
                                                        className="mt-2 text-xs px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 rounded-lg transition-colors font-semibold"
                                                    >
                                                        Swap with Day {validation.actualDay} stream
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })
                })()}
            </div>
        </div>
    );
}

/**
 * Individual stream input component
 */
function StreamInput({ stream, loading, error, canRemove, onUrlChange, onRemove }) {
    return (
        <div className="relative">
            <div className="flex items-center gap-2">
                <div className="flex-1">
                    <label className="block text-sm font-medium text-gray-400 mb-1.5">
                        {stream.label}
                        {loading && (
                            <span className="ml-2 text-xs text-[#4FCEEC]">
                                <Loader className="inline w-3 h-3 animate-spin mr-1" />
                                Loading stream info...
                            </span>
                        )}
                        {stream.streamStartTime && !loading && (
                            <span className="ml-2 text-xs text-green-400">
                                ✓ Stream detected
                            </span>
                        )}
                        {error && !loading && (
                            <span className="ml-2 text-xs text-yellow-400">
                                ⚠ {error}
                            </span>
                        )}
                    </label>
                    <input
                        type="text"
                        value={stream.url}
                        onChange={(e) => onUrlChange(e.target.value)}
                        placeholder="https://www.youtube.com/watch?v=..."
                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-3 text-white focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none transition-all"
                    />
                </div>
                {canRemove && (
                    <button
                        onClick={onRemove}
                        className="p-2 mt-6 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors"
                        title="Remove this stream"
                    >
                        <X className="w-5 h-5" />
                    </button>
                )}
            </div>
        </div>
    );
}

export default StreamManager;
