import React from 'react';
import { HubNode, FiberLink, FieldChannels, ResourceAllocationB } from '../types/hrm';
import { X, Server, Zap, Thermometer, Clock, ShieldCheck, Activity, Globe } from 'lucide-react';
import { computeLocalSolarIntensity } from '../engine/planetaryCarrier';

interface NodeInspectorModalProps {
  node: HubNode;
  nodeIndex: number;
  phiA: FieldChannels;
  phiB: FieldChannels;
  allocation: ResourceAllocationB;
  links: FiberLink[];
  timeMs: number;
  onClose: () => void;
}

export const NodeInspectorModal: React.FC<NodeInspectorModalProps> = ({
  node,
  nodeIndex,
  phiA,
  phiB,
  allocation,
  links,
  timeMs,
  onClose,
}) => {
  const utcHours = ((timeMs / 3600000) % 24 + 24) % 24;
  const solarIntensity = computeLocalSolarIntensity(utcHours, node.lng);
  const localSolarTime = (utcHours + node.lng / 15.0 + 24.0) % 24.0;

  const connectedLinks = links.filter(
    l => l.sourceId === node.id || l.targetId === node.id
  );

  const dispatchPct = (allocation.dispatchVector[nodeIndex] || 0) * 100;
  const utility = allocation.utilityScores[nodeIndex] || 0;
  const carbon = allocation.carbonIntensity[nodeIndex] || 0;

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 font-bold font-mono text-sm">
              {node.code}
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
                <span>{node.name}</span>
                <span className="text-xs text-slate-400 font-normal font-mono">({node.country})</span>
              </h2>
              <div className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
                <span>{node.region} Region</span>
                <span>·</span>
                <span className="font-mono">{node.lat.toFixed(4)}° N, {node.lng.toFixed(4)}° E</span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto">
          {/* Continuous Field Channels Φ_t */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Continuous Field Channels (Φ_t)
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">GPU Compute Util</span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-base font-mono font-bold text-cyan-400">
                    {phiA[0].toFixed(1)}%
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono">
                    fwd {phiB[0].toFixed(1)}%
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">Egress Queue</span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-base font-mono font-bold text-sky-400">
                    {phiA[1].toFixed(1)} ms
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono">
                    fwd {phiB[1].toFixed(1)} ms
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">Thermal Headroom</span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-base font-mono font-bold text-emerald-400">
                    {phiA[2].toFixed(1)} °C
                  </span>
                  <span className="text-[10px] text-amber-400 font-mono">
                    fwd {phiB[2].toFixed(1)} °C
                  </span>
                </div>
              </div>

              <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                <span className="text-[11px] text-slate-400">Power Usage Eff.</span>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="text-base font-mono font-bold text-purple-400">
                    {phiA[3].toFixed(3)}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    base {node.pueBaseline}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Diurnal & Environmental telemetry */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Diurnal Cycle &amp; Clean Solar Influx
            </div>
            <div className="grid grid-cols-3 gap-2.5 bg-slate-950 p-3 rounded-lg border border-slate-800 text-xs font-mono">
              <div>
                <span className="text-slate-500 text-[10.5px]">Local Solar Time</span>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {Math.floor(localSolarTime)}:{String(Math.floor((localSolarTime % 1) * 60)).padStart(2, '0')} Local
                </div>
              </div>
              <div>
                <span className="text-slate-500 text-[10.5px]">Solar Radiance Coeff</span>
                <div className="text-amber-400 font-semibold mt-0.5">
                  {(solarIntensity * 100).toFixed(1)}% Daylight
                </div>
              </div>
              <div>
                <span className="text-slate-500 text-[10.5px]">Cooling Capacity</span>
                <div className="text-slate-200 font-semibold mt-0.5">
                  {node.coolingCapacityMw} MW Peak
                </div>
              </div>
            </div>
          </div>

          {/* Workload Allocation */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Workload Dispatch (B_t Optimization)
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 flex items-center justify-between text-xs font-mono">
              <div>
                <span className="text-slate-500">Dispatch Share:</span>
                <span className="ml-1 text-cyan-400 font-bold">{dispatchPct.toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-slate-500">Utility Score u_i:</span>
                <span className="ml-1 text-slate-200 font-semibold">{utility.toFixed(3)}</span>
              </div>
              <div>
                <span className="text-slate-500">Carbon Index:</span>
                <span className="ml-1 text-amber-400">{(carbon * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>

          {/* Connected Fiber Backbone Trunks */}
          <div>
            <div className="text-xs font-semibold text-slate-400 mb-2 uppercase tracking-wider">
              Connected Fiber Trunks ({connectedLinks.length})
            </div>
            <div className="space-y-1.5 max-h-40 overflow-y-auto">
              {connectedLinks.map(link => {
                const isTarget = link.targetId === node.id;
                const peerId = isTarget ? link.sourceId : link.targetId;
                return (
                  <div
                    key={link.id}
                    className={`flex items-center justify-between p-2 rounded-lg border text-xs font-mono ${
                      link.isSevered
                        ? 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                        : 'bg-slate-950 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className={link.isSevered ? 'text-rose-400' : 'text-cyan-400'}>
                        {link.name}
                      </span>
                      <span className="text-slate-500">({link.type})</span>
                    </div>

                    <div className="flex items-center gap-3">
                      <span>{link.lengthKm} km</span>
                      <span className="text-slate-500">·</span>
                      <span>{link.latencyMs.toFixed(1)} ms</span>
                      <span className="text-slate-500">·</span>
                      <span className={link.isSevered ? 'text-rose-400 font-semibold' : 'text-emerald-400'}>
                        {link.isSevered ? 'SEVERED' : `${link.capacityTbps} Tbps`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-3 bg-slate-950/70 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
};
