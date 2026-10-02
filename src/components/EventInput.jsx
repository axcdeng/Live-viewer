import React, { useState } from 'react';
import { Search, Link as LinkIcon, AlertCircle } from 'lucide-react';
import { getEventBySku } from '../services/robotevents';
import { extractVideoId } from '../services/youtube';

const EventInput = ({ onEventFound }) => {
    const [url, setUrl] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [manualWebcast, setManualWebcast] = useState('');
    const [showManualWebcast, setShowManualWebcast] = useState(false);
    const [foundEvent, setFoundEvent] = useState(null);

    const handleSearch = async () => {
        setLoading(true);
        setError('');
        setFoundEvent(null);
        setShowManualWebcast(false);

        try {
            // Extract SKU from URL (e.g., RE-VRC-XX-XXXX)
            const skuMatch = url.match(/((?:RE|VE)-[A-Z0-9]+-\d{2}-\d+)/i);
            if (!skuMatch) {
                throw new Error('Invalid event URL. Could not find SKU.');
            }
            const sku = skuMatch[1];

            const event = await getEventBySku(sku);
            setFoundEvent(event);

            // Check for webcasts
            // Note: API doesn't always return webcasts in the main object, 
            // but if it did, we'd check event.webcasts.
            // For now, we assume we might need to ask the user.

            // If we want to be smart, we can check if the user pasted a youtube link in the "manual" field already
            // But let's just see if we can proceed.

            onEventFound(event, null); // Pass null for webcast initially to trigger next step logic or manual input

        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleManualWebcastSubmit = () => {
        if (!foundEvent) return;
        const videoId = extractVideoId(manualWebcast);
        if (videoId) {
            onEventFound(foundEvent, videoId);
        } else {
            setError('Invalid YouTube URL');
        }
    };

    return (
        <div className="w-full max-w-2xl mx-auto space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="text-center space-y-2">
                <h1 className="text-4xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-500">
                    VEX Match Jumper
                </h1>
                <p className="text-slate-400">
                    Jump directly to your matches in the livestream.
                </p>
            </div>

            <div className="bg-slate-800/50 p-6 rounded-2xl border border-slate-700 backdrop-blur-sm">
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">
                            RobotEvents Event URL
                        </label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={url}
                                onChange={(e) => setUrl(e.target.value)}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-3 text-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="https://events.vex.com/robot-competitions/vex-robotics-competition/..."
                            />
                            <button
                                onClick={handleSearch}
                                disabled={loading || !url}
                                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2"
                            >
                                {loading ? 'Searching...' : <><Search className="w-4 h-4" /> Find</>}
                            </button>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-3 rounded-lg flex items-center gap-2 text-sm">
                            <AlertCircle className="w-4 h-4" />
                            {error}
                        </div>
                    )}

                    {foundEvent && (
                        <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg">
                            <h3 className="font-bold text-green-400">{foundEvent.name}</h3>
                            <p className="text-green-500/80 text-sm">{foundEvent.location.venue}, {foundEvent.location.city}</p>

                            <div className="mt-4 pt-4 border-t border-green-500/20">
                                <label className="block text-sm font-medium text-slate-300 mb-1">
                                    Livestream URL
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={manualWebcast}
                                        onChange={(e) => setManualWebcast(e.target.value)}
                                        className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-green-500 outline-none"
                                        placeholder="https://youtube.com/watch?v=..."
                                    />
                                    <button
                                        onClick={handleManualWebcastSubmit}
                                        className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                                    >
                                        Go
                                    </button>
                                </div>
                                <p className="text-xs text-slate-500 mt-1">
                                    We couldn't automatically find the active stream. Please paste it here.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventInput;
