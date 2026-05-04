import React, { useState, useEffect, useRef } from 'react';
import { Plus, X, Loader, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { extractVideoId, getStreamStartTime } from '../services/youtube';
import { getMatchDayIndex } from '../utils/streamMatching';

function getCompactStreamLabel(stream) {
    if (stream?.date) {
        return format(new Date(stream.date), 'MMM d');
    }

    const label = stream?.label || 'Stream';
    return label.replace(/^Day\s+\d+\s*-\s*/i, '');
}

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

    const targetDivisionId = multiDivisionMode ? activeDivisionId : (event?.divisions?.[0]?.id || 1);
    let filteredStreams = streams.filter(s =>
        s.divisionId === targetDivisionId ||
        s.divisionId === null ||
        s.divisionId === undefined
    );

    if (filteredStreams.length === 0 && streams.length > 0) {
        console.warn("Stream filter hidden all streams. Falling back to showing all.");
        filteredStreams = streams;
    }

    return (
        <div className="space-y-1">
            {multiDivisionMode && event?.divisions?.length > 1 && (
                <div className="flex items-center gap-1 overflow-x-auto pb-1">
                    {event.divisions.map((div) => (
                        <button
                            key={div.id}
                            onClick={() => onActiveDivisionIdChange(div.id)}
                            className={`shrink-0 px-2 py-1 text-[10px] font-bold uppercase ${activeDivisionId === div.id
                                ? 'bg-[#4FCEEC] text-black'
                                : 'bg-black text-gray-500 hover:bg-gray-900 hover:text-gray-300'
                                }`}
                        >
                            {div.name}
                        </button>
                    ))}
                </div>
            )}

            <div className="space-y-1">
                {filteredStreams.map((stream) => {
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
                    })}
            </div>
            <div className="flex items-center justify-end gap-1">
                {event?.divisions?.length > 1 && (
                    <button
                        onClick={() => onMultiDivisionModeChange(!multiDivisionMode)}
                        className={`shrink-0 border px-1.5 py-0.5 text-[9px] font-bold uppercase ${multiDivisionMode
                            ? 'border-[#4FCEEC]/40 bg-[#4FCEEC]/10 text-[#4FCEEC]'
                            : 'border-gray-800 bg-black text-gray-500 hover:text-gray-300'
                            }`}
                        title={multiDivisionMode ? "Disable Multi-Division Mode" : "Enable Multi-Division Mode"}
                    >
                        Div
                    </button>
                )}
                <button
                    onClick={addStream}
                    className="flex h-6 w-6 shrink-0 items-center justify-center border border-gray-800 bg-black text-gray-300 transition-colors hover:border-[#4FCEEC]/50 hover:text-[#4FCEEC]"
                    title="Add extra stream"
                >
                    <Plus className="h-3.5 w-3.5" />
                </button>
            </div>
        </div>
    );
}

/**
 * Individual stream input component
 */
function StreamInput({ stream, loading, error, canRemove, onUrlChange, onRemove }) {
    const status = loading
        ? 'Loading'
        : stream.streamStartTime
            ? 'Synced'
            : error
                ? 'Needs sync'
                : null;

    return (
        <div className="grid grid-cols-[42px_minmax(0,1fr)_28px] items-center gap-0.5 bg-black/40 py-0.5 pr-0.5">
            <div className="min-w-0">
                <span className="block truncate text-[9px] font-bold text-gray-300">
                    {getCompactStreamLabel(stream)}
                </span>
                {status && (
                    <span className={`block truncate text-[7px] font-bold uppercase leading-none ${stream.streamStartTime && !loading ? 'text-green-400' : error ? 'text-yellow-400' : 'text-[#4FCEEC]'}`}>
                        {loading && <Loader className="mr-1 inline h-2.5 w-2.5 animate-spin" />}
                        {status}
                    </span>
                )}
            </div>
            <input
                type="text"
                value={stream.url}
                onChange={(e) => onUrlChange(e.target.value)}
                placeholder="YouTube URL..."
                title={error || ''}
                className="h-7 min-w-0 border border-gray-800 bg-black px-1.5 text-xs text-white outline-none transition-all placeholder:text-gray-600 focus:border-[#4FCEEC]"
            />
            {canRemove ? (
                <button
                    onClick={onRemove}
                    className="flex h-7 w-7 items-center justify-center border border-red-500/20 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
                    title="Remove this stream"
                >
                    <X className="h-3.5 w-3.5" />
                </button>
            ) : (
                <div />
            )}
        </div>
    );
}

export default StreamManager;
