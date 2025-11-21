import React, { useState, useEffect } from 'react';
import { X, Settings, ExternalLink } from 'lucide-react';
import { GlassCard, GlassCardHeader, GlassCardTitle, GlassCardContent, GlassCardFooter } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
            <GlassCard className="w-full max-w-md border-[#4FCEEC]/50 shadow-[0_0_30px_rgba(79,206,236,0.2)]">
                <GlassCardHeader className="flex flex-row items-center justify-between">
                    <GlassCardTitle className="flex items-center gap-2 text-[#4FCEEC]">
                        <Settings className="w-5 h-5" /> API Settings
                    </GlassCardTitle>
                    <Button variant="ghost" size="icon" onClick={onClose} className="text-gray-400 hover:text-white">
                        <X className="w-5 h-5" />
                    </Button>
                </GlassCardHeader>

                <GlassCardContent className="space-y-6">
                    <div className="bg-[#4FCEEC]/10 border border-[#4FCEEC]/30 p-3 rounded-lg text-xs text-white">
                        <p className="font-semibold mb-1">✨ Default keys are already set!</p>
                        <p className="text-gray-300">You can use your own keys if you prefer. Leave blank to use defaults.</p>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-[#4FCEEC]">RobotEvents API Key (Optional)</Label>
                            <a
                                href="https://www.robotevents.com/api/v2"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-gray-400 hover:text-[#4FCEEC] flex items-center gap-1"
                            >
                                Get Key <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                        <Input
                            type="password"
                            value={reKey}
                            onChange={(e) => setReKey(e.target.value)}
                            placeholder="Leave blank to use default"
                            className="bg-black/40 border-white/10 focus:border-[#4FCEEC]"
                        />
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-[#4FCEEC]">YouTube API Key (Optional)</Label>
                            <a
                                href="https://console.cloud.google.com/"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs text-gray-400 hover:text-[#4FCEEC] flex items-center gap-1"
                            >
                                Get Key <ExternalLink className="w-3 h-3" />
                            </a>
                        </div>
                        <Input
                            type="password"
                            value={ytKey}
                            onChange={(e) => setYtKey(e.target.value)}
                            placeholder="Leave blank to use default"
                            className="bg-black/40 border-white/10 focus:border-[#4FCEEC]"
                        />
                    </div>
                </GlassCardContent>

                <GlassCardFooter className="flex gap-2">
                    <Button
                        onClick={handleSave}
                        className="flex-1 bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold"
                    >
                        Save
                    </Button>
                    <Button
                        onClick={handleClearKeys}
                        variant="secondary"
                        className="bg-white/10 hover:bg-white/20 text-white"
                    >
                        Clear
                    </Button>
                </GlassCardFooter>
            </GlassCard>
        </div>
    );
};

export default SettingsModal;
