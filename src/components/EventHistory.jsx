import React from 'react';
import { X, Clock, Trash2, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { getAllHistory, deleteHistoryEntry } from '../services/eventCache';
import { getMatchDayIndex } from '../utils/streamMatching';

// Safe date formatting helper
const safeFormat = (dateValue, formatStr, fallback = 'Unknown') => {
    try {
        if (!dateValue) return fallback;
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return fallback;
        return format(date, formatStr);
    } catch (err) {
        console.error('Date format error:', err, dateValue);
        return fallback;
    }
};

const EventHistory = ({ isOpen, onClose, onSelectEvent }) => {
    const [history, setHistory] = React.useState([]);

    React.useEffect(() => {
        if (isOpen) {
            setHistory(getAllHistory());
        }
    }, [isOpen]);

    if (!isOpen) return null;

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

        try {
            const streamDate = new Date(stream.streamStartTime);
            const eventStartDate = new Date(eventStart);
            const eventEndDate = new Date(eventEnd);

            // Check if dates are valid
            if (isNaN(streamDate.getTime()) || isNaN(eventStartDate.getTime()) || isNaN(eventEndDate.getTime())) {
                return { valid: true }; // Skip validation if dates are invalid
            }

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
        } catch (err) {
            console.error('Error validating stream date:', err);
            return { valid: true }; // Skip validation on error
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-gray-900 border-2 border-[#4FCEEC] rounded-2xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl shadow-[#4FCEEC]/20">
                <div className="p-6 border-b border-gray-800 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-bold text-[#4FCEEC]">Event History</h2>
                        <p className="text-sm text-gray-400 mt-1">Quick access to previously loaded events</p>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-6 h-6" />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
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
                                        className="bg-black border border-gray-800 hover:border-[#4FCEEC]/50 rounded-xl p-4 transition-all cursor-pointer group"
                                        onClick={() => handleSelectEvent(entry)}
                                    >
                                        <div className="flex justify-between items-start mb-3">
                                            <div className="flex-1">
                                                <h3 className="text-white font-bold text-lg group-hover:text-[#4FCEEC] transition-colors">
                                                    {entry.eventName}
                                                </h3>
                                                <p className="text-xs text-gray-500 font-mono">{entry.eventSku}</p>
                                                <p className="text-sm text-gray-400 mt-1">
                                                    {safeFormat(entry.eventStart, 'MMM d')} - {safeFormat(entry.eventEnd, 'MMM d, yyyy')}
                                                </p>
                                            </div>
                                            <button
                                                onClick={(e) => handleDelete(entry.eventId, e)}
                                                className="p-2 text-gray-600 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                                                title="Remove from history"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>

                                        {/* Streams */}
                                        {hasStreams && (
                                            <div className="space-y-2">
                                                {entry.streams.map((stream, idx) => {
                                                    if (!stream.url) return null;

                                                    const warning = streamWarnings.find(w => w.idx === idx);

                                                    return (
                                                        <div key={idx} className="flex items-start gap-2 bg-gray-900 rounded-lg p-2">
                                                            {warning && (
                                                                <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />
                                                            )}
                                                            <div className="flex-1 min-w-0">
                                                                <p className="text-xs text-gray-400 font-semibold">{stream.label}</p>
                                                                <p className="text-xs text-gray-500 truncate">{stream.url}</p>
                                                                {warning && (
                                                                    <div className="mt-1 text-xs text-orange-400">
                                                                        ⚠ Stream date mismatch: {safeFormat(stream.streamStartTime, 'MMM d, yyyy')}
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

                                        <div className="mt-3 pt-3 border-t border-gray-800 flex justify-between items-center">
                                            <span className="text-xs text-gray-500">
                                                Last accessed {safeFormat(entry.lastAccessed, 'MMM d, h:mm a')}
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
                </div>

                <div className="p-4 border-t border-gray-800 bg-gray-900/50">
                    <button
                        onClick={onClose}
                        className="w-full bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default EventHistory;
