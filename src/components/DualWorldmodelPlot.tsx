import React, { useRef, useEffect, useState } from 'react';
import { FieldChannels, DivergenceMetrics, HubNode, ForecastRecord } from '../types/hrm';
import { Activity, AlertTriangle, Sparkles, CheckCircle2, Clock, ShieldCheck, HelpCircle } from 'lucide-react';

interface DualWorldmodelPlotProps {
  nodes: HubNode[];
  phiA: FieldChannels[];
  phiB: FieldChannels[];
  selectedNodeIndex: number;
  divergence: DivergenceMetrics;
  divergenceHistory: { timeMs: number; div: number }[];
  timeMs: number;
  latestForecast?: ForecastRecord | null;
  latestMaturedForecast?: ForecastRecord | null;
  calibrationBands?: [number, number, number, number];
  forecastStats?: { pendingCount: number; scoredCount: number; avgMae: number; avgRmse: number };
}

const CHANNEL_CONFIG = [
  { name: 'GPU Compute Util', unit: '%', min: 0, max: 100, colorA: '#22d3ee', colorB: '#f59e0b', precision: 1 },
  { name: 'Egress Queue Latency', unit: 'ms', min: 0, max: 120, colorA: '#38bdf8', colorB: '#fb923c', precision: 1 },
  { name: 'Thermal Headroom', unit: '°C', min: 0, max: 45, colorA: '#34d399', colorB: '#f43f5e', precision: 1 },
  { name: 'Power Usage Eff. (PUE)', unit: '', min: 1.0, max: 1.8, colorA: '#a78bfa', colorB: '#ec4899', precision: 3 },
];

export const DualWorldmodelPlot: React.FC<DualWorldmodelPlotProps> = ({
  nodes,
  phiA,
  phiB,
  selectedNodeIndex,
  divergence,
  divergenceHistory,
  timeMs,
  latestForecast,
  latestMaturedForecast,
  calibrationBands = [3.5, 4.0, 1.8, 0.025],
  forecastStats = { pendingCount: 0, scoredCount: 0, avgMae: 0, avgRmse: 0 },
}) => {
  const [selectedChannel, setSelectedChannel] = useState<number>(0);
  const [plotMode, setPlotMode] = useState<'channel' | 'forecast' | 'divergence'>('channel');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Rolling history buffer for node channels (last 90 samples)
  const historyRef = useRef<{
    timeMs: number;
    valA: number;
    valB: number;
  }[]>([]);

  const currentNode = nodes[selectedNodeIndex] || nodes[0];
  const nodeIndex = selectedNodeIndex >= 0 && selectedNodeIndex < nodes.length ? selectedNodeIndex : 0;

  const currentValA = phiA[nodeIndex] ? phiA[nodeIndex][selectedChannel] : 0;
  const currentValB = phiB[nodeIndex] ? phiB[nodeIndex][selectedChannel] : 0;

  // Setup resize handling
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Update history buffer
  useEffect(() => {
    historyRef.current.push({
      timeMs,
      valA: currentValA,
      valB: currentValB,
    });
    if (historyRef.current.length > 90) {
      historyRef.current.shift();
    }
  }, [timeMs, currentValA, currentValB]);

  // Keep refs for smooth 60fps render loop
  const plotModeRef = useRef(plotMode);
  plotModeRef.current = plotMode;
  const selectedChannelRef = useRef(selectedChannel);
  selectedChannelRef.current = selectedChannel;
  const divergenceRef = useRef(divergence);
  divergenceRef.current = divergence;
  const divergenceHistoryRef = useRef(divergenceHistory);
  divergenceHistoryRef.current = divergenceHistory;
  const latestForecastRef = useRef(latestForecast);
  latestForecastRef.current = latestForecast;
  const latestMaturedRef = useRef(latestMaturedForecast);
  latestMaturedRef.current = latestMaturedForecast;
  const calibrationBandsRef = useRef(calibrationBands);
  calibrationBandsRef.current = calibrationBands;

  // Persistent Render loop
  useEffect(() => {
    let animId: number;

    const render = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      // Padding
      const padTop = 18;
      const padBottom = 26;
      const padLeft = 45;
      const padRight = 20;

      const plotW = width - padLeft - padRight;
      const plotH = height - padTop - padBottom;

      const currentPlotMode = plotModeRef.current;
      const currentChan = selectedChannelRef.current;

      if (currentPlotMode === 'channel' || currentPlotMode === 'forecast') {
        const cfg = CHANNEL_CONFIG[currentChan];
        const minVal = cfg.min;
        const maxVal = cfg.max;
        const range = maxVal - minVal;

        // Draw grid lines
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.font = '10px "Fira Code", monospace';
        ctx.fillStyle = '#64748b';

        for (let i = 0; i <= 4; i++) {
          const y = padTop + (plotH * (4 - i)) / 4;
          const val = minVal + (range * i) / 4;

          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(width - padRight, y);
          ctx.stroke();

          ctx.textAlign = 'right';
          ctx.fillText(val.toFixed(cfg.precision), padLeft - 6, y + 3);
        }

        const history = historyRef.current;

        // Draw 95% Confidence Calibration Band if in forecast mode
        if (currentPlotMode === 'forecast' && history.length > 2) {
          const halfBand = calibrationBandsRef.current[currentChan];
          ctx.fillStyle = 'rgba(245, 158, 11, 0.09)';
          ctx.beginPath();

          // Upper band
          for (let i = 0; i < history.length; i++) {
            const x = padLeft + (plotW * i) / Math.max(1, history.length - 1);
            const clampedUpper = Math.min(maxVal, history[i].valB + halfBand);
            const y = padTop + plotH - ((clampedUpper - minVal) / range) * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }

          // Lower band (reverse)
          for (let i = history.length - 1; i >= 0; i--) {
            const x = padLeft + (plotW * i) / Math.max(1, history.length - 1);
            const clampedLower = Math.max(minVal, history[i].valB - halfBand);
            const y = padTop + plotH - ((clampedLower - minVal) / range) * plotH;
            ctx.lineTo(x, y);
          }
          ctx.closePath();
          ctx.fill();
        }

        if (history.length > 1) {
          // Model A Line (Observational Plant)
          ctx.beginPath();
          ctx.strokeStyle = cfg.colorA;
          ctx.lineWidth = 2.0;

          history.forEach((pt, i) => {
            const x = padLeft + (plotW * i) / Math.max(1, history.length - 1);
            const normY = (pt.valA - minVal) / range;
            const y = padTop + plotH - Math.max(0, Math.min(1, normY)) * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();

          // Model B Line (Predictive 500ms forward trajectory)
          ctx.beginPath();
          ctx.strokeStyle = cfg.colorB;
          ctx.lineWidth = 1.8;
          ctx.setLineDash([4, 3]);

          history.forEach((pt, i) => {
            const x = padLeft + (plotW * i) / Math.max(1, history.length - 1);
            const normY = (pt.valB - minVal) / range;
            const y = padTop + plotH - Math.max(0, Math.min(1, normY)) * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
          ctx.setLineDash([]);

          // Latest dot for A
          const lastPt = history[history.length - 1];
          const lastX = width - padRight;
          const lastYA = padTop + plotH - Math.max(0, Math.min(1, (lastPt.valA - minVal) / range)) * plotH;
          ctx.fillStyle = cfg.colorA;
          ctx.beginPath();
          ctx.arc(lastX, lastYA, 3.5, 0, Math.PI * 2);
          ctx.fill();

          // Latest dot for B
          const lastYB = padTop + plotH - Math.max(0, Math.min(1, (lastPt.valB - minVal) / range)) * plotH;
          ctx.fillStyle = cfg.colorB;
          ctx.beginPath();
          ctx.arc(lastX, lastYB, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Divergence Plot D(A, B)
        const divHist = divergenceHistoryRef.current;
        const maxDiv = 15.0;

        // Grid lines
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 1;
        ctx.font = '10px "Fira Code", monospace';
        ctx.fillStyle = '#64748b';

        for (let i = 0; i <= 3; i++) {
          const y = padTop + (plotH * (3 - i)) / 3;
          const val = (maxDiv * i) / 3;
          ctx.beginPath();
          ctx.moveTo(padLeft, y);
          ctx.lineTo(width - padRight, y);
          ctx.stroke();

          ctx.textAlign = 'right';
          ctx.fillText(val.toFixed(1), padLeft - 6, y + 3);
        }

        // Anomaly threshold line at 8.5
        const threshY = padTop + plotH - (8.5 / maxDiv) * plotH;
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.45)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, threshY);
        ctx.lineTo(width - padRight, threshY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#f43f5e';
        ctx.fillText('ANOMALY (8.5)', width - padRight - 4, threshY - 4);

        if (divHist.length > 1) {
          ctx.beginPath();
          ctx.strokeStyle = divergenceRef.current.anomalyDetected ? '#f43f5e' : '#38bdf8';
          ctx.lineWidth = 2.0;

          divHist.forEach((pt, i) => {
            const x = padLeft + (plotW * i) / Math.max(1, divHist.length - 1);
            const normY = Math.min(1, pt.div / maxDiv);
            const y = padTop + plotH - normY * plotH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 backdrop-blur-md shadow-xl">
      {/* Header & Mode Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-cyan-400" />
          <h3 className="text-sm font-semibold text-slate-100">
            Dual-Worldmodel Predictive Telemetry
          </h3>
          <span className="text-slate-500 text-xs">·</span>
          <span className="text-xs text-slate-400 font-mono">
            Node: <span className="text-cyan-300 font-semibold">{currentNode.name}</span> ({currentNode.code})
          </span>
        </div>

        <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => setPlotMode('channel')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              plotMode === 'channel'
                ? 'bg-slate-800 text-cyan-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Field Channels
          </button>
          <button
            onClick={() => setPlotMode('forecast')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              plotMode === 'forecast'
                ? 'bg-slate-800 text-amber-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Rolling 500ms Predictor
          </button>
          <button
            onClick={() => setPlotMode('divergence')}
            className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              plotMode === 'divergence'
                ? 'bg-slate-800 text-rose-300 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Scenario Gap
          </button>
        </div>
      </div>

      {/* HRM 4.1 Rolling Predictor Status Banner */}
      {plotMode === 'forecast' && (
        <div className="mb-3 p-2.5 bg-amber-950/20 border border-amber-500/30 rounded-lg text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="flex items-center gap-2 font-mono">
                  <span className="font-semibold text-amber-300">
                    {latestForecast?.status === 'pending' ? 'PROVISIONAL 500ms FORWARD PROJECTION' : 'MATURED PREDICTOR'}
                  </span>
                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-200">
                    Seed: {latestForecast ? `0x${latestForecast.seed.toString(16)}` : 'N/A'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  Origin: <span className="font-mono text-slate-200">{latestForecast ? `${Math.round(latestForecast.issuedAtMs)}ms` : '0ms'}</span> → Target: <span className="font-mono text-amber-300">{latestForecast ? `${Math.round(latestForecast.targetAtMs)}ms` : '500ms'}</span> (+500ms numerical integration)
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 font-mono text-[11px]">
              <div className="flex items-center gap-1 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>Pending: <b className="text-amber-300">{forecastStats.pendingCount}</b></span>
              </div>
              <div className="flex items-center gap-1 text-slate-300">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Matured: <b className="text-emerald-300">{forecastStats.scoredCount}</b></span>
              </div>
              {latestMaturedForecast?.metrics && (
                <div className="px-2 py-0.5 rounded bg-emerald-950/40 border border-emerald-500/30 text-emerald-300">
                  Holdout MAE: <b>{latestMaturedForecast.metrics.avgMae.toFixed(4)}</b>
                </div>
              )}
            </div>
          </div>

          <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-center justify-between text-[11px] text-slate-400">
            <div className="flex items-center gap-1.5 text-amber-200/80">
              <HelpCircle className="w-3.5 h-3.5" />
              <span>
                Shaded band denotes 95% holdout calibration interval (±1.96σ): <b className="font-mono text-amber-300">±{calibrationBands[selectedChannel]}</b> {CHANNEL_CONFIG[selectedChannel].unit}
              </span>
            </div>
            <span className="text-slate-500 text-[10px]">
              Accuracy scored solely when target timestamps mature against physical ground truth.
            </span>
          </div>
        </div>
      )}

      {/* Channel Selector Buttons */}
      {(plotMode === 'channel' || plotMode === 'forecast') && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {CHANNEL_CONFIG.map((cfg, idx) => {
            const valA = phiA[nodeIndex] ? phiA[nodeIndex][idx] : 0;
            const valB = phiB[nodeIndex] ? phiB[nodeIndex][idx] : 0;
            const isSelected = selectedChannel === idx;

            return (
              <button
                key={cfg.name}
                onClick={() => setSelectedChannel(idx)}
                className={`flex flex-col p-2 text-left rounded-lg border transition-all ${
                  isSelected
                    ? 'bg-slate-800/90 border-cyan-500/50 shadow-md ring-1 ring-cyan-500/20'
                    : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-850 hover:border-slate-700'
                }`}
              >
                <span className="text-[11px] text-slate-400 font-medium truncate">{cfg.name}</span>
                <div className="flex items-baseline justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-mono font-semibold text-cyan-400">
                      {valA.toFixed(cfg.precision)}
                    </span>
                    <span className="text-[10px] text-slate-500">{cfg.unit}</span>
                  </div>
                  <div className="flex items-center gap-1 font-mono text-[10px] text-amber-400">
                    <span className="text-slate-500">+500ms:</span>
                    <span>{valB.toFixed(cfg.precision)}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Scenario Gap Summary */}
      {plotMode === 'divergence' && (
        <div className="flex items-center justify-between p-2.5 mb-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Scenario Gap D(A, B):</span>
            <span className={`font-semibold text-sm ${divergence.anomalyDetected ? 'text-rose-400' : 'text-cyan-400'}`}>
              {divergence.euclideanDivergence}
            </span>
            <span className="text-[10px] text-slate-500 font-sans">
              (Lookahead drift between Plant A and Speculative Twin B)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-400">Peak Node:</span>
            <span className="text-amber-300 uppercase">{divergence.maxNodeDivergence.nodeId}</span>
            <span className="text-slate-500">({divergence.maxNodeDivergence.divergence})</span>
          </div>
          {divergence.anomalyDetected && (
            <div className="flex items-center gap-1 text-rose-400">
              <AlertTriangle className="w-3.5 h-3.5 animate-bounce" />
              <span>BREACH &gt; 8.5</span>
            </div>
          )}
        </div>
      )}

      {/* Canvas Time Series Plot */}
      <div className="relative w-full h-48 bg-slate-950 rounded-lg border border-slate-800/90 overflow-hidden">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      {/* Legend Footer */}
      <div className="flex items-center justify-between text-xs text-slate-400 mt-3 pt-2 border-t border-slate-800/80">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-cyan-400 shadow-[0_0_6px_#22d3ee]" />
            <span className="text-slate-300">Model A: Observational Ground Truth</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-amber-400 border-b border-dashed border-amber-300" />
            <span className="text-slate-300">Model B: HRM 4.1 Forward Predictor (+500ms)</span>
          </div>
        </div>

        <div className="font-mono text-[11px] text-slate-500">
          Propagation Horizon: ~200 km/ms
        </div>
      </div>
    </div>
  );
};
