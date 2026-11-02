import React, { useState } from 'react';
import FlameScopeApp from './components/FlameScopeApp';
import PlanetaryApp from './PlanetaryApp';

/**
 * Root shell. FlameScope (combustion) is the default application.
 * The original HRM Planetary Manifold Telemetry application is
 * preserved intact as its own mode (src/PlanetaryApp.tsx + the
 * original engine/components) so the adaptation does not destroy it.
 */
export default function App() {
  const [mode, setMode] = useState<'flamescope' | 'planetary'>('flamescope');
  return (
    <div>
      <div className="bg-slate-900 border-b border-slate-700 px-4 py-1.5 flex items-center gap-2 text-xs text-slate-300">
        <span className="font-medium text-slate-200">Application mode:</span>
        <button
          onClick={() => setMode('flamescope')}
          className={`px-2 py-0.5 rounded ${mode === 'flamescope' ? 'bg-orange-500/25 text-orange-200 border border-orange-500/50' : 'border border-slate-600'}`}
        >
          HRM FlameScope — Combustion
        </button>
        <button
          onClick={() => setMode('planetary')}
          className={`px-2 py-0.5 rounded ${mode === 'planetary' ? 'bg-cyan-500/25 text-cyan-200 border border-cyan-500/50' : 'border border-slate-600'}`}
        >
          Original — Planetary Manifold Telemetry
        </button>
        <span className="ml-auto hidden md:inline">Both modes share the preserved HRM engine; FlameScope adds the combustion domain layer.</span>
      </div>
      {mode === 'flamescope' ? <FlameScopeApp /> : <PlanetaryApp />}
    </div>
  );
}
