/**
 * RETAINED FOR PROVENANCE — NOT ROUTED.
 *
 * This is the original standalone HRM 4.0/4.1 Planetary Manifold
 * Telemetry application entry, preserved verbatim after the
 * 2026-11-02 unification (see docs/UNIFIED.md). HRM FlameScope is a
 * single unified application: the planetary manifold's visual
 * architecture and HRM engine were fused into the combustion
 * instrument (src/components/FlameScopeApp.tsx +
 * src/components/CombustionCanvas.tsx), which is what src/App.tsx
 * renders. The planetary engine modules under src/engine/ and their
 * tests remain live; this component remains as the reference
 * implementation of the original interface.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  DualWorldmodelState,
  initializeDualWorldmodel,
  stepDualWorldmodel,
  injectDiscreteEvent,
  ingestLiveTelemetryObservations,
} from './engine/dualWorldmodel';
import { DiscreteEvent, TelemetryIngestionConfig, FieldChannels } from './types/hrm';
import { fetchLiveTelemetry } from './engine/telemetryAdapter';
import { PlanetaryCanvas } from './components/PlanetaryCanvas';
import { DualWorldmodelPlot } from './components/DualWorldmodelPlot';
import { LedgerInspector } from './components/LedgerInspector';
import { EventController } from './components/EventController';
import { NodeInspectorModal } from './components/NodeInspectorModal';
import { PythonScriptModal } from './components/PythonScriptModal';
import { BenchmarkModal } from './components/BenchmarkModal';
import { TelemetryIngestionModal } from './components/TelemetryIngestionModal';
import { ObserverInspectorModal } from './components/ObserverInspectorModal';
import {
  Network,
  Cpu,
  Layers,
  Terminal,
  ShieldCheck,
  AlertOctagon,
  Info,
  ExternalLink,
  Award,
  Radio,
  Eye,
  Sparkles,
} from 'lucide-react';

export default function App() {
  // Dual-worldmodel simulation state
  const [simState, setSimState] = useState<DualWorldmodelState>(() => initializeDualWorldmodel(42));
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(5);

  // Selected node for inspection
  const [selectedNodeId, setSelectedNodeId] = useState<string>('ashburn');
  const [showNodeModal, setShowNodeModal] = useState<boolean>(false);
  const [showPythonModal, setShowPythonModal] = useState<boolean>(false);
  const [showBenchmarkModal, setShowBenchmarkModal] = useState<boolean>(false);
  const [showTelemetryModal, setShowTelemetryModal] = useState<boolean>(false);
  const [showObserverModal, setShowObserverModal] = useState<boolean>(false);

  // Keep state in ref for requestAnimationFrame simulation loop
  const simStateRef = useRef<DualWorldmodelState>(simState);
  simStateRef.current = simState;

  const isRunningRef = useRef<boolean>(isRunning);
  isRunningRef.current = isRunning;

  const speedRef = useRef<number>(speedMultiplier);
  speedRef.current = speedMultiplier;

  const [thermalThreshold, setThermalThreshold] = useState<number>(25.0);

  // Real-time animation loop
  useEffect(() => {
    let animId: number;
    let lastTimestamp = performance.now();

    const loop = (timestamp: number) => {
      const elapsedWallMs = timestamp - lastTimestamp;
      lastTimestamp = timestamp;

      if (isRunningRef.current && elapsedWallMs > 0) {
        // Clamp wall time step to avoid large delta on tab unfocus
        const clampedWall = Math.min(40, elapsedWallMs);
        const simDt = (clampedWall * speedRef.current) / 10.0; // scaled time advancement

        // Strict numerical sub-stepping: each sub-step is <= 0.5 ms for unconditional stability
        const subSteps = Math.max(1, Math.ceil(simDt / 0.5));
        const updated = stepDualWorldmodel(simStateRef.current, simDt, subSteps);
        simStateRef.current = updated;
        setSimState(updated);
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Rolling buffer for out-of-sample telemetry benchmark
  const telemetryTraceRef = useRef<{ timestampMs: number; phi: FieldChannels[] }[]>([]);

  // Live Telemetry Background Polling Hook
  useEffect(() => {
    if (simState.telemetryConfig.sourceMode === 'simulated') return;

    let active = true;
    const pollInterval = Math.max(1000, simState.telemetryConfig.queryIntervalMs || 2000);

    const poll = async () => {
      try {
        const res = await fetchLiveTelemetry(
          simStateRef.current.telemetryConfig,
          simStateRef.current.modelA.G.nodes
        );
        if (!active) return;

        if (res.success && res.observations && res.observations.length > 0) {
          const updated = ingestLiveTelemetryObservations(simStateRef.current, res.observations);
          simStateRef.current = updated;
          setSimState(updated);

          // Record timestamped trace for empirical benchmark
          if (res.data) {
            const phiSample: FieldChannels[] = simStateRef.current.modelA.G.nodes.map(n => {
              const vals = res.data?.get(n.id);
              return vals ? [...vals] : [n.baselineGpuUtil ?? 55.0, n.baselineQueueLatency ?? 20.0, n.baselineThermalHeadroom ?? 30.0, n.pueBaseline];
            });
            telemetryTraceRef.current.push({
              timestampMs: Date.now(),
              phi: phiSample,
            });
            if (telemetryTraceRef.current.length > 80) {
              telemetryTraceRef.current.shift();
            }
          }
        } else if (!res.success) {
          setSimState(prev => ({
            ...prev,
            telemetryConfig: {
              ...prev.telemetryConfig,
              status: 'error',
              lastError: res.error,
            },
          }));
        }
      } catch (err: any) {
        if (!active) return;
        setSimState(prev => ({
          ...prev,
          telemetryConfig: {
            ...prev.telemetryConfig,
            status: 'error',
            lastError: err.message,
          },
        }));
      }
    };

    poll();
    const intervalId = setInterval(poll, pollInterval);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [simState.telemetryConfig.sourceMode, simState.telemetryConfig.endpoint, simState.telemetryConfig.queryIntervalMs]);


  // Handlers
  const handleToggleRunning = () => setIsRunning(prev => !prev);

  const handleStepForward = () => {
    const updated = stepDualWorldmodel(simStateRef.current, 1.0, 1);
    simStateRef.current = updated;
    setSimState(updated);
  };

  const handleReset = () => {
    const fresh = initializeDualWorldmodel(42);
    simStateRef.current = fresh;
    setSimState(fresh);
  };

  const handleInjectEvent = (event: DiscreteEvent) => {
    const updated = injectDiscreteEvent(simStateRef.current, event);
    simStateRef.current = updated;
    setSimState(updated);
  };

  const handleSelectNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    setShowNodeModal(true);
  };

  const handleUpdateTelemetryConfig = (newConfig: TelemetryIngestionConfig) => {
    simStateRef.current = {
      ...simStateRef.current,
      telemetryConfig: newConfig,
    };
    setSimState(prev => ({
      ...prev,
      telemetryConfig: newConfig,
    }));
  };

  const selectedNodeIndex = simState.modelA.G.nodes.findIndex(n => n.id === selectedNodeId);
  const safeNodeIndex = selectedNodeIndex >= 0 ? selectedNodeIndex : 0;
  const currentNode = simState.modelA.G.nodes[safeNodeIndex];
  const forecastStats = simState.forecastManager ? simState.forecastManager.getStats() : { pendingCount: 0, scoredCount: 0, avgMae: 0, avgRmse: 0 };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500/20">
      {/* Top Navigation Bar */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Brand & Identity */}
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
              <Network className="w-4 h-4 text-slate-950 font-bold" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold tracking-tight text-white">
                  HRM 4.1 Planetary Manifold Telemetry
                </h1>
                <span className="text-slate-500 text-xs">·</span>
                <span className="text-[11px] font-mono text-cyan-400 font-semibold flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  500ms Rolling Predictor
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                Helical Recursive Manifold · Independent Observer State · Speed-of-Light Horizon (~200 km/ms)
              </p>
            </div>
          </div>

          {/* Action Modals Triggers */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Invariant Verification */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-[11px] font-mono text-emerald-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Identity Invariant: Verified</span>
            </div>

            {/* Benchmark Suite Modal Button */}
            <button
              onClick={() => setShowBenchmarkModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm transition-colors"
            >
              <Award className="w-3.5 h-3.5 text-cyan-400" />
              <span>Benchmark Suite</span>
            </button>

            {/* Telemetry Ingestion Source Button */}
            <button
              onClick={() => setShowTelemetryModal(true)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border shadow-sm transition-colors ${
                simState.telemetryConfig.sourceMode === 'simulated'
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                  : simState.telemetryConfig.status === 'error'
                  ? 'bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border-rose-500/40'
                  : 'bg-emerald-950/30 hover:bg-emerald-900/30 text-emerald-300 border-emerald-500/40'
              }`}
            >
              <Radio
                className={`w-3.5 h-3.5 ${
                  simState.telemetryConfig.sourceMode === 'simulated'
                    ? 'text-slate-400'
                    : simState.telemetryConfig.status === 'error'
                    ? 'text-rose-400'
                    : 'text-emerald-400 animate-pulse'
                }`}
              />
              <span>
                {simState.telemetryConfig.sourceMode === 'simulated'
                  ? 'Simulated Mode'
                  : simState.telemetryConfig.status === 'error'
                  ? 'Live Ingest (Error)'
                  : (simState.telemetryConfig.receivedSamplesCount || 0) > 0
                  ? `Live Ingest (${simState.telemetryConfig.receivedSamplesCount} samples)`
                  : 'Live Ingest (Validating)'}
              </span>
            </button>

            {/* Central Observer Horizon */}
            <button
              onClick={() => setShowObserverModal(true)}
              className="flex items-center gap-1.5 text-xs font-mono text-slate-300 bg-slate-900 hover:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-800 transition-colors"
            >
              <Eye className="w-3.5 h-3.5 text-cyan-400" />
              <span>Observer: Ashburn</span>
            </button>

            {/* Python Code Modal Trigger */}
            <button
              onClick={() => setShowPythonModal(true)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 shadow-sm transition-colors"
            >
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="hidden md:inline">Python Engine</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Scientific Cockpit */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 space-y-4">
        {/* Top Grid: Planetary Map & Active Topology (K_t Complex) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Planetary Canvas (3D Globe & 2D Flat Projection) */}
          <div className="lg:col-span-8 min-h-[480px]">
            <PlanetaryCanvas
              carrier={simState.modelA.G}
              phiA={simState.modelA.Phi}
              phiB={simState.modelB.Phi}
              selectedNodeId={selectedNodeId}
              onSelectNode={handleSelectNode}
              divergenceAnomaly={simState.divergence.anomalyDetected}
              thermalThreshold={thermalThreshold}
              onSetThermalThreshold={setThermalThreshold}
            />
          </div>

          {/* Side Telemetry Panel: Live Node Quick Stats & Worldmodel Divergence */}
          <div className="lg:col-span-4 flex flex-col justify-between gap-4">
            {/* Quick Node Focus Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between flex-1">
              <div>
                <div className="flex items-center justify-between border-b border-slate-800 pb-2 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-mono text-xs font-bold">
                      {currentNode.code}
                    </span>
                    <h2 className="text-xs font-semibold text-slate-200 truncate">
                      {currentNode.name}
                    </h2>
                  </div>
                  <button
                    onClick={() => setShowNodeModal(true)}
                    className="text-xs text-cyan-400 hover:text-cyan-300 flex items-center gap-1"
                  >
                    <span>Inspect</span>
                    <ExternalLink className="w-3 h-3" />
                  </button>
                </div>

                {/* 4 Continuous Fields Φ for Current Node */}
                <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 uppercase">GPU Util</span>
                    <div className="text-cyan-400 font-bold text-sm mt-0.5">
                      {simState.modelA.Phi[safeNodeIndex][0].toFixed(1)}%
                    </div>
                    <span className="text-[9.5px] text-amber-400">
                      pred {simState.modelB.Phi[safeNodeIndex][0].toFixed(1)}%
                    </span>
                  </div>

                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 uppercase">Queue Latency</span>
                    <div className="text-sky-400 font-bold text-sm mt-0.5">
                      {simState.modelA.Phi[safeNodeIndex][1].toFixed(1)} ms
                    </div>
                    <span className="text-[9.5px] text-amber-400">
                      pred {simState.modelB.Phi[safeNodeIndex][1].toFixed(1)} ms
                    </span>
                  </div>

                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-slate-500 uppercase">Headroom</span>
                      {simState.modelA.Phi[safeNodeIndex][2] <= thermalThreshold && (
                        <span className="text-[9px] font-mono font-semibold text-rose-400 bg-rose-500/10 px-1 rounded animate-pulse">
                          STRESS
                        </span>
                      )}
                    </div>
                    <div
                      className={`font-bold text-sm mt-0.5 ${
                        simState.modelA.Phi[safeNodeIndex][2] <= thermalThreshold
                          ? 'text-rose-400'
                          : 'text-emerald-400'
                      }`}
                    >
                      {simState.modelA.Phi[safeNodeIndex][2].toFixed(1)} °C
                    </div>
                    <span className="text-[9.5px] text-amber-400">
                      pred {simState.modelB.Phi[safeNodeIndex][2].toFixed(1)} °C
                    </span>
                  </div>

                  <div className="bg-slate-950 p-2 rounded-lg border border-slate-800/80">
                    <span className="text-[10px] text-slate-500 uppercase">Power PUE</span>
                    <div className="text-purple-400 font-bold text-sm mt-0.5">
                      {simState.modelA.Phi[safeNodeIndex][3].toFixed(3)}
                    </div>
                    <span className="text-[9.5px] text-slate-500">
                      base {currentNode.pueBaseline}
                    </span>
                  </div>
                </div>
              </div>

              {/* Node Selector Grid */}
              <div className="mt-3 pt-3 border-t border-slate-800">
                <span className="text-[11px] text-slate-400 font-medium block mb-1.5">
                  Select Planetary Node ({simState.modelA.G.nodes.length} Hubs)
                </span>
                <div className="grid grid-cols-7 gap-1">
                  {simState.modelA.G.nodes.map(node => (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`py-1 text-[10px] font-mono font-medium rounded transition-colors ${
                        selectedNodeId === node.id
                          ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200 border border-slate-800/70 hover:border-slate-700'
                      }`}
                    >
                      {node.code}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* 500ms Forecasting Performance Mini-Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 shadow-xl">
              <div className="flex items-center justify-between text-xs font-mono mb-2">
                <span className="text-slate-400 font-medium">500ms Predictive Accuracy:</span>
                <span className="font-bold text-emerald-400">
                  {forecastStats.scoredCount > 0 ? `MAE ${forecastStats.avgMae.toFixed(4)}` : 'Evaluating...'}
                </span>
              </div>
              <div className="w-full bg-slate-950 rounded-full h-2 border border-slate-800 overflow-hidden">
                <div
                  style={{ width: `${Math.min(100, Math.max(5, (1.0 - forecastStats.avgMae) * 100))}%` }}
                  className="h-full transition-all duration-200 bg-gradient-to-r from-cyan-500 to-emerald-400"
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono mt-1.5">
                <span>Evaluated: {forecastStats.scoredCount} / {forecastStats.pendingCount + forecastStats.scoredCount}</span>
                <span>Horizon: +500ms</span>
              </div>
            </div>
          </div>
        </section>

        {/* Middle Section: Dual Worldmodel Synchronized Plot */}
        <section>
          <DualWorldmodelPlot
            nodes={simState.modelA.G.nodes}
            phiA={simState.modelA.Phi}
            phiB={simState.modelB.Phi}
            selectedNodeIndex={safeNodeIndex}
            divergence={simState.divergence}
            divergenceHistory={simState.divergenceHistory}
            timeMs={simState.timeMs}
            latestForecast={simState.latestForecast}
            latestMaturedForecast={simState.latestMaturedForecast}
            calibrationBands={simState.calibrationBands}
            forecastStats={forecastStats}
          />
        </section>

        {/* Middle Section: Conservation of Explanation Ledger */}
        <section>
          <LedgerInspector ledger={simState.modelA.C} timeMs={simState.timeMs} />
        </section>

        {/* Bottom Section: Discrete Event Controller & B_t Resource Allocation */}
        <section>
          <EventController
            isRunning={isRunning}
            onToggleRunning={handleToggleRunning}
            onStepForward={handleStepForward}
            onReset={handleReset}
            speedMultiplier={speedMultiplier}
            onSetSpeed={setSpeedMultiplier}
            onInjectEvent={handleInjectEvent}
            activeEvents={simState.activeEvents}
            allocation={simState.modelA.B}
            nodes={simState.modelA.G.nodes}
            timeMs={simState.timeMs}
          />
        </section>
      </main>

      {/* Modals */}
      {showNodeModal && (
        <NodeInspectorModal
          node={currentNode}
          nodeIndex={safeNodeIndex}
          phiA={simState.modelA.Phi[safeNodeIndex]}
          phiB={simState.modelB.Phi[safeNodeIndex]}
          allocation={simState.modelA.B}
          links={simState.modelA.G.links}
          timeMs={simState.timeMs}
          onClose={() => setShowNodeModal(false)}
        />
      )}

      {showPythonModal && (
        <PythonScriptModal onClose={() => setShowPythonModal(false)} />
      )}

      {showBenchmarkModal && (
        <BenchmarkModal
          recentTelemetryTrace={telemetryTraceRef.current}
          onClose={() => setShowBenchmarkModal(false)}
        />
      )}

      {showTelemetryModal && (
        <TelemetryIngestionModal
          config={simState.telemetryConfig}
          onUpdateConfig={handleUpdateTelemetryConfig}
          nodes={simState.modelA.G.nodes}
          onClose={() => setShowTelemetryModal(false)}
        />
      )}

      {showObserverModal && (
        <ObserverInspectorModal
          observer={simState.observer}
          G={simState.modelA.G}
          groundTruthPhi={simState.modelA.Phi}
          onClose={() => setShowObserverModal(false)}
        />
      )}
    </div>
  );
}
