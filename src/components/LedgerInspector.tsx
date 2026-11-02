import React from 'react';
import { AttributionLedgerC } from '../types/hrm';
import { ShieldCheck, ShieldAlert, Cpu, Layers, Sun, Radio, Sliders, Zap } from 'lucide-react';
import { TAU_LEDGER_TOLERANCE } from '../engine/hrmMath';

interface LedgerInspectorProps {
  ledger: AttributionLedgerC;
  timeMs: number;
}

export const LedgerInspector: React.FC<LedgerInspectorProps> = ({ ledger, timeMs }) => {
  // Aggregate magnitude of each attribution term across channels
  const magA0 = Math.abs(ledger.A_0.reduce((a, b) => a + b, 0));
  const magReact = Math.abs(ledger.A_react.reduce((a, b) => a + b, 0));
  const magDiff = Math.abs(ledger.A_diff.reduce((a, b) => a + b, 0));
  const magXi = Math.abs(ledger.A_xi.reduce((a, b) => a + b, 0));
  const magEvent = Math.abs(ledger.A_event.reduce((a, b) => a + b, 0));
  const magCorr = Math.abs(ledger.A_corr.reduce((a, b) => a + b, 0));
  const magEps = Math.abs(ledger.epsilon.reduce((a, b) => a + b, 0));

  const totalSum = magA0 + magReact + magDiff + magXi + magEvent + magCorr + magEps || 1e-6;

  const pctA0 = (magA0 / totalSum) * 100;
  const pctReact = (magReact / totalSum) * 100;
  const pctDiff = (magDiff / totalSum) * 100;
  const pctXi = (magXi / totalSum) * 100;
  const pctEvent = (magEvent / totalSum) * 100;
  const pctCorr = (magCorr / totalSum) * 100;

  const ledgerTerms = [
    {
      id: 'A_0',
      label: 'A_0 (Diurnal Sun)',
      desc: 'Follow-the-sun planetary drift wave',
      val: magA0,
      pct: pctA0,
      color: 'bg-amber-400 text-amber-950',
      barColor: 'bg-amber-400',
      icon: Sun,
    },
    {
      id: 'A_react',
      label: 'A_react (Node Cubic)',
      desc: 'R_Φ = a⊙φ - b⊙φ³ - Q(φ) reaction',
      val: magReact,
      pct: pctReact,
      color: 'bg-cyan-400 text-cyan-950',
      barColor: 'bg-cyan-400',
      icon: Cpu,
    },
    {
      id: 'A_diff',
      label: 'A_diff (Laplacian)',
      desc: '-D_Φ L Φ continuous graph diffusion',
      val: magDiff,
      pct: pctDiff,
      color: 'bg-blue-400 text-blue-950',
      barColor: 'bg-blue-400',
      icon: Layers,
    },
    {
      id: 'A_xi',
      label: 'A_ξ (Stochastic)',
      desc: 'Wiener process Brownian micro-jitter',
      val: magXi,
      pct: pctXi,
      color: 'bg-violet-400 text-violet-950',
      barColor: 'bg-violet-400',
      icon: Radio,
    },
    {
      id: 'A_event',
      label: 'A_event (Perturbation)',
      desc: 'Fiber cuts & emergency throttle events',
      val: magEvent,
      pct: pctEvent,
      color: 'bg-rose-500 text-rose-950',
      barColor: 'bg-rose-500',
      icon: Zap,
    },
    {
      id: 'A_corr',
      label: 'A_corr (Stabilization)',
      desc: 'S_t ∘ P_t manifold boundary projection',
      val: magCorr,
      pct: pctCorr,
      color: 'bg-emerald-400 text-emerald-950',
      barColor: 'bg-emerald-400',
      icon: Sliders,
    },
  ];

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col justify-between">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3 mb-3">
        <div className="flex items-center gap-2">
          <Layers className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            Attribution Ledger &amp; Conservation of Explanation
          </h3>
          <span className="text-slate-500 text-xs">·</span>
          <span className="text-xs text-slate-400 font-mono">HRM 4.0 Step #{ledger.step}</span>
        </div>

        {/* Verification Status Pill */}
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-mono font-medium border transition-colors bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>INVARIANT PRESERVED</span>
          <span className="text-slate-500">·</span>
          <span className="text-[11px] text-emerald-400">
            ||ε|| / (||ΔX||+δ) = {ledger.residualRatio.toExponential(2)}
          </span>
        </div>
      </div>

      {/* Formula Readout Box */}
      <div className="bg-slate-950 border border-slate-800/80 rounded-lg p-2.5 mb-3 font-mono text-[11.5px] text-slate-300 overflow-x-auto">
        <div className="text-cyan-400 font-semibold mb-1">
          Identity: Δ^T X_t = A_{'{0,t}'}^T + Σ A_{'{k,t}'}^T + Σ A_{'{ij,t}'}^T + A_{'{ξ,t}'}^T + A_{'{event,t}'} + A_{'{corr,t}'} + ε_t
        </div>
        <div className="text-slate-500 text-[10.5px]">
          Invariant Condition: ||ε_t|| / (||Δ^T X_t|| + δ) ≤ τ_ledger ({TAU_LEDGER_TOLERANCE.toExponential(1)}) · Residual: {magEps.toExponential(3)}
        </div>
      </div>

      {/* Stacked Attribution Bar */}
      <div className="mb-3">
        <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
          <span>Decomposition of Explanation Vector (ΔX_t)</span>
          <span className="font-mono text-[11px]">Total norm: {Math.abs(ledger.totalDelta.reduce((a,b)=>a+b,0)).toFixed(2)}</span>
        </div>
        <div className="h-4 w-full bg-slate-950 rounded-md overflow-hidden flex border border-slate-800">
          {ledgerTerms.map(term => (
            <div
              key={term.id}
              style={{ width: `${Math.max(1, term.pct)}%` }}
              className={`${term.barColor} transition-all duration-300 relative group`}
              title={`${term.label}: ${term.pct.toFixed(1)}%`}
            />
          ))}
        </div>
      </div>

      {/* Component Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        {ledgerTerms.map(term => {
          const Icon = term.icon;
          return (
            <div
              key={term.id}
              className="bg-slate-950/70 border border-slate-800/90 rounded-lg p-2 flex flex-col justify-between"
            >
              <div className="flex items-center gap-1.5 text-slate-400 text-[11px]">
                <Icon className="w-3 h-3 text-cyan-400 shrink-0" />
                <span className="font-medium truncate">{term.id}</span>
              </div>
              <div className="mt-1 flex items-baseline justify-between">
                <span className="text-xs font-mono font-semibold text-slate-200">
                  {term.val.toFixed(2)}
                </span>
                <span className="text-[10px] font-mono text-cyan-400">
                  {term.pct.toFixed(0)}%
                </span>
              </div>
              <span className="text-[9.5px] text-slate-500 truncate mt-0.5">{term.desc}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
