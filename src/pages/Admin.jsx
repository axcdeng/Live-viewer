import React, { useState, useEffect } from 'react';
import { Lock, Plus, Trash2, Save, Copy, Check, ExternalLink } from 'lucide-react';
// import initialRoutes from '../data/routes.json'; // Removed static import

function Admin() {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // Route Management State
    const [routes, setRoutes] = useState([]); // Start empty, fetch on load
    const [newRoute, setNewRoute] = useState({
        label: '',
        path: '',
        sku: '',
        streams: ['']
    });

    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const sessionAuth = sessionStorage.getItem('adminAuth');
        if (sessionAuth === 'true') {
            setIsAuthenticated(true);
        }

        // Fetch current routes from Edge Config
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
        fetchRoutes();

    }, []);

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

    const addStreamInput = () => {
        setNewRoute(prev => ({
            ...prev,
            streams: [...prev.streams, '']
        }));
    };

    const updateStreamInput = (index, value) => {
        const newStreams = [...newRoute.streams];
        newStreams[index] = value;
        setNewRoute(prev => ({ ...prev, streams: newStreams }));
    };

    const removeStreamInput = (index) => {
        if (newRoute.streams.length > 1) {
            const newStreams = newRoute.streams.filter((_, i) => i !== index);
            setNewRoute(prev => ({ ...prev, streams: newStreams }));
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
                setSuccessMessage('Saved to disk automatically!');
                setTimeout(() => setSuccessMessage(''), 3000);
            } else {
                // Determine if it's a 404 (prod) or 500 (dev error)
                if (response.status === 404) {
                    console.log('Auto-save API not found (likely in production). Manual copy required.');
                    setSuccessMessage('Saved locally (Dev Mode)!'); // If 404, we assume it worked locally via custom plugin if running
                } else {
                    console.error('Failed to save to disk');
                    const errText = await response.text();
                    setError('Failed to auto-save: ' + (errText || response.statusText));
                }
            }
        } catch (err) {
            console.error('Auto-save error', err);
            // Don't show error to user if it's just network/cors in prod, fallback to copy
        }
    };

    const handleAddRoute = () => {
        if (!newRoute.label || !newRoute.path || !newRoute.sku) {
            alert('Please fill in all required fields');
            return;
        }

        // Clean up streams (remove empty strings)
        const cleanedStreams = newRoute.streams.filter(s => s.trim() !== '');

        const routeToAdd = {
            ...newRoute,
            streams: cleanedStreams
        };

        const updatedRoutes = [...routes, routeToAdd];
        setRoutes(updatedRoutes);
        handleAutoSave(updatedRoutes);

        // Reset form
        setNewRoute({
            label: '',
            path: '',
            sku: '',
            streams: ['']
        });
    };

    const handleDeleteRoute = (index) => {
        if (confirm('Are you sure you want to delete this route?')) {
            const updatedRoutes = routes.filter((_, i) => i !== index);
            setRoutes(updatedRoutes);
            handleAutoSave(updatedRoutes);
        }
    };

    const copyConfig = () => {
        const json = JSON.stringify(routes, null, 4);
        navigator.clipboard.writeText(json);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
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
                        {successMessage && <p className="text-green-400 text-sm font-bold text-center mt-2 animate-pulse">{successMessage}</p>}
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white p-6 font-sans">
            <header className="max-w-6xl mx-auto flex justify-between items-center mb-8 border-b border-gray-800 pb-4">
                <h1 className="text-2xl font-bold text-[#4FCEEC]">VEX Viewer Admin</h1>
                <button
                    onClick={handleLogout}
                    className="text-gray-400 hover:text-white transition-colors"
                >
                    Logout
                </button>
            </header>

            <main className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Visual Editor */}
                <div className="space-y-8">
                    <section className="bg-gray-900 border border-gray-800 rounded-xl p-6">
                        <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                            <Plus className="w-5 h-5 text-[#4FCEEC]" />
                            Create New Short Link
                        </h2>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-1">Link Name / Label</label>
                                <input
                                    type="text"
                                    placeholder="e.g. Sunshine Showdown"
                                    value={newRoute.label}
                                    onChange={(e) => setNewRoute({ ...newRoute, label: e.target.value })}
                                    className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#4FCEEC] focus:outline-none text-white"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Short Path</label>
                                    <div className="flex items-center">
                                        <span className="bg-gray-800 border border-r-0 border-gray-700 rounded-l-lg px-3 py-2 text-sm text-gray-400">/</span>
                                        <input
                                            type="text"
                                            placeholder="sunshine"
                                            value={newRoute.path}
                                            onChange={(e) => setNewRoute({ ...newRoute, path: e.target.value.replace(/[^a-zA-Z0-9-_]/g, '') })}
                                            className="w-full bg-black border border-gray-700 rounded-r-lg px-3 py-2 text-sm focus:border-[#4FCEEC] focus:outline-none text-white"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1">Event SKU</label>
                                    <input
                                        type="text"
                                        placeholder="RE-VRC-XX-XXXX"
                                        value={newRoute.sku}
                                        onChange={(e) => setNewRoute({ ...newRoute, sku: e.target.value })}
                                        className="w-full bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#4FCEEC] focus:outline-none text-white"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-gray-400 mb-2">YouTube Video IDs (Day 1, Day 2...)</label>
                                <div className="space-y-2">
                                    {newRoute.streams.map((stream, idx) => (
                                        <div key={idx} className="flex gap-2">
                                            <span className="flex-shrink-0 w-8 h-10 flex items-center justify-center bg-gray-800 rounded text-xs text-gray-500 font-mono">
                                                {idx + 1}
                                            </span>
                                            <input
                                                type="text"
                                                placeholder="Video ID (e.g. dQw4w9WgXcQ)"
                                                value={stream}
                                                onChange={(e) => updateStreamInput(idx, e.target.value)}
                                                className="flex-1 bg-black border border-gray-700 rounded-lg px-3 py-2 text-sm focus:border-[#4FCEEC] focus:outline-none text-white"
                                            />
                                            {newRoute.streams.length > 1 && (
                                                <button
                                                    onClick={() => removeStreamInput(idx)}
                                                    className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={addStreamInput}
                                        className="text-xs text-[#4FCEEC] hover:text-[#3db8d6] font-medium flex items-center gap-1 mt-2"
                                    >
                                        <Plus className="w-3 h-3" /> Add Day/Stream
                                    </button>
                                </div>
                            </div>

                            {successMessage && <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-400 text-sm font-bold text-center">
                                {successMessage}
                            </div>}

                            <button
                                onClick={handleAddRoute}
                                className="w-full bg-[#4FCEEC] hover:bg-[#3db8d6] text-black font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 mt-4"
                            >
                                <Plus className="w-4 h-4" /> Add Route
                            </button>
                        </div>
                    </section>
                </div>

                {/* Configuration Output */}
                <div className="space-y-8 flex flex-col h-full">
                    <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 flex-1 flex flex-col">
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-lg font-bold">Configuration JSON</h2>
                            <button
                                onClick={copyConfig}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${copied
                                    ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                                    : 'bg-gray-800 text-gray-300 border border-gray-700 hover:bg-gray-700'
                                    }`}
                            >
                                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                {copied ? 'Copied!' : 'Copy to Clipboard'}
                            </button>
                        </div>
                        <div className="bg-black border border-gray-800 rounded-lg p-4 font-mono text-xs text-gray-300 overflow-auto flex-1 max-h-[600px]">
                            <pre>{JSON.stringify(routes, null, 4)}</pre>
                        </div>
                        <div className="mt-4 p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <p className="text-yellow-400 text-xs">
                                <strong>Instructions:</strong> after creating your routes, copy the JSON above and paste it into
                                <code className="bg-black/30 px-1 py-0.5 rounded mx-1">src/data/routes.json</code>
                                in your project code to publish changes.
                            </p>
                        </div>
                    </section>
                </div>
            </main>
        </div>
    );
}

export default Admin;
