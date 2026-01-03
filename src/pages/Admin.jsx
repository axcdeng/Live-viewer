import React, { useState, useEffect } from 'react';
import { Lock, Plus, Trash2, Save, Copy, Check, ExternalLink, Edit2, X, ChevronDown, ChevronRight, LayoutList, RefreshCw, Layout, AlertCircle } from 'lucide-react';
import { getEventBySku } from '../services/robotevents';
import { calculateEventDays } from '../utils/streamMatching';
import { extractVideoId } from '../services/youtube';

const extractSku = (text) => {
    if (!text) return '';
    // Handle full RobotEvents URL
    // e.g. https://www.robotevents.com/robot-competitions/vex-robotics-competition/RE-VRC-24-5219.html
    const skuMatch = text.match(/(RE-[A-Z0-9-]+)/i);
    if (skuMatch) return skuMatch[1].toUpperCase();
    return text.trim().toUpperCase();
};

function Admin() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Route Management State
    const [routes, setRoutes] = useState([]);
    const [editingIndex, setEditingIndex] = useState(null);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [newRoute, setNewRoute] = useState({
        label: '',
        path: '',
        sku: '',
        streams: [''],
        multiStreams: null
    });

    const [copied, setCopied] = useState(false);
    const [isFetchingEvent, setIsFetchingEvent] = useState(false);
    const [activeDivisionTab, setActiveDivisionTab] = useState(null);
    const [eventDivisions, setEventDivisions] = useState([]);
    const [divisionMismatchWarning, setDivisionMismatchWarning] = useState(null);

    useEffect(() => {
        const sessionAuth = sessionStorage.getItem('adminAuth');
        if (sessionAuth === 'true') {
            setIsAuthenticated(true);
        }

        fetchRoutes();
    }, []);

    const fetchRoutes = async () => {
        try {
            const res = await fetch('/api/get-all-routes');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data)) {
                    setRoutes(data);
                }
            }
        } catch (err) {
            console.error('Failed to fetch routes', err);
        }
    };

    const handleLogin = (e) => {
        e.preventDefault();
        if (username === 'axcdeng' && password === 'robost3m@jump') {
            setIsAuthenticated(true);
            sessionStorage.setItem('adminAuth', 'true');
            setError('');
        } else {
            setError('Invalid credentials');
        }
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
        sessionStorage.removeItem('adminAuth');
    };

    const handleAutoDetect = async () => {
        if (!newRoute.sku) {
            alert('Please enter a SKU first');
            return;
        }

        setIsFetchingEvent(true);
        setDivisionMismatchWarning(null);
        try {
            const event = await getEventBySku(newRoute.sku);
            const days = calculateEventDays(event.start, event.end);
            const apiDivisions = event.divisions && event.divisions.length > 0
                ? event.divisions
                : [{ id: 1, name: 'Default' }];

            // Check for division mismatch if we already have manual divisions
            if (eventDivisions.length > 0 && apiDivisions.length > 0) {
                const manualDivNames = eventDivisions.map(d => (d.name || '').toLowerCase().trim());
                const apiDivNames = apiDivisions.map(d => d.name.toLowerCase().trim());

                // Check if counts differ or names don't match
                const countMismatch = manualDivNames.length !== apiDivNames.length;
                const nameMismatch = !manualDivNames.every((name, idx) =>
                    apiDivNames.some(apiName => apiName.includes(name) || name.includes(apiName))
                );

                if (countMismatch || nameMismatch) {
                    setDivisionMismatchWarning({
                        manual: eventDivisions.map(d => d.name),
                        api: apiDivisions.map(d => d.name),
                        message: `Division mismatch detected! Your manual divisions (${eventDivisions.map(d => d.name).join(', ')}) don't match the API divisions (${apiDivisions.map(d => d.name).join(', ')}). Stream data may need to be remapped.`
                    });
                }
            }

            // Merge API divisions with any existing stream data
            // Try to match by name similarity or position
            const mergedMultiStreams = {};
            apiDivisions.forEach((apiDiv, apiIdx) => {
                // Try to find matching manual division by name
                const matchingManual = eventDivisions.find(d => {
                    const dName = (d.name || '').toLowerCase().trim();
                    const apiName = (apiDiv.name || '').toLowerCase().trim();
                    return dName === apiName ||
                        dName.includes(apiName) ||
                        apiName.includes(dName);
                });

                // Try by position as fallback
                const positionMatch = eventDivisions[apiIdx];

                // Get existing streams: first try name match, then position match, then blank
                const existingStreams = matchingManual
                    ? (newRoute.multiStreams?.[matchingManual.id] || [])
                    : (positionMatch ? (newRoute.multiStreams?.[positionMatch.id] || []) : []);

                // Also check legacy single-division format
                const legacyStreams = apiIdx === 0 ? newRoute.streams : [];
                const finalExisting = existingStreams.length > 0 ? existingStreams : legacyStreams;

                mergedMultiStreams[apiDiv.id] = Array(days).fill('').map((_, i) => finalExisting[i] || '');
            });

            setEventDivisions(apiDivisions);
            setActiveDivisionTab(apiDivisions[0].id);

            setNewRoute(prev => ({
                ...prev,
                label: event.name,
                sku: event.sku,
                multiStreams: mergedMultiStreams
            }));

        } catch (err) {
            console.error('Auto-detect failed', err);
            alert('Failed to fetch event info: ' + err.message);
        } finally {
            setIsFetchingEvent(false);
        }
    };

    const addStreamInput = () => {
        if (eventDivisions.length > 1) {
            const divId = activeDivisionTab;
            const currentDivStreams = newRoute.multiStreams?.[divId] || [];
            const newDivStreams = [...currentDivStreams, ''];
            setNewRoute(prev => ({
                ...prev,
                multiStreams: { ...prev.multiStreams, [divId]: newDivStreams }
            }));
        } else {
            setNewRoute(prev => ({
                ...prev,
                streams: [...prev.streams, '']
            }));
        }
    };

    const updateStreamInput = (index, value) => {
        const processedValue = extractVideoId(value) || value;
        if (eventDivisions.length > 1) {
            const divId = activeDivisionTab;
            const newDivStreams = [...(newRoute.multiStreams[divId] || [])];
            newDivStreams[index] = processedValue;
            setNewRoute(prev => ({
                ...prev,
                multiStreams: { ...prev.multiStreams, [divId]: newDivStreams }
            }));
        } else {
            const newStreams = [...newRoute.streams];
            newStreams[index] = processedValue;
            setNewRoute(prev => ({ ...prev, streams: newStreams }));
        }
    };

    const removeStreamInput = (index) => {
        if (eventDivisions.length > 1) {
            const divId = activeDivisionTab;
            const currentDivStreams = newRoute.multiStreams[divId] || [];
            if (currentDivStreams.length > 1) {
                const newDivStreams = currentDivStreams.filter((_, i) => i !== index);
                setNewRoute(prev => ({
                    ...prev,
                    multiStreams: { ...prev.multiStreams, [divId]: newDivStreams }
                }));
            }
        } else {
            if (newRoute.streams.length > 1) {
                const newStreams = newRoute.streams.filter((_, i) => i !== index);
                setNewRoute(prev => ({ ...prev, streams: newStreams }));
            }
        }
    };

    const handleAutoSave = async (updatedRoutes) => {
        try {
            const response = await fetch('/api/save-routes', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedRoutes),
            });

            if (response.ok) {
                setSuccessMessage('Successfully saved to cloud!');
                setTimeout(() => setSuccessMessage(''), 3000);
            } else {
                if (response.status === 404) {
                    setSuccessMessage('Saved locally (Dev Mode)!');
                } else {
                    const errText = await response.text();
                    setError('Failed to save changes: ' + (errText || response.statusText));
                }
            }
        } catch (err) {
            console.error('Auto-save error', err);
            setError('Connection error. Could not save to cloud.');
        }
    };

    const handleSaveRoute = () => {
        if (!newRoute.label || !newRoute.path || !newRoute.sku) {
            alert('Please fill in all required fields');
            return;
        }

        let streams;
        let divisionNames = null;

        if (eventDivisions.length > 1 && newRoute.multiStreams) {
            // Save as object of divisionId -> array of vids
            streams = { ...newRoute.multiStreams };
            // Trim empty strings from the end of each division's array
            Object.keys(streams).forEach(divId => {
                const arr = [...streams[divId]];
                while (arr.length > 1 && arr[arr.length - 1].trim() === '') {
                    arr.pop();
                }
                streams[divId] = arr;
            });

            // Save division names for matching later
            // Format: { divisionId: divisionName, ... }
            divisionNames = eventDivisions.reduce((acc, div) => {
                acc[div.id] = div.name;
                return acc;
            }, {});
        } else if (eventDivisions.length === 1 && newRoute.multiStreams) {
            // Single manual division - still save with multiStreams format
            streams = { ...newRoute.multiStreams };
            Object.keys(streams).forEach(divId => {
                const arr = [...streams[divId]];
                while (arr.length > 1 && arr[arr.length - 1].trim() === '') {
                    arr.pop();
                }
                streams[divId] = arr;
            });
            divisionNames = { [eventDivisions[0].id]: eventDivisions[0].name };
        } else {
            // Trim trailing empty streams
            streams = [...newRoute.streams];
            while (streams.length > 1 && streams[streams.length - 1].trim() === '') {
                streams.pop();
            }
        }

        const routeData = {
            label: newRoute.label,
            path: newRoute.path,
            sku: newRoute.sku,
            streams: streams,
            ...(divisionNames && { divisionNames })
        };

        let updatedRoutes;
        if (editingIndex !== null) {
            updatedRoutes = [...routes];
            updatedRoutes[editingIndex] = routeData;
        } else {
            updatedRoutes = [...routes, routeData];
        }

        setRoutes(updatedRoutes);
        handleAutoSave(updatedRoutes);
        setDivisionMismatchWarning(null);
        resetForm();
    };

    const startEdit = (index) => {
        setEditingIndex(index);
        setDivisionMismatchWarning(null);
        const route = routes[index];
        const isMulti = !Array.isArray(route.streams) && typeof route.streams === 'object';

        setNewRoute({
            label: route.label,
            path: route.path,
            sku: route.sku,
            streams: isMulti ? [''] : (route.streams.length > 0 ? route.streams : ['']),
            multiStreams: isMulti ? route.streams : null
        });

        if (isMulti) {
            const divIds = Object.keys(route.streams).map(id => parseInt(id));
            // Use saved divisionNames if available, otherwise fallback to "Division {id}"
            const divisionNames = route.divisionNames || {};
            setEventDivisions(divIds.map(id => ({
                id,
                name: divisionNames[id] || `Division ${id}`,
                manual: !!divisionNames[id] // Mark as manual if we had a saved name
            })));
            setActiveDivisionTab(divIds[0]);
        } else {
            setEventDivisions([]);
            setActiveDivisionTab(null);
        }
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const resetForm = () => {
        setEditingIndex(null);
        setEventDivisions([]);
        setActiveDivisionTab(null);
        setDivisionMismatchWarning(null);
        setNewRoute({
            label: '',
            path: '',
            sku: '',
            streams: [''],
            multiStreams: null
        });
    };

    const handleDeleteRoute = (index) => {
        if (confirm('Are you sure you want to delete this route? This cannot be undone.')) {
            const updatedRoutes = routes.filter((_, i) => i !== index);
            setRoutes(updatedRoutes);
            handleAutoSave(updatedRoutes);
            if (editingIndex === index) resetForm();
        }
    };

    const copyConfig = () => {
        const json = JSON.stringify(routes, null, 4);
        navigator.clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleCopyLink = (path) => {
        const url = `${window.location.origin}/${path}`;
        navigator.clipboard.writeText(url);
        setSuccessMessage('Link copied to clipboard!');
        setTimeout(() => setSuccessMessage(''), 3000);
    };

    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
                <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-xl p-8 shadow-2xl">
                    <div className="flex justify-center mb-6">
                        <div className="p-3 bg-gray-800 rounded-full">
                            <Lock className="w-6 h-6 text-[#4FCEEC]" />
                        </div>
                    </div>
                    <h2 className="text-2xl font-bold text-center mb-6">Admin Access</h2>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Username</label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-[#4FCEEC] focus:outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">Password</label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2 text-white focus:border-[#4FCEEC] focus:outline-none"
                            />
                        </div>
                        {error && <p className="text-red-400 text-sm text-center">{error}</p>}
                        <button
                            type="submit"
                            className="w-full bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold py-2 rounded-lg transition-colors"
                        >
                            Login
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 font-sans">
            <header className="max-w-6xl mx-auto flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gray-900 rounded-lg border border-gray-800">
                        <LayoutList className="w-5 h-5 text-[#4FCEEC]" />
                    </div>
                    <h1 className="text-2xl font-bold text-white">Route Manager</h1>
                </div>
                <button
                    onClick={handleLogout}
                    className="text-sm text-gray-400 hover:text-white transition-colors flex items-center gap-2"
                >
                    <X className="w-4 h-4" /> Logout
                </button>
            </header>

            <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

                {/* Editor Section */}
                <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
                    <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 shadow-xl">
                        <div className="flex justify-between items-center mb-6">
                            <h2 className="text-xl font-bold flex items-center gap-2">
                                {editingIndex !== null ? (
                                    <>
                                        <Edit2 className="w-5 h-5 text-yellow-400" />
                                        Edit Short Link
                                    </>
                                ) : (
                                    <>
                                        <Plus className="w-5 h-5 text-[#4FCEEC]" />
                                        Create New Link
                                    </>
                                )}
                            </h2>
                            {editingIndex !== null && (
                                <button
                                    onClick={resetForm}
                                    className="text-xs text-gray-400 hover:text-white flex items-center gap-1 bg-gray-800 px-2 py-1 rounded"
                                >
                                    Cancel
                                </button>
                            )}
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Link Label</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Sunshine Showdown"
                                    value={newRoute.label}
                                    onChange={(e) => setNewRoute({ ...newRoute, label: e.target.value })}
                                    className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none text-white transition-all shadow-inner"
                                />
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1">Url Path</label>
                                    <div className="flex items-center group">
                                        <span className="bg-gray-800 border-y border-l border-gray-700 rounded-l-lg px-3 py-2.5 text-sm text-gray-500 font-mono">/</span>
                                        <input
                                            type="text"
                                            placeholder="path"
                                            value={newRoute.path}
                                            onChange={(e) => setNewRoute({ ...newRoute, path: e.target.value.replace(/[^a-zA-Z0-9-_]/g, '') })}
                                            className="w-full bg-black border border-gray-700 rounded-r-lg px-3 py-2.5 text-sm focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none text-white transition-all shadow-inner font-mono"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5 ml-1 flex justify-between items-center">
                                        RobotEvents SKU
                                        {newRoute.sku && (
                                            <button
                                                onClick={handleAutoDetect}
                                                disabled={isFetchingEvent}
                                                className="text-[#4FCEEC] hover:text-[#3db8d6] flex items-center gap-1 normal-case font-semibold transition-colors disabled:opacity-50"
                                            >
                                                {isFetchingEvent ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                                                Auto-Fill
                                            </button>
                                        )}
                                    </label>
                                    <input
                                        type="text"
                                        placeholder="RE-VRC-XX-XXXX"
                                        value={newRoute.sku}
                                        onChange={(e) => setNewRoute({ ...newRoute, sku: extractSku(e.target.value) })}
                                        className="w-full bg-black border border-gray-700 rounded-lg px-4 py-2.5 text-sm focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none text-white transition-all shadow-inner font-mono"
                                    />
                                </div>
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest ml-1">Streams (YouTube IDs)</label>
                                    {eventDivisions.length > 1 && (
                                        <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-gray-800/50">
                                            {eventDivisions.map((div) => (
                                                <button
                                                    key={div.id}
                                                    onClick={() => setActiveDivisionTab(div.id)}
                                                    className={`px-2 py-1 rounded text-[10px] font-bold transition-all uppercase tracking-wider ${activeDivisionTab === div.id
                                                        ? 'bg-[#4FCEEC] text-black'
                                                        : 'text-gray-500 hover:text-gray-300'
                                                        }`}
                                                >
                                                    {(div.name || `Div ${div.id}`).split(' ')[0]}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Manual Division Controls */}
                                <div className="mb-3 p-3 bg-gray-950 rounded-lg border border-gray-800">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">Divisions</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-[10px] text-gray-600">{eventDivisions.length} division{eventDivisions.length !== 1 ? 's' : ''}</span>
                                            <button
                                                onClick={() => {
                                                    const newDivId = eventDivisions.length > 0
                                                        ? Math.max(...eventDivisions.map(d => d.id)) + 1
                                                        : 1;
                                                    const newDiv = { id: newDivId, name: `Division ${newDivId}`, manual: true };
                                                    const updatedDivisions = [...eventDivisions, newDiv];
                                                    setEventDivisions(updatedDivisions);

                                                    // Initialize streams for the new division
                                                    if (eventDivisions.length === 0) {
                                                        // First division: migrate existing streams array to multiStreams
                                                        const existingStreams = newRoute.streams.length > 0 ? newRoute.streams : [''];
                                                        setNewRoute(prev => ({
                                                            ...prev,
                                                            multiStreams: {
                                                                [newDivId]: existingStreams
                                                            }
                                                        }));
                                                    } else {
                                                        // Additional division: copy structure from first division
                                                        const currentStreams = newRoute.multiStreams || {};
                                                        const defaultDayCount = currentStreams[eventDivisions[0]?.id]?.length || 1;
                                                        setNewRoute(prev => ({
                                                            ...prev,
                                                            multiStreams: {
                                                                ...prev.multiStreams,
                                                                [newDivId]: Array(defaultDayCount).fill('')
                                                            }
                                                        }));
                                                    }

                                                    setActiveDivisionTab(newDivId);
                                                }}
                                                className="px-2 py-1 bg-gray-800 hover:bg-gray-700 text-[10px] text-[#4FCEEC] font-bold rounded border border-gray-700 transition-colors flex items-center gap-1"
                                            >
                                                <Plus className="w-3 h-3" /> Add Division
                                            </button>
                                        </div>
                                    </div>

                                    {eventDivisions.length > 0 && (
                                        <div className="space-y-2">
                                            {eventDivisions.map((div) => (
                                                <div
                                                    key={div.id}
                                                    className={`flex items-center gap-2 px-2 py-1.5 rounded transition-all ${activeDivisionTab === div.id
                                                        ? 'bg-[#4FCEEC]/20 border border-[#4FCEEC]/50'
                                                        : 'bg-gray-800 border border-gray-700'
                                                        }`}
                                                >
                                                    <button
                                                        onClick={() => setActiveDivisionTab(div.id)}
                                                        className="flex-shrink-0"
                                                    >
                                                        <Layout className={`w-3 h-3 ${activeDivisionTab === div.id ? 'text-[#4FCEEC]' : 'text-gray-500'}`} />
                                                    </button>
                                                    <input
                                                        type="text"
                                                        value={div.name}
                                                        onChange={(e) => {
                                                            setEventDivisions(prev => prev.map(d =>
                                                                d.id === div.id ? { ...d, name: e.target.value } : d
                                                            ));
                                                        }}
                                                        onClick={() => setActiveDivisionTab(div.id)}
                                                        className={`flex-1 bg-transparent border-none outline-none text-[11px] font-semibold ${activeDivisionTab === div.id ? 'text-[#4FCEEC]' : 'text-gray-400'
                                                            } focus:text-white placeholder-gray-600`}
                                                        placeholder="Division name..."
                                                    />
                                                    {div.manual && eventDivisions.length > 1 && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (confirm(`Remove ${div.name}?`)) {
                                                                    const updatedDivisions = eventDivisions.filter(d => d.id !== div.id);
                                                                    setEventDivisions(updatedDivisions);

                                                                    // Remove streams for this division
                                                                    const { [div.id]: removed, ...remainingStreams } = newRoute.multiStreams || {};
                                                                    setNewRoute(prev => ({
                                                                        ...prev,
                                                                        multiStreams: remainingStreams
                                                                    }));

                                                                    // Switch to another division if this was active
                                                                    if (activeDivisionTab === div.id && updatedDivisions.length > 0) {
                                                                        setActiveDivisionTab(updatedDivisions[0].id);
                                                                    }
                                                                }
                                                            }}
                                                            className="flex-shrink-0 text-red-400 hover:text-red-300"
                                                            title="Remove division"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {eventDivisions.length === 0 && (
                                        <p className="text-[10px] text-gray-600 italic">No divisions set. Click "Add Division" to manually configure, or use "Auto-Fill" to detect from RobotEvents.</p>
                                    )}
                                </div>

                                {/* Division Mismatch Warning */}
                                {divisionMismatchWarning && (
                                    <div className="mb-3 p-3 bg-yellow-500/10 border border-yellow-500/50 rounded-lg">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />
                                            <div className="flex-1">
                                                <p className="text-[11px] font-bold text-yellow-500 mb-1">Division Mismatch Detected</p>
                                                <p className="text-[10px] text-yellow-400/80 mb-2">
                                                    Your preset divisions don't match the API. Stream data has been auto-remapped by position, but you may need to verify.
                                                </p>
                                                <div className="flex gap-4 text-[10px]">
                                                    <div>
                                                        <span className="text-gray-500">Your names:</span>
                                                        <span className="text-gray-300 ml-1">{divisionMismatchWarning.manual.join(', ')}</span>
                                                    </div>
                                                    <div>
                                                        <span className="text-gray-500">API names:</span>
                                                        <span className="text-gray-300 ml-1">{divisionMismatchWarning.api.join(', ')}</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setDivisionMismatchWarning(null)}
                                                className="text-gray-500 hover:text-white"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                )}

                                <div className="space-y-2">
                                    {(eventDivisions.length > 1 ? (newRoute.multiStreams?.[activeDivisionTab] || []) : newRoute.streams).map((stream, idx) => (
                                        <div key={idx} className="flex gap-2">
                                            <div className="flex-shrink-0 w-10 flex items-center justify-center bg-gray-800 rounded-l-lg text-[10px] text-gray-500 font-bold border-y border-l border-gray-700">
                                                D{idx + 1}
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="e.g. dQw4w9WgXcQ"
                                                value={stream}
                                                onChange={(e) => updateStreamInput(idx, e.target.value)}
                                                className="flex-1 bg-black border border-gray-700 px-3 py-2.5 text-sm focus:border-[#4FCEEC] focus:ring-1 focus:ring-[#4FCEEC] outline-none text-white transition-all font-mono"
                                            />
                                            {(eventDivisions.length > 1 ? (newRoute.multiStreams?.[activeDivisionTab]?.length > 1) : newRoute.streams.length > 1) && (
                                                <button
                                                    onClick={() => removeStreamInput(idx)}
                                                    className="px-3 bg-gray-800 hover:bg-red-500/10 text-red-400 border border-gray-700 rounded-r-lg transition-colors"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={addStreamInput}
                                        className="w-full py-2 border border-dashed border-gray-700 rounded-lg text-xs text-gray-500 hover:border-[#4FCEEC] hover:text-[#4FCEEC] transition-all flex items-center justify-center gap-2 mt-2"
                                    >
                                        <Plus className="w-3 h-3" /> Add Stream
                                    </button>
                                </div>
                            </div>

                            {successMessage && (
                                <div className="flex items-center gap-2 text-green-400 bg-green-500/10 border border-green-500/50 p-3 rounded-lg text-xs font-bold animate-in fade-in slide-in-from-bottom-2">
                                    <Check className="w-4 h-4" /> {successMessage}
                                </div>
                            )}

                            {error && (
                                <div className="flex items-center gap-2 text-red-500 bg-red-500/10 border border-red-500/50 p-3 rounded-lg text-xs font-bold">
                                    <Trash2 className="w-4 h-4" /> {error}
                                </div>
                            )}

                            <button
                                onClick={handleSaveRoute}
                                className={`w-full font-bold py-3.5 rounded-lg transition-all flex items-center justify-center gap-2 shadow-lg ${editingIndex !== null
                                    ? 'bg-yellow-500 hover:bg-yellow-600 text-black'
                                    : 'bg-[#4FCEEC] hover:bg-[#3db8d6] text-black'
                                    }`}
                            >
                                {editingIndex !== null ? <Save className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                                {editingIndex !== null ? 'Update Route' : 'Create Short Link'}
                            </button>
                        </div>
                    </section>
                </div>

                {/* List Section */}
                <div className="lg:col-span-7 space-y-6">
                    <div className="flex justify-between items-end mb-2">
                        <div>
                            <h2 className="text-xl font-bold">Active Links</h2>
                            <p className="text-xs text-gray-500">Currently live and redirecting</p>
                        </div>
                        <div className="text-xs font-mono text-gray-600 bg-gray-900 px-2 py-1 rounded">
                            {routes.length} link{routes.length !== 1 ? 's' : ''}
                        </div>
                    </div>

                    <div className="space-y-4">
                        {routes.length === 0 ? (
                            <div className="bg-gray-900/50 border border-dashed border-gray-800 rounded-xl p-12 text-center">
                                <LayoutList className="w-12 h-12 text-gray-800 mx-auto mb-4" />
                                <p className="text-gray-500">No links created yet.</p>
                            </div>
                        ) : (
                            routes.map((route, idx) => (
                                <div key={idx} className={`group bg-gray-900 border border-gray-800 rounded-xl p-5 hover:border-gray-600 transition-all ${editingIndex === idx ? 'ring-2 ring-yellow-500/50 border-yellow-500/50' : 'shadow-lg'}`}>
                                    <div className="flex justify-between items-start gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <h3 className="font-bold text-lg text-white truncate">{route.label}</h3>
                                                <span className="bg-[#4FCEEC]/10 text-[#4FCEEC] border border-[#4FCEEC]/20 rounded px-2 py-0.5 text-[10px] font-mono font-bold">
                                                    /{route.path}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1">
                                                <div className="flex items-center gap-1 text-xs text-gray-400">
                                                    <LayoutList className="w-3 h-3" />
                                                    <span className="font-mono">{route.sku}</span>
                                                </div>
                                                <a
                                                    href={`/${route.path}`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-1 text-xs text-gray-400 hover:text-[#4FCEEC] transition-colors"
                                                    title="Open in new tab"
                                                >
                                                    <ExternalLink className="w-3 h-3" />
                                                    <span>{Array.isArray(route.streams) ? route.streams.length : Object.keys(route.streams).length} streams</span>
                                                </a>
                                            </div>
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button
                                                onClick={() => handleCopyLink(route.path)}
                                                className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors border border-gray-700"
                                                title="Copy Link"
                                            >
                                                <Copy className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => startEdit(idx)}
                                                className="p-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors border border-gray-700"
                                                title="Edit Link"
                                            >
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteRoute(idx)}
                                                className="p-2.5 bg-gray-800 hover:bg-red-500/20 text-red-400 rounded-lg transition-colors border border-gray-700"
                                                title="Delete Link"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Advanced Section */}
                    <div className="pt-8 mt-8 border-t border-gray-800">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="flex items-center gap-2 text-xs text-gray-600 hover:text-gray-400 transition-colors uppercase tracking-widest font-bold"
                        >
                            {showAdvanced ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            Advanced: View JSON Config
                        </button>

                        {showAdvanced && (
                            <div className="mt-4 animate-in fade-in slide-in-from-top-2 duration-300">
                                <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
                                    <div className="flex justify-between items-center px-4 py-3 bg-gray-950/50 border-b border-gray-800">
                                        <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">routes.json</span>
                                        <button
                                            onClick={copyConfig}
                                            className={`flex items-center gap-2 px-3 py-1 rounded-md text-[10px] font-bold transition-all ${copied
                                                ? 'bg-green-500 text-black'
                                                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                                                }`}
                                        >
                                            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                            {copied ? 'Copied' : 'Copy JSON'}
                                        </button>
                                    </div>
                                    <div className="p-4 bg-black font-mono text-xs text-gray-400 overflow-auto max-h-[400px]">
                                        <pre className="whitespace-pre-wrap break-all">
                                            {JSON.stringify(routes, null, 4)}
                                        </pre>
                                    </div>
                                </div>
                                <p className="mt-2 text-[10px] text-gray-600 italic">
                                    Note: Live changes are saved to Edge Config. Use this JSON for manual backups or initial-state code commits.
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </main>
        </div>
    );
}

export default Admin;
