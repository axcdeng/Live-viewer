import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
// import routesData from '../data/routes.json'; // Removed static import
import { Loader, AlertCircle } from 'lucide-react';

function RouteResolver() {
    const { shortCode } = useParams();
    const navigate = useNavigate();
    const [error, setError] = useState(null);

    useEffect(() => {
        const resolveRoute = async () => {
            try {
                // Fetch routes from API
                const res = await fetch('/api/get-all-routes');
                if (!res.ok) throw new Error('Failed to fetch routes configuration');

                const routesData = await res.json();

                // Find the route in the configuration
                const routeConfig = routesData.find(r => r.path === shortCode);

                if (routeConfig) {
                    // Construct the query string
                    const params = new URLSearchParams();
                    params.set('sku', routeConfig.sku);

                    // Add streams
                    routeConfig.streams.forEach((stream, index) => {
                        // Assuming streams are saved as an array of objects with url/videoId or simple strings
                        // Adapting to likely formats
                        const videoId = typeof stream === 'string' ? stream : (stream.videoId || stream.id);
                        const isLive = typeof stream === 'object' && stream.isLive;

                        // Use indexed params for multi-stream/multi-day
                        if (routeConfig.streams.length === 1) {
                            if (isLive) {
                                params.set('live', videoId);
                            } else {
                                params.set('vid', videoId);
                            }
                        } else {
                            const suffix = index + 1; // 1-based index (vid1, vid2)
                            if (isLive) {
                                params.set(`live${suffix}`, videoId);
                            } else {
                                params.set(`vid${suffix}`, videoId);
                            }
                        }
                    });

                    // Redirect to home with params
                    // Use replace to prevent back button from landing here again
                    navigate(`/?${params.toString()}`, { replace: true });
                } else {
                    setError(`Route "${shortCode}" not found.`);
                    // Optional: Redirect to home after a delay
                    setTimeout(() => navigate('/'), 3000);
                }
            } catch (err) {
                console.error('Route resolution error:', err);
                setError('Failed to resolve route.');
            }
        };

        resolveRoute();
    }, [shortCode, navigate]);

    if (error) {
        return (
            <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
                <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-6 py-4 rounded-xl flex items-center gap-3">
                    <AlertCircle className="w-6 h-6" />
                    <p className="font-medium">{error}</p>
                </div>
                <p className="mt-4 text-gray-500 text-sm">Redirecting to home...</p>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center">
            <Loader className="w-8 h-8 text-[#4FCEEC] animate-spin mb-4" />
            <p className="text-gray-400 font-mono">Resolving link...</p>
        </div>
    );
}

export default RouteResolver;
