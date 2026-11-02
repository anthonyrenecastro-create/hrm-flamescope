import React from 'react';
import { DiscreteEvent, ResourceAllocationB, HubNode } from '../types/hrm';
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  Scissors,
  Flame,
  SunMedium,
  Zap,
  Wrench,
  Gauge,
  TrendingUp,
} from 'lucide-react';

interface EventControllerProps {
  isRunning: boolean;
  onToggleRunning: () => void;
  onStepForward: () => void;
  onReset: () => void;
  speedMultiplier: number;
  onSetSpeed: (speed: number) => void;
  onInjectEvent: (event: DiscreteEvent) => void;
  activeEvents: DiscreteEvent[];
  allocation: ResourceAllocationB;
  nodes: HubNode[];
  timeMs: number;
}

export const EventController: React.FC<EventControllerProps> = ({
  isRunning,
  onToggleRunning,
  onStepForward,
  onReset,
  speedMultiplier,
  onSetSpeed,
  onInjectEvent,
  activeEvents,
  allocation,
  nodes,
  timeMs,
}) => {
  const isDunantSevered = activeEvents.some(
    e => e.type === 'CABLE_SEVER' && (e.targetId === 'tat_ash_dub' || e.targetId === 'tat_ash_lon')
  );
  const isMedSevered = activeEvents.some(
    e => e.type === 'CABLE_SEVER' && e.targetId === 'med_mrs_dxb'
  );
  const isFrankfurtTripped = activeEvents.some(
    e => e.type === 'NODE_THERMAL_TRIP' && e.targetId === 'frankfurt'
  );

  // Top 3 allocation hubs
  const topHubs = nodes
    .map((node, idx) => ({
      name: node.name,
      code: node.code,
      weight: (allocation.dispatchVector[idx] || 0) * 100,
      utility: allocation.utilityScores[idx] || 0,
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3);

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between gap-4">
      {/* Simulation Playback & Speed Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleRunning}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all shadow-md ${
              isRunning
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30'
                : 'bg-cyan-500 text-slate-950 font-semibold hover:bg-cyan-400'
            }`}
          >
            {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{isRunning ? 'Pause Engine' : 'Run HRM 4.0'}</span>
          </button>

          <button
            onClick={onStepForward}
            disabled={isRunning}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-750 disabled:opacity-40 transition-colors"
            title="Step 1 millisecond"
          >
            <StepForward className="w-3.5 h-3.5" />
            <span>+1ms Step</span>
          </button>

          <button
            onClick={onReset}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent hover:border-slate-700 transition-colors"
            title="Reset Simulation Clock"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Speed Segmented Controller */}
        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          {[1, 5, 20].map(multiplier => (
            <button
              key={multiplier}
              onClick={() => onSetSpeed(multiplier)}
              className={`px-2.5 py-1 text-xs font-mono font-medium rounded transition-colors ${
                speedMultiplier === multiplier
                  ? 'bg-slate-800 text-cyan-400 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {multiplier}x
            </button>
          ))}
        </div>

        {/* Simulation Clock Readout */}
        <div className="font-mono text-xs text-slate-400 flex items-center gap-2">
          <span>Clock:</span>
          <span className="text-cyan-400 font-semibold">
            {timeMs.toFixed(0)} ms
          </span>
          <span className="text-slate-600">|</span>
          <span>Diurnal:</span>
          <span className="text-slate-300">
            {(((timeMs / 3600000) % 24 + 24) % 24).toFixed(1)}h UTC
          </span>
        </div>
      </div>

      {/* Discrete Perturbation Buttons */}
      <div>
        <div className="text-xs font-medium text-slate-400 mb-2 flex items-center justify-between">
          <span>Dynamic Discrete Structural Events (O_t)</span>
          <span className="text-[10px] text-slate-500 font-mono">
            {activeEvents.length} Active Perturbations
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {/* Sever Dunant Cable */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `sev_${Date.now()}`,
                timeMs,
                type: 'CABLE_SEVER',
                label: 'Transatlantic Sever',
                description: 'Severed AEC-1 / Dunant subsea cable between Ashburn and Dublin.',
                targetId: 'tat_ash_dub',
                magnitude: 1.0,
              })
            }
            className={`p-2 rounded-lg border text-left text-xs transition-all flex flex-col justify-between ${
              isDunantSevered
                ? 'bg-rose-950/40 border-rose-500/60 text-rose-300 ring-1 ring-rose-500/30'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-1.5 text-rose-400 font-medium">
              <Scissors className="w-3.5 h-3.5" />
              <span>{isDunantSevered ? 'Transatlantic Cut' : 'Transatlantic Cut'}</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1">
              {isDunantSevered ? '🔴 Severed · Click to Heal' : 'AEC-1 / Dunant Trunk'}
            </span>
          </button>

          {/* Sever Med Cable */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `med_${Date.now()}`,
                timeMs,
                type: 'CABLE_SEVER',
                label: 'AAE-1 Med Sever',
                description: 'Subsea cable severing between Marseille and Dubai.',
                targetId: 'med_mrs_dxb',
                magnitude: 1.0,
              })
            }
            className={`p-2 rounded-lg border text-left text-xs transition-all flex flex-col justify-between ${
              isMedSevered
                ? 'bg-rose-950/40 border-rose-500/60 text-rose-300 ring-1 ring-rose-500/30'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-1.5 text-rose-400 font-medium">
              <Scissors className="w-3.5 h-3.5" />
              <span>{isMedSevered ? 'Suez Subsea Cut' : 'Suez Subsea Cut'}</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1">
              {isMedSevered ? '🔴 Severed · Click to Heal' : 'Marseille-Dubai Trunk'}
            </span>
          </button>

          {/* Thermal Node Trip */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `therm_${Date.now()}`,
                timeMs,
                type: 'NODE_THERMAL_TRIP',
                label: 'Frankfurt Thermal Trip',
                description: 'DE-CIX mega node thermal trip clamps cooling capacity.',
                targetId: 'frankfurt',
                magnitude: 1.0,
              })
            }
            className={`p-2 rounded-lg border text-left text-xs transition-all flex flex-col justify-between ${
              isFrankfurtTripped
                ? 'bg-amber-950/40 border-amber-500/60 text-amber-300 ring-1 ring-amber-500/30'
                : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 text-slate-300 hover:bg-slate-850'
            }`}
          >
            <div className="flex items-center gap-1.5 text-amber-400 font-medium">
              <Flame className="w-3.5 h-3.5" />
              <span>{isFrankfurtTripped ? 'Thermal Tripped' : 'Thermal Node Trip'}</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1">
              {isFrankfurtTripped ? '🔥 Tripped · Click to Cool' : 'Frankfurt DE-CIX'}
            </span>
          </button>

          {/* Solar Peak Shift */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `solar_${Date.now()}`,
                timeMs,
                type: 'SOLAR_SHIFT',
                label: 'Solar Peak Shift',
                description: 'Solar surge shifts follow-the-sun generation across APAC/Americas.',
                magnitude: 1.0,
              })
            }
            className="p-2 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950/70 hover:bg-slate-850 text-slate-300 text-left text-xs transition-all flex flex-col justify-between"
          >
            <div className="flex items-center gap-1.5 text-amber-400 font-medium">
              <SunMedium className="w-3.5 h-3.5" />
              <span>Solar Peak Shift</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1">Accelerate Solar Angle</span>
          </button>

          {/* Microburst Surge */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `burst_${Date.now()}`,
                timeMs,
                type: 'MICROBURST_SPIKE',
                label: 'Micro-burst Surge',
                description: 'Global stochastic micro-burst queue influx.',
                magnitude: 1.0,
              })
            }
            className="p-2 rounded-lg border border-slate-800 hover:border-slate-700 bg-slate-950/70 hover:bg-slate-850 text-slate-300 text-left text-xs transition-all flex flex-col justify-between"
          >
            <div className="flex items-center gap-1.5 text-cyan-400 font-medium">
              <Zap className="w-3.5 h-3.5" />
              <span>Micro-burst Surge</span>
            </div>
            <span className="text-[10px] text-slate-400 mt-1">+25ms Queue Spike</span>
          </button>

          {/* Restore / Heal */}
          <button
            onClick={() =>
              onInjectEvent({
                id: `restore_${Date.now()}`,
                timeMs,
                type: 'TOPOLOGY_RESTORE',
                label: 'Heal Topology',
                description: 'Restore all severed subsea cables and clear node thermal trips.',
                magnitude: 1.0,
              })
            }
            className="p-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 text-left text-xs transition-all flex flex-col justify-between"
          >
            <div className="flex items-center gap-1.5 font-medium">
              <Wrench className="w-3.5 h-3.5 text-emerald-400" />
              <span>Heal Topology</span>
            </div>
            <span className="text-[10px] text-emerald-400/80 mt-1">Reconnect All Links</span>
          </button>
        </div>
      </div>

      {/* Multi-Objective Resource Allocation (B_t) Summary */}
      <div className="bg-slate-950 p-3 rounded-lg border border-slate-800/90 flex flex-wrap items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-cyan-400" />
          <span className="font-semibold text-slate-200">
            Multi-Objective Allocation B_t:
          </span>
          <span className="font-mono text-slate-400">
            Switching Penalty λ·||Δa|| = {allocation.switchingPenalty.toFixed(3)}
          </span>
          <span className="text-slate-600">·</span>
          <span className="font-mono text-slate-400">
            Power Cost = {allocation.totalBudgetCost.toFixed(1)} MW-equiv
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-400">Top Workload Hubs:</span>
          {topHubs.map(hub => (
            <div key={hub.code} className="flex items-center gap-1 font-mono">
              <span className="text-slate-300 font-semibold">{hub.code}</span>
              <span className="text-cyan-400">{hub.weight.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
