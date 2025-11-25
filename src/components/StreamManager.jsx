import React, { useState, useEffect } from 'react';
import { Tv, Plus, X, Loader, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { extractVideoId, getStreamStartTime } from '../services/youtube';
import { extractVimeoId, isVimeoEvent, getVimeoVideoMetadata, parseVimeoEvent } from '../services/vimeo';
import { getMatchDayIndex } from '../utils/streamMatching';

/**
 * StreamManager component - Manages multiple livestream inputs
 * Auto-creates stream boxes based on event duration
 * Allows adding backup streams
 */
function StreamManager({ event, streams, onStreamsChange, onWebcastSelect }) {
    const [loading, setLoading] = useState({});
    const [errors, setErrors] = useState({});

    // Validate stream dates against event dates
    const validateStreamDate = (stream) => {
        if (!stream.streamStartTime || !event) return null;

        const streamDate = new Date(stream.streamStartTime);

        // Convert timestamp to ISO string for getMatchDayIndex
        const streamDateISO = streamDate.toISOString();

        // Get the day index this stream should match based on its actual date
        const actualDayIndex = getMatchDayIndex(streamDateISO, event.start);

        // Check if stream's actual day differs from its assigned day
        if (stream.dayIndex !== null && actualDayIndex !== stream.dayIndex) {
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
        const fetchStreamTimes = async () => {
            for (const stream of streams) {
                if (stream.videoId && !stream.streamStartTime && !loading[stream.id]) {
                    setLoading(prev => ({ ...prev, [stream.id]: true }));
                    setErrors(prev => ({ ...prev, [stream.id]: null }));

                    try {
                        const startTime = await getStreamStartTime(stream.videoId);
                        if (startTime) {
                            updateStream(stream.id, {
                                streamStartTime: new Date(startTime).getTime()
                            });
                            setErrors(prev => ({ ...prev, [stream.id]: null }));
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
        const updatedStreams = streams.map(s =>
            s.id === streamId ? { ...s, ...updates } : s
        );
        onStreamsChange(updatedStreams);
    };

    const handleStreamUrlChange = async (streamId, url) => {
        // Check if it's a Vimeo URL
        if (url && url.includes('vimeo.com')) {
            console.log('[StreamManager] Detected Vimeo URL:', url);

            // Case 2: Vimeo Event Page
            if (isVimeoEvent(url)) {
                const eventId = extractVimeoId(url);
                console.log('[StreamManager] Detected Vimeo event:', eventId);

                setLoading(prev => ({ ...prev, [streamId]: true }));
                setErrors(prev => ({ ...prev, [streamId]: null }));

                try {
                    const eventDays = streams.filter(s => s.dayIndex !== null).length;
                    const eventStartDate = new Date(event.start);

                    const parsedStreams = await parseVimeoEvent(eventId, eventDays, eventStartDate);

                    if (parsedStreams && parsedStreams.length > 0) {
                        console.log('[StreamManager] Auto-detected', parsedStreams.length, 'Vimeo streams');

                        // Replace all streamswith parsed streams
                        const newStreams = streams.map((s, index) => {
                            if (index < parsedStreams.length) {
                                const validation = validateStreamDate(parsedStreams[index]);
                                return {
                                    ...s,
                                    ...parsedStreams[index],
                                    id: s.id
                                };
                            }
                            return s;
                        });

                        onStreamsChange(newStreams);
                    } else {
                        setErrors(prev => ({ ...prev, [streamId]: 'No archived videos found in this event' }));
                    }
                } catch (error) {
                    console.error('[StreamManager] Error parsing Vimeo event:', error);
                    setErrors(prev => ({ ...prev, [streamId]: error.message || 'Error fetching event data' }));
                } finally {
                    setLoading(prev => ({ ...prev, [streamId]: false }));
                }
                return;
            }

            // Case 1: Direct Vimeo Video
            const videoId = extractVimeoId(url);
            if (videoId) {
                console.log('[StreamManager] Detected Vimeo video:', videoId);
                updateStream(streamId, {
                    url: `https://player.vimeo.com/video/${videoId}`,
                    videoId,
                    platform: 'vimeo',
                    streamStartTime: null
                });

                // Fetch metadata
                setLoading(prev => ({ ...prev, [streamId]: true }));
                setErrors(prev => ({ ...prev, [streamId]: null }));

                try {
                    const metadata = await getVimeoVideoMetadata(videoId);
                    const validation = validateStreamDate({ ...streams.find(s => s.id === streamId), streamStartTime: metadata.startTime });

                    updateStream(streamId, {
                        streamStartTime: metadata.startTime,
                        platform: 'vimeo'
                    });

                    if (validation) {
                        setErrors(prev => ({ ...prev, [streamId]: validation }));
                    }
                } catch (error) {
                    console.error('[StreamManager] Error fetching Vimeo metadata:', error);
                    setErrors(prev => ({ ...prev, [streamId]: error.message || 'Error fetching video data' }));
                } finally {
                    setLoading(prev => ({ ...prev, [streamId]: false }));
                }
            }
            return;
        }

        // YouTube handling (unchanged)
        const videoId = extractVideoId(url);

        if (videoId) {
            updateStream(streamId, { url, videoId, platform: 'youtube', streamStartTime: null });
        } else if (!url) {
            updateStream(streamId, { url: '', videoId: null, platform: 'youtube', streamStartTime: null });
        } else {
            updateStream(streamId, { url, platform: 'youtube' });
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
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold flex items-center gap-2">
                    <Tv className="w-5 h-5 text-[#4FCEEC]" />
                    Livestream URLs
                </h3>
                <button
                    onClick={addStream}
                    className="text-xs px-3 py-1.5 bg-[#4FCEEC]/20 hover:bg-[#4FCEEC]/30 text-[#4FCEEC] rounded-lg transition-colors flex items-center gap-1"
                >
                    <Plus className="w-3.5 h-3.5" />
                    Add Backup Stream
                </button>
            </div>

            <div className="space-y-3">
                {streams.map((stream) => {
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
