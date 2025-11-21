import React from 'react';
import { X, Clock, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { getAllHistory, deleteHistoryEntry } from '../services/eventCache';
import { getMatchDayIndex } from '../utils/streamMatching';
import { GlassCard, GlassCardHeader, GlassCardTitle, GlassCardContent, GlassCardFooter } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";

const EventHistory = ({ isOpen, onClose, onSelectEvent }) => {
    if (!isOpen) return null;

    const [history, setHistory] = React.useState([]);

    React.useEffect(() => {
        if (isOpen) {
            setHistory(getAllHistory());
        }
    }, [isOpen]);

    const handleDelete = (eventId, e) => {
        e.stopPropagation();
        deleteHistoryEntry(eventId);
        setHistory(getAllHistory());
    };

    const handleSelectEvent = (historyEntry) => {
        onSelectEvent(historyEntry);
        onClose();
    };

    // Helper: Check if stream date matches event date
    const validateStreamDate = (stream, eventStart, eventEnd) => {
        if (!stream.streamStartTime) return { valid: true };

        const streamDate = new Date(stream.streamStartTime);
        const eventStartDate = new Date(eventStart);
        const eventEndDate = new Date(eventEnd);

        // Check if stream is within event date range
        const streamDateOnly = streamDate.toISOString().split('T')[0];
        const eventStartOnly = eventStartDate.toISOString().split('T')[0];
        const eventEndOnly = eventEndDate.toISOString().split('T')[0];

        if (streamDateOnly < eventStartOnly || streamDateOnly > eventEndOnly) {
            // Stream is outside event dates
            // Check which day it would match
            const matchedDayIndex = getMatchDayIndex(stream.streamStartTime, eventStart);
            return {
                valid: false,
                streamDate: streamDateOnly,
                matchedDayIndex,
                isBeforeEvent: streamDateOnly < eventStartOnly,
                isAfterEvent: streamDateOnly > eventEndOnly
            };
        }

        return { valid: true };
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <GlassCard className="w-full max-w-4xl max-h-[85vh] flex flex-col border-[#4FCEEC]/50 shadow-[0_0_30px_rgba(79,206,236,0.2)]">
                <GlassCardHeader className="flex flex-row items-center justify-between border-b border-white/10 pb-4">
                    <div>
                        <GlassCardTitle className="text-2xl text-[#4FCEEC]">Event History</GlassCardTitle>
                        <p className="text-sm text-gray-400 mt-1">Quick access to previously loaded events</p>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-6 h-6" />
                    </Button>
                </GlassCardHeader>

                <GlassCardContent className="flex-1 overflow-y-auto p-6">
                    {history.length === 0 ? (
                        <div className="text-center py-12">
                            <Clock className="w-16 h-16 text-gray-700 mx-auto mb-4" />
                            <p className="text-gray-500">No event history yet</p>
                            <p className="text-sm text-gray-600 mt-2">Events will appear here after you load them</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {history.map((entry) => {
                                const hasStreams = entry.streams && entry.streams.some(s => s.url);
                                const streamWarnings = entry.streams
                                    ?.map((stream, idx) => {
                                        if (!stream.url) return null;
                                        const validation = validateStreamDate(stream, entry.eventStart, entry.eventEnd);
                                        if (!validation.valid) {
                                            return { stream, validation, idx };
                                        }
                                        return null;
                                    })
                                    .filter(Boolean) || [];

                                return (
                                    <div
                                        key={entry.eventId}
                                        className="bg-white/5 border border-white/10 hover:border-[#4FCEEC]/50 hover:bg-white/10 rounded-xl p-4 transition-all cursor-pointer group"
                                        onClick={() => handleSelectEvent(entry)}
                                    >
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1">
                                                <h3 className="text-white font-bold text-lg group-hover:text-[#4FCEEC] transition-colors">
                                                    {entry.eventName}
                                                </h3>
                                                <p className="text-xs text-gray-500 font-mono">{entry.eventSku}</p>
                                                <p className="text-sm text-gray-400 mt-1">
                                                    {format(new Date(entry.eventStart), 'MMM d')} - {format(new Date(entry.eventEnd), 'MMM d, yyyy')}
                                                </p>
                                            </div>
                                            <Button
                                                onClick={(e) => handleDelete(entry.eventId, e)}
                                                variant="ghost"
                                                size="icon"
                                                className="text-gray-600 hover:text-red-400 hover:bg-red-500/10"
                                                title="Remove from history"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>

                                        {/* Streams */}
                                        {hasStreams && (
                                            <div className="space-y-2">
                                                {entry.streams.map((stream, idx) => {
                                                    if (!stream.url) return null;

                                                    const warning = streamWarnings.find(w => w.idx === idx);

                                                    return (
                                                        <div key={idx} className="flex items-start gap-2 bg-black/40 rounded-lg p-2">
                                                            {warning && (
                                                                <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs text-gray-400 font-semibold">{stream.label}</p>
                                                                <p className="text-xs text-gray-500 truncate">{stream.url}</p>
                                                                {warning && (
                                                                    <div className="mt-1 text-xs text-orange-400">
                                                                        ⚠ Stream date mismatch: {format(new Date(stream.streamStartTime), 'MMM d, yyyy')}
                                                                        {!warning.validation.isBeforeEvent && !warning.validation.isAfterEvent && (
                                                                            <span className="ml-1">
                                                                                (Matches Day {warning.validation.matchedDayIndex + 1})
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        )}

                                        <div className="mt-3 pt-3 border-t border-white/10 flex justify-between items-center">
                                            <span className="text-xs text-gray-500">
                                                Last accessed {format(new Date(entry.lastAccessed), 'MMM d, h:mm a')}
                                            </span>
                                            <span className="text-xs text-[#4FCEEC] opacity-0 group-hover:opacity-100 transition-opacity">
                                                Click to load →
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </GlassCardContent>

                <GlassCardFooter className="p-4 border-t border-white/10 bg-black/20">
                    <Button
                        onClick={onClose}
                        className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold"
                    >
                        Close
                    </Button>
                </GlassCardFooter>
            </GlassCard>
        </div>
    );
};

export default EventHistory;
