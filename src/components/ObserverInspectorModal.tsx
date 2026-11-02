import React from 'react';
import { X, Eye, ShieldCheck, Clock, Radio, Activity, CheckCircle2, AlertTriangle, Layers } from 'lucide-react';
import { ObserverState, CarrierComplexG, FieldChannels } from '../types/hrm';

interface ObserverInspectorModalProps {
  observer: ObserverState;
  G: CarrierComplexG;
  groundTruthPhi: FieldChannels[];
  onClose: () => void;
}

export const ObserverInspectorModal: React.FC<ObserverInspectorModalProps> = ({
  observer,
  G,
  groundTruthPhi,
  onClose,
}) => {
  const observerNode = G.nodes.find(n => n.id === observer.observerHubId) || G.nodes[0];
  const observerIdx = G.nodes.findIndex(n => n.id === observer.observerHubId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Independent Observer-State Reconstructor
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                Aggregation Hub: <span className="text-cyan-300 font-semibold">{observerNode.name}</span> ({observerNode.code}) · Speed-of-Light Horizon: 200 km/ms
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Metrics Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 bg-slate-950/60 border-b border-slate-800 text-xs font-mono">
          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase">Watermark Timestamp</span>
            <div className="text-cyan-400 font-bold text-sm mt-0.5">
              {Math.round(observer.watermarkMs)} ms
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase">Total Packets Ingested</span>
            <div className="text-emerald-400 font-bold text-sm mt-0.5">
              {observer.receivedCount} pkts
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase">Coverage Rate</span>
            <div className="text-emerald-400 font-bold text-sm mt-0.5">
              {observer.coverageRate !== undefined ? `${observer.coverageRate}%` : '100%'}
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase">Telemetry Horizon Lag</span>
            <div className="text-amber-400 font-bold text-sm mt-0.5">
              {Math.max(...observer.stalenessMs)} ms max
            </div>
          </div>

          <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800">
            <span className="text-slate-500 block text-[10px] uppercase">Estimated Priors</span>
            <div className="text-slate-300 font-bold text-sm mt-0.5">
              {observer.packetLossCount} nodes
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Architecture Explainer */}
          <div className="p-3 bg-cyan-950/20 border border-cyan-500/30 rounded-xl text-slate-300 leading-relaxed">
            <div className="flex items-center gap-2 font-semibold text-cyan-300 mb-1">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>Observational Twin Separation Principle</span>
            </div>
            In HRM 4.1, the central observer does <b>not</b> possess instantaneous global knowledge. Instead, telemetry packets emitted by remote hubs travel across physical fiber routes at ~200 km/ms. The observer reconstructs network state solely from arrived packets (<code className="text-cyan-300 font-mono">deliverAt ≤ currentSimTime</code>). The predictive forecaster takes this reconstructed state as input—preventing future physical plant state leakage.
          </div>

          {/* Node Packet Lag Waterfall Table */}
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2 font-mono">
              Planetary Node Telemetry Reception & Staleness Matrix
            </h3>
            <div className="border border-slate-800 rounded-xl overflow-hidden">
              <table className="w-full text-xs font-mono">
                <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 text-left">Datacenter Hub</th>
                    <th className="py-2.5 px-3 text-right">Geodesic to Hub</th>
                    <th className="py-2.5 px-3 text-right">Fiber Latency</th>
                    <th className="py-2.5 px-3 text-right">Telemetry Staleness</th>
                    <th className="py-2.5 px-3 text-right">Observed GPU</th>
                    <th className="py-2.5 px-3 text-right">Plant Truth GPU</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80 bg-slate-900/60">
                  {G.nodes.map((node, i) => {
                    const distKm = G.distanceMatrix[i][observerIdx >= 0 ? observerIdx : 0];
                    const fiberMs = G.propagationLatency[i][observerIdx >= 0 ? observerIdx : 0];
                    const staleness = observer.stalenessMs[i] || 0;
                    const obsGpu = observer.reconstructedPhi[i][0];
                    const truthGpu = groundTruthPhi[i] ? groundTruthPhi[i][0] : obsGpu;
                    const isObserverNode = node.id === observer.observerHubId;

                    return (
                      <tr key={node.id} className={isObserverNode ? 'bg-cyan-950/30' : 'hover:bg-slate-800/40'}>
                        <td className="py-2 px-3 flex items-center gap-2">
                          <span className={`w-1.5 h-1.5 rounded-full ${isObserverNode ? 'bg-cyan-400' : 'bg-slate-400'}`} />
                          <span className="font-semibold text-slate-200">{node.name}</span>
                          <span className="text-slate-500">({node.code})</span>
                          {isObserverNode && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] bg-cyan-500/20 text-cyan-300 font-bold">
                              COLLECTOR
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-400">{Math.round(distKm)} km</td>
                        <td className="py-2 px-3 text-right text-amber-300">{fiberMs.toFixed(1)} ms</td>
                        <td className="py-2 px-3 text-right font-semibold text-slate-300">
                          {staleness > 900 ? (
                            <span className="text-rose-400">UNREACHABLE</span>
                          ) : (
                            `${Math.round(staleness)} ms`
                          )}
                        </td>
                        <td className="py-2 px-3 text-right text-cyan-300">{obsGpu.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right text-slate-300">{truthGpu.toFixed(1)}%</td>
                        <td className="py-2 px-3 text-right">
                          {staleness <= fiberMs + 30 ? (
                            <span className="text-emerald-400 font-medium">FRESH</span>
                          ) : (
                            <span className="text-amber-400 font-medium">DELAYED</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
