import React, { useState, useEffect } from 'react';
import { X, Settings, ExternalLink } from 'lucide-react';

const SettingsModal = ({ isOpen, onClose }) => {
    const [reKey, setReKey] = useState('');
    const [ytKey, setYtKey] = useState('');

    useEffect(() => {
        if (isOpen) {
            setReKey(localStorage.getItem('robotevents_api_key') || '');
            setYtKey(localStorage.getItem('youtube_api_key') || '');
        }
    }, [isOpen]);

    const handleSave = () => {
        localStorage.setItem('robotevents_api_key', reKey);
        localStorage.setItem('youtube_api_key', ytKey);
        onClose();
    };

    const handleClearKeys = () => {
        setReKey('');
        setYtKey('');
        localStorage.removeItem('robotevents_api_key');
        localStorage.removeItem('youtube_api_key');
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="bg-black border-2 border-[#4FCEEC] p-6 rounded-xl w-full max-w-md shadow-2xl shadow-[#4FCEEC]/20">
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-xl font-bold text-[#4FCEEC] flex items-center gap-2">
                        <Settings className="w-5 h-5" /> API Settings
                    </h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="bg-[#4FCEEC]/10 border border-[#4FCEEC]/30 p-3 rounded-lg text-xs text-white">
                        <p className="font-semibold mb-1">✨ Default keys are already set!</p>
                        <p className="text-gray-300">You can use your own keys if you prefer. Leave blank to use defaults.</p>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[#4FCEEC] mb-1 flex items-center justify-between">
                            <span>RobotEvents API Key (Optional)</span>
                            <a
                                href="https://events.vex.com/api/v2"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-gray-400 hover:text-[#4FCEEC] flex items-center gap-1"
                            >
                                Get Key <ExternalLink className="w-3 h-3" />
                            </a>
                        </label>
                        <input
                            type="password"
                            value={reKey}
                            onChange={(e) => setReKey(e.target.value)}
                            className="w-full bg-black border border-gray-700 focus:border-[#4FCEEC] rounded-lg px-4 py-2 text-white outline-none transition-colors"
                            placeholder="Leave blank to use default"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-[#4FCEEC] mb-1 flex items-center justify-between">
                            <span>YouTube API Key (Optional)</span>
                            <a
                                href="https://console.cloud.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-gray-400 hover:text-[#4FCEEC] flex items-center gap-1"
                            >
                                Get Key <ExternalLink className="w-3 h-3" />
                            </a>
                        </label>
                        <input
                            type="password"
                            value={ytKey}
                            onChange={(e) => setYtKey(e.target.value)}
                            className="w-full bg-black border border-gray-700 focus:border-[#4FCEEC] rounded-lg px-4 py-2 text-white outline-none transition-colors"
                            placeholder="Leave blank to use default"
                        />
                    </div>

                    <div className="flex gap-2 mt-6">
                        <button
                            onClick={handleSave}
                            className="flex-1 bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold py-2 rounded-lg transition-colors"
                        >
                            Save
                        </button>
                        <button
                            onClick={handleClearKeys}
                            className="px-4 bg-gray-800 hover:bg-gray-700 text-white font-semibold py-2 rounded-lg transition-colors"
                        >
                            Clear
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
