import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Viewer from './pages/Viewer';
import Admin from './pages/Admin';
import RouteResolver from './pages/RouteResolver';

function App() {
    return (
        <BrowserRouter>
            <Routes>
                {/* Main Application */}
                <Route path="/" element={<Viewer />} />

                {/* Admin Interface */}
                <Route path="/admin" element={<Admin />} />

                {/* Short Link Resolver (Catch-all for dynamic paths) */}
                <Route path="/:shortCode" element={<RouteResolver />} />
            </Routes>
        </BrowserRouter>
    );
}

export default App;
