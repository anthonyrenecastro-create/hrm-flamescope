import React, { useRef, useEffect, useState } from 'react';
import { Globe, Map as MapIcon, RotateCcw } from 'lucide-react';
import { CombustionExperiment } from '../types/combustion';
import { CombustionGraph } from '../engine/combustionModel';
import {
  NodeEncoding, ENCODING_LABELS, legendFor, nodeColor, nodeRadius, nodeOpacity, spherePosition,
} from '../engine/visualEncoding';

/**
 * Combustion Research Manifold — the central visualization of the
 * unified FlameScope application. Rendering architecture mirrors the
 * original PlanetaryCanvas (canvas 2D, 60fps rAF loop, props-in-refs,
 * drag rotation, packet pulses, glow nodes, overlay control bar and
 * legend bar), retargeted from planetary hubs to combustion
 * experiments. Node color/size/opacity encode declared data variables
 * (see engine/visualEncoding.ts); node POSITION is a schematic
 * Fibonacci-sphere layout and carries no physical meaning.
 */
interface Props {
  experiments: CombustionExperiment[];
  graph: CombustionGraph;
  selectedId: string;
  onSelect: (id: string) => void;
  encoding: NodeEncoding;
  onEncodingChange: (e: NodeEncoding) => void;
  residuals: Map<string, number>;
  /** Playback position 0..1 within the selected experiment's derived trajectory. */
  timeNorm: number;
  /** Selected experiment's droplet diameter at the playback time (mm), or null. */
  selectedDiameterMm: number | null;
  isPlaying: boolean;
}

interface Projected { id: string; x: number; y: number; z: number; r: number }

const STARS = Array.from({ length: 140 }, (_, i) => ({
  x: ((i * 2654435761) % 1000) / 1000,
  y: ((i * 40503) % 1000) / 1000,
  r: 0.4 + ((i * 97) % 10) / 12,
  tw: (i % 7) / 7,
}));

export const CombustionCanvas: React.FC<Props> = (props) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'sphere' | 'flat'>('sphere');
  const [hovered, setHovered] = useState<{ exp: CombustionExperiment; x: number; y: number } | null>(null);
  const rotRef = useRef({ yaw: 0.7, pitch: 0.3, isDragging: false, lastX: 0, lastY: 0, zoom: 1 });
  const projectedRef = useRef<Projected[]>([]);
  const phaseRef = useRef(0);

  // Props-in-refs, mirroring the original canvas decoupling pattern.
  const propsRef = useRef(props);
  propsRef.current = props;
  const viewRef = useRef(viewMode);
  viewRef.current = viewMode;

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

  const project = (width: number, height: number): Projected[] => {
    const p = propsRef.current;
    const { yaw, pitch, zoom } = rotRef.current;
    const cx = width / 2;
    const cy = height / 2;
    const R = Math.min(width, height) * 0.40 * zoom;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const cpit = Math.cos(pitch), spit = Math.sin(pitch);
    return p.experiments.map((e, i) => {
      const s = spherePosition(i, p.experiments.length);
      // rotate around Y (yaw) then X (pitch)
      const x1 = s.x * cyaw + s.z * syaw;
      const z1 = -s.x * syaw + s.z * cyaw;
      const y2 = s.y * cpit - z1 * spit;
      const z2 = s.y * spit + z1 * cpit;
      if (viewRef.current === 'flat') {
        return { id: e.id, x: cx + s.x * R * 1.55, y: cy + s.y * R * 1.25, z: 0.5, r: nodeRadius(e) };
      }
      return { id: e.id, x: cx + x1 * R, y: cy + y2 * R, z: z2, r: nodeRadius(e) };
    });
  };

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
      const p = propsRef.current;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      phaseRef.current = (phaseRef.current + 0.006) % 1;
      if (!rotRef.current.isDragging && viewRef.current === 'sphere') rotRef.current.yaw += 0.0007;
      const animTime = performance.now() / 1000;

      // Starfield background (original drew a space backdrop too)
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, width, height);
      for (const s of STARS) {
        ctx.globalAlpha = 0.25 + 0.35 * Math.abs(Math.sin(animTime * 0.7 + s.tw * 6.28));
        ctx.fillStyle = '#cbd5e1';
        ctx.beginPath();
        ctx.arc(s.x * width, s.y * height, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const projected = project(width, height);
      projectedRef.current = projected;
      const byId = new Map(projected.map((q) => [q.id, q]));
      const cx = width / 2;
      const cy = height / 2;
      const R = Math.min(width, height) * 0.40 * rotRef.current.zoom;

      if (viewRef.current === 'sphere') {
        const grad = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.05);
        grad.addColorStop(0, 'rgba(30,58,95,0.55)');
        grad.addColorStop(0.6, 'rgba(12,30,55,0.35)');
        grad.addColorStop(1, 'rgba(2,6,23,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(56,189,248,0.18)';
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Edges with traveling pulses (computational coupling, not physical transport)
      for (const edge of p.graph.edges) {
        const a = byId.get(p.experiments[edge.a]?.id ?? '');
        const b = byId.get(p.experiments[edge.b]?.id ?? '');
        if (!a || !b) continue;
        const depth = viewRef.current === 'sphere' ? Math.max(0.15, (a.z + b.z) / 2 + 0.6) : 0.8;
        ctx.strokeStyle = `rgba(100,150,200,${0.05 + edge.weight * 0.22 * depth})`;
        ctx.lineWidth = 0.7 + edge.weight * 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        const t = (phaseRef.current + ((edge.a * 31 + edge.b * 17) % 100) / 140) % 1;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        ctx.fillStyle = `rgba(251,146,60,${0.5 * depth})`;
        ctx.beginPath();
        ctx.arc(px, py, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

      // Nodes, back to front
      const sorted = [...projected].sort((m, n) => m.z - n.z);
      for (const q of sorted) {
        const exp = p.experiments.find((e) => e.id === q.id);
        if (!exp) continue;
        const isSel = q.id === p.selectedId;
        const depth = viewRef.current === 'sphere' ? Math.max(0.25, q.z * 0.55 + 0.72) : 1;
        const color = nodeColor(exp, p.encoding, p.residuals);
        ctx.globalAlpha = nodeOpacity(exp) * depth;
        ctx.shadowColor = color;
        ctx.shadowBlur = isSel ? 22 : 10;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (isSel ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (isSel) {
          // expanding pulse ring, as on the original's selected/stressed hubs
          const pr = q.r + 5 + 4 * Math.abs(Math.sin(animTime * 2.2));
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(q.x, q.y, pr, 0, Math.PI * 2);
          ctx.stroke();
          // Data-driven flame glyph: procedural teardrop whose size follows the
          // selected droplet's derived diameter at the playback time. This is a
          // data-driven VISUALIZATION, not measured flame imagery.
          if (p.selectedDiameterMm !== null && p.timeNorm < 1) {
            const d0 = exp.initialDiameterMm ?? p.selectedDiameterMm;
            const scale = d0 > 0 ? Math.max(0.15, p.selectedDiameterMm / d0) : 0.5;
            const fh = 26 * scale + 6;
            const fw = 9 * scale + 3;
            const fg = ctx.createLinearGradient(q.x, q.y - fh, q.x, q.y);
            fg.addColorStop(0, 'rgba(253,224,71,0.95)');
            fg.addColorStop(0.5, 'rgba(249,115,22,0.85)');
            fg.addColorStop(1, 'rgba(190,60,20,0.25)');
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = fg;
            ctx.beginPath();
            ctx.moveTo(q.x, q.y - fh);
            ctx.bezierCurveTo(q.x + fw, q.y - fh * 0.45, q.x + fw * 0.8, q.y - 2, q.x, q.y - 2);
            ctx.bezierCurveTo(q.x - fw * 0.8, q.y - 2, q.x - fw, q.y - fh * 0.45, q.x, q.y - fh);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }
        ctx.globalAlpha = 1;
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };
    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  const pick = (clientX: number, clientY: number): Projected | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: Projected | null = null;
    let bestD = 18;
    for (const q of projectedRef.current) {
      const d = Math.hypot(x - q.x, y - q.y);
      if (d <= Math.max(bestD, q.r + 6) && d < bestD + q.r) { best = q; bestD = d; }
    }
    return best;
  };

  return (
    <div className="relative w-full h-full min-h-[520px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col">
      <div className="absolute top-3 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow-lg text-xs">
          <span className="font-semibold text-orange-400">COMBUSTION RESEARCH MANIFOLD G_t</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono">{props.experiments.length} experiments</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono">{props.graph.edges.length} relationships</span>
          <span className="ml-1 px-1.5 py-0.5 bg-orange-500/10 text-orange-300 border border-orange-500/30 rounded text-[10px] font-mono">
            COLOR: {ENCODING_LABELS[props.encoding].toUpperCase()}
          </span>
        </div>
        <div className="flex items-center gap-2 pointer-events-auto bg-slate-900/80 backdrop-blur-md p-1 rounded-lg border border-slate-700/60 shadow-lg">
          <div className="flex items-center gap-0.5 px-1 text-[11px] font-mono text-slate-400">
            {(Object.keys(ENCODING_LABELS) as NodeEncoding[]).map((enc) => (
              <button key={enc} onClick={() => props.onEncodingChange(enc)}
                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${props.encoding === enc ? 'bg-orange-500/20 text-orange-200 border border-orange-500/40' : 'text-slate-400 hover:text-slate-200'}`}>
                {enc}
              </button>
            ))}
          </div>
          <button onClick={() => setViewMode('sphere')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded ${viewMode === 'sphere' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}>
            <Globe className="w-3.5 h-3.5" /> Manifold
          </button>
          <button onClick={() => setViewMode('flat')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded ${viewMode === 'flat' ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30' : 'text-slate-400 hover:text-slate-200'}`}>
            <MapIcon className="w-3.5 h-3.5" /> Flat
          </button>
          <button onClick={() => { rotRef.current.yaw = 0.7; rotRef.current.pitch = 0.3; rotRef.current.zoom = 1; }}
            title="Reset view" className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800">
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        onMouseDown={(e) => { rotRef.current.isDragging = true; rotRef.current.lastX = e.clientX; rotRef.current.lastY = e.clientY; }}
        onMouseMove={(e) => {
          if (rotRef.current.isDragging && viewRef.current === 'sphere') {
            rotRef.current.yaw += (e.clientX - rotRef.current.lastX) * 0.006;
            rotRef.current.pitch = Math.max(-1.1, Math.min(1.1, rotRef.current.pitch + (e.clientY - rotRef.current.lastY) * 0.006));
            rotRef.current.lastX = e.clientX;
            rotRef.current.lastY = e.clientY;
            setHovered(null);
          } else {
            const hit = pick(e.clientX, e.clientY);
            const rect = canvasRef.current?.getBoundingClientRect();
            setHovered(hit && rect ? {
              exp: props.experiments.find((x) => x.id === hit.id)!,
              x: e.clientX - rect.left, y: e.clientY - rect.top,
            } : null);
          }
        }}
        onMouseUp={() => { rotRef.current.isDragging = false; }}
        onMouseLeave={() => { rotRef.current.isDragging = false; setHovered(null); }}
        onWheel={(e) => { rotRef.current.zoom = Math.max(0.55, Math.min(2.2, rotRef.current.zoom - e.deltaY * 0.0012)); }}
        onClick={(e) => { const hit = pick(e.clientX, e.clientY); if (hit) props.onSelect(hit.id); }}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none flex-1"
      />

      {hovered && (
        <div className="absolute z-20 pointer-events-none bg-slate-900/95 border border-slate-600 rounded px-2.5 py-1.5 text-[11px] text-slate-200 shadow-xl"
          style={{ left: Math.min(hovered.x + 14, 9999), top: hovered.y + 10 }}>
          <div className="font-semibold text-orange-200">{hovered.exp.id} · {hovered.exp.fuel}</div>
          <div>O2 {hovered.exp.oxidizer.o2 ?? '—'} · P {hovered.exp.pressureKPa !== null ? `${hovered.exp.pressureKPa.toFixed(0)} kPa` : '—'} · D0 {hovered.exp.initialDiameterMm ?? '—'} mm</div>
          <div>K {hovered.exp.burningRateMm2PerS ?? '—'} mm²/s · {hovered.exp.outcome} · {hovered.exp.gravity}</div>
          <div className="text-slate-400">source: {hovered.exp.provenance.datasetId}</div>
        </div>
      )}

      <div className="absolute bottom-2 left-4 right-4 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400 pointer-events-none">
        <div className="flex flex-wrap items-center gap-3 bg-slate-900/70 backdrop-blur-sm px-3 py-1 rounded border border-slate-800/80">
          {legendFor(props.encoding).map((l) => (
            <span key={l.label} className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: l.color, boxShadow: `0 0 8px ${l.color}` }} />
              {l.label}
            </span>
          ))}
          <span className="text-slate-500">size = D0 · opacity = completeness · position = schematic layout (no physical meaning) · flame glyph on selected node = data-driven visualization, not measured imagery</span>
        </div>
      </div>
    </div>
  );
};
