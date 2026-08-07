import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Viewer from './pages/Viewer';
import Admin from './pages/Admin';
import MoaVimeo from './pages/MoaVimeo';
import Worlds from './pages/Worlds';
import RouteResolver from './pages/RouteResolver';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Main Application */}
                <Route path="/" element={<Viewer />} />

                {/* Admin Interface */}
                <Route path="/admin" element={<Admin />} />

                {/* One-off: Vimeo match sync for the Mall of America Signature.
                    Sits above the short-link catch-all, which would otherwise
                    swallow /admin/*. */}
                <Route path="/admin/moa-vimeo" element={<MoaVimeo />} />

                {/* Worlds Championship Page */}
                <Route path="/worlds" element={<Worlds />} />

                {/* Short Link Resolver (Catch-all for dynamic paths) */}
                <Route path="/:shortCode" element={<RouteResolver />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
