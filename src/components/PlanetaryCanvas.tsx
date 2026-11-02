import React, { useRef, useEffect, useState, useCallback } from 'react';
import { CarrierComplexG, HubNode, FiberLink, FieldChannels } from '../types/hrm';
import { Globe, Map as MapIcon, Maximize2, RotateCcw, Flame, ShieldAlert } from 'lucide-react';

interface PlanetaryCanvasProps {
  carrier: CarrierComplexG;
  phiA: FieldChannels[];
  phiB: FieldChannels[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  divergenceAnomaly: boolean;
  thermalThreshold?: number; // Headroom in °C below which thermal pulse triggers
  onSetThermalThreshold?: (thresh: number) => void;
}

// Continents simplified polygon approximation for world globe drawing
const CONTINENT_LANDMASSES = [
  // North America
  [[-130, 50], [-120, 30], [-100, 20], [-80, 25], [-75, 40], [-65, 45], [-90, 60], [-130, 60]],
  // South America
  [[-80, 10], [-40, -5], [-35, -15], [-55, -45], [-70, -50], [-75, -20], [-80, 5]],
  // Eurasia
  [[-10, 36], [30, 36], [60, 25], [100, 15], [120, 25], [140, 45], [130, 65], [60, 70], [10, 60], [-5, 50]],
  // Africa
  [[-15, 30], [30, 32], [50, 10], [40, -10], [30, -32], [15, -30], [5, 5], [-15, 15]],
  // Australia
  [[115, -22], [140, -15], [150, -30], [135, -35], [115, -30]],
];

export const PlanetaryCanvas: React.FC<PlanetaryCanvasProps> = ({
  carrier,
  phiA,
  selectedNodeId,
  onSelectNode,
  divergenceAnomaly,
  thermalThreshold = 25.0,
  onSetThermalThreshold,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewMode, setViewMode] = useState<'globe' | 'flat'>('globe');
  const [internalThreshold, setInternalThreshold] = useState<number>(thermalThreshold);

  const activeThreshold = onSetThermalThreshold ? thermalThreshold : internalThreshold;
  const setThreshold = onSetThermalThreshold || setInternalThreshold;

  const thermalThresholdRef = useRef(activeThreshold);
  thermalThresholdRef.current = activeThreshold;

  // Globe rotation state in radians
  const rotRef = useRef<{ yaw: number; pitch: number; isDragging: boolean; lastX: number; lastY: number }>({
    yaw: 0.8,
    pitch: 0.25,
    isDragging: false,
    lastX: 0,
    lastY: 0,
  });

  // Photon packet animation positions along links
  const packetPhaseRef = useRef<number>(0);

  // Stressed nodes exceeding thermal threshold (headroom <= threshold)
  const stressedNodes = carrier.nodes.filter((_, i) => phiA[i] && phiA[i][2] <= activeThreshold);

  // Resize handling
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

  // Mouse interaction for rotating 3D globe or clicking nodes
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    rotRef.current.isDragging = true;
    rotRef.current.lastX = e.clientX;
    rotRef.current.lastY = e.clientY;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!rotRef.current.isDragging || viewMode !== 'globe') return;
    const dx = e.clientX - rotRef.current.lastX;
    const dy = e.clientY - rotRef.current.lastY;
    rotRef.current.lastX = e.clientX;
    rotRef.current.lastY = e.clientY;

    rotRef.current.yaw += dx * 0.006;
    rotRef.current.pitch = Math.max(-1.1, Math.min(1.1, rotRef.current.pitch + dy * 0.006));
  };

  const handleMouseUp = () => {
    rotRef.current.isDragging = false;
  };

  // Click detection to select data center nodes
  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const width = rect.width;
    const height = rect.height;

    // Check click against node screen positions
    for (const node of carrier.nodes) {
      const pos = projectCoordinates(node.lat, node.lng, width, height, viewMode, rotRef.current.yaw, rotRef.current.pitch);
      if (pos.visible) {
        const dist = Math.hypot(clickX - pos.x, clickY - pos.y);
        if (dist <= 18) {
          onSelectNode(node.id);
          return;
        }
      }
    }
  };

  // Keep latest props in refs to decouple canvas render loop from React state re-renders
  const carrierRef = useRef(carrier);
  carrierRef.current = carrier;
  const phiARef = useRef(phiA);
  phiARef.current = phiA;
  const selectedNodeIdRef = useRef(selectedNodeId);
  selectedNodeIdRef.current = selectedNodeId;

  // Persistent 60 FPS Render loop (only restarts if viewMode changes)
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

      // Advance packet pulses
      packetPhaseRef.current = (packetPhaseRef.current + 0.008) % 1.0;

      // Auto-rotate globe slightly when not dragging
      if (!rotRef.current.isDragging && viewMode === 'globe') {
        rotRef.current.yaw += 0.0008;
      }

      const animTime = performance.now() / 1000.0;
      const { yaw, pitch } = rotRef.current;
      const currentCarrier = carrierRef.current;
      const currentPhiA = phiARef.current;
      const currentSelectedNodeId = selectedNodeIdRef.current;
      const currentThreshold = thermalThresholdRef.current;

      // Draw background space & stars
      drawBackground(ctx, width, height);

      if (viewMode === 'globe') {
        drawGlobeBackdrop(ctx, width, height, yaw, pitch);
      } else {
        drawFlatGrid(ctx, width, height);
      }

      // Draw continent landmass silhouettes
      drawContinents(ctx, width, height, viewMode, yaw, pitch);

      // Draw fiber links (healthy, congested, severed)
      drawFiberLinks(ctx, width, height, currentCarrier, viewMode, yaw, pitch, packetPhaseRef.current);

      // Draw data center hub beacons with thermal pulse animation
      drawHubNodes(
        ctx,
        width,
        height,
        currentCarrier.nodes,
        currentPhiA,
        currentSelectedNodeId,
        viewMode,
        yaw,
        pitch,
        animTime,
        currentThreshold
      );

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [viewMode]);

  return (
    <div className="relative w-full h-full min-h-[460px] bg-slate-950 rounded-xl overflow-hidden border border-slate-800 shadow-2xl flex flex-col">
      {/* Top Overlay Controls */}
      <div className="absolute top-3 left-4 right-4 z-10 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-lg border border-slate-700/60 shadow-lg text-xs">
          <span className="font-semibold text-cyan-400">PLANETARY CARRIER K_t</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono">14 Data Center Hubs</span>
          <span className="text-slate-500">·</span>
          <span className="text-slate-300 font-mono">20 Trunks</span>

          {/* Stressed Nodes Alert Badge */}
          {stressedNodes.length > 0 ? (
            <button
              onClick={() => onSelectNode(stressedNodes[0].id)}
              className="ml-1 flex items-center gap-1.5 px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/50 rounded text-[10.5px] font-mono animate-pulse transition-colors"
              title="Click to inspect thermally stressed data center"
            >
              <Flame className="w-3.5 h-3.5 text-rose-400 fill-rose-500/40" />
              <span>
                {stressedNodes.length} HUB THERMAL PULSE ({stressedNodes.map(n => n.code).join(', ')})
              </span>
            </button>
          ) : (
            <span className="ml-1 px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded text-[10px] font-mono">
              THERMAL HEADROOM NOMINAL
            </span>
          )}

          {divergenceAnomaly && (
            <span className="ml-1 px-2 py-0.5 bg-rose-500/20 text-rose-300 border border-rose-500/40 rounded text-[10px] font-mono animate-pulse">
              DIVERGENCE ANOMALY
            </span>
          )}
        </div>

        {/* View Mode & Thermal Threshold Controls */}
        <div className="flex items-center gap-2 pointer-events-auto bg-slate-900/80 backdrop-blur-md p-1 rounded-lg border border-slate-700/60 shadow-lg">
          {/* Thermal Sensitivity Selector */}
          <div className="flex items-center gap-1 px-2 py-0.5 text-[11px] font-mono text-slate-400 border-r border-slate-800">
            <Flame className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">Stress:</span>
            <div className="flex items-center gap-0.5">
              {[20, 24, 28].map(th => (
                <button
                  key={th}
                  onClick={() => setThreshold(th)}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    activeThreshold === th
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Trigger pulse when thermal headroom drops below ${th}°C`}
                >
                  &lt;{th}°C
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => setViewMode('globe')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'globe'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-3.5 h-3.5" />
            3D Globe
          </button>
          <button
            onClick={() => setViewMode('flat')}
            className={`flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors ${
              viewMode === 'flat'
                ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <MapIcon className="w-3.5 h-3.5" />
            Flat Map
          </button>
          <button
            onClick={() => {
              rotRef.current.yaw = 0.8;
              rotRef.current.pitch = 0.25;
            }}
            title="Reset Globe Orientation"
            className="p-1 text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Canvas */}
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handleClick}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none flex-1"
      />

      {/* Bottom Telemetry Legend */}
      <div className="absolute bottom-2 left-4 right-4 z-10 flex items-center justify-between text-[11px] text-slate-400 pointer-events-none">
        <div className="flex items-center gap-4 bg-slate-900/70 backdrop-blur-sm px-3 py-1 rounded border border-slate-800/80">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />
            <span>Optimal (&lt;60% Util)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]" />
            <span>Elevated Load</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.8)]" />
            <span>Throttled</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
            </span>
            <span className="text-rose-300 font-medium">Thermal Pulse (&lt;{activeThreshold}°C)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-0.5 bg-rose-500 border-b border-dashed border-rose-300" />
            <span>Severed Cable</span>
          </div>
        </div>

        <div className="font-mono text-[10px] text-slate-500">
          Drag to orbit · Click node for deep inspection
        </div>
      </div>
    </div>
  );
};

// Coordinate projection helper (Orthographic 3D Globe or Equirectangular 2D)
function projectCoordinates(
  lat: number,
  lng: number,
  width: number,
  height: number,
  mode: 'globe' | 'flat',
  yaw: number,
  pitch: number
): { x: number; y: number; visible: boolean; z: number } {
  if (mode === 'flat') {
    // Equirectangular mapping
    const x = ((lng + 180) / 360) * width;
    const y = ((90 - lat) / 180) * height;
    return { x, y, visible: true, z: 0 };
  }

  // 3D Globe Orthographic Projection
  const radius = Math.min(width, height) * 0.42;
  const cx = width / 2;
  const cy = height / 2;

  const phi = (lat * Math.PI) / 180;
  const lambda = (lng * Math.PI) / 180;

  // Spherical to 3D Cartesian
  const x0 = radius * Math.cos(phi) * Math.sin(lambda);
  const y0 = -radius * Math.sin(phi);
  const z0 = radius * Math.cos(phi) * Math.cos(lambda);

  // Apply Yaw (Y-axis rotation)
  const x1 = x0 * Math.cos(yaw) + z0 * Math.sin(yaw);
  const y1 = y0;
  const z1 = -x0 * Math.sin(yaw) + z0 * Math.cos(yaw);

  // Apply Pitch (X-axis rotation)
  const x2 = x1;
  const y2 = y1 * Math.cos(pitch) - z1 * Math.sin(pitch);
  const z2 = y1 * Math.sin(pitch) + z1 * Math.cos(pitch);

  const visible = z2 > -10; // Front hemisphere + slight margin
  return {
    x: cx + x2,
    y: cy + y2,
    visible,
    z: z2,
  };
}

function drawBackground(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const grad = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, width);
  grad.addColorStop(0, '#040814');
  grad.addColorStop(1, '#020408');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Subtle ambient starlight points
  ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
  const seed = 42;
  for (let i = 0; i < 40; i++) {
    const sx = (Math.sin(i * 99 + seed) * 0.5 + 0.5) * width;
    const sy = (Math.cos(i * 77 + seed) * 0.5 + 0.5) * height;
    ctx.fillRect(sx, sy, 1, 1);
  }
}

function drawGlobeBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  yaw: number,
  pitch: number
) {
  const radius = Math.min(width, height) * 0.42;
  const cx = width / 2;
  const cy = height / 2;

  // Globe dark sphere
  const globeGrad = ctx.createRadialGradient(
    cx - radius * 0.3,
    cy - radius * 0.3,
    radius * 0.1,
    cx,
    cy,
    radius
  );
  globeGrad.addColorStop(0, '#0a152e');
  globeGrad.addColorStop(0.7, '#050c1e');
  globeGrad.addColorStop(1, '#02050e');

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = globeGrad;
  ctx.fill();

  // Outer atmospheric blue halo
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 2, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Latitude and Longitude Graticule grid
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = 'rgba(30, 58, 110, 0.25)';
  ctx.lineWidth = 1;

  // Parallels (latitudes)
  for (let lat = -60; lat <= 60; lat += 30) {
    ctx.beginPath();
    let started = false;
    for (let lng = -180; lng <= 180; lng += 10) {
      const p = projectCoordinates(lat, lng, width, height, 'globe', yaw, pitch);
      if (p.visible) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  // Meridians (longitudes)
  for (let lng = -180; lng < 180; lng += 45) {
    ctx.beginPath();
    let started = false;
    for (let lat = -80; lat <= 80; lat += 10) {
      const p = projectCoordinates(lat, lng, width, height, 'globe', yaw, pitch);
      if (p.visible) {
        if (!started) {
          ctx.moveTo(p.x, p.y);
          started = true;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

function drawFlatGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  ctx.strokeStyle = 'rgba(30, 58, 110, 0.2)';
  ctx.lineWidth = 1;

  // Grid lines
  for (let x = 0; x <= width; x += width / 12) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = 0; y <= height; y += height / 6) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }
}

function drawContinents(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  mode: 'globe' | 'flat',
  yaw: number,
  pitch: number
) {
  const radius = Math.min(width, height) * 0.42;
  const cx = width / 2;
  const cy = height / 2;

  ctx.save();
  if (mode === 'globe') {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();
  }

  ctx.fillStyle = 'rgba(15, 30, 60, 0.45)';
  ctx.strokeStyle = 'rgba(38, 70, 125, 0.4)';
  ctx.lineWidth = 1.2;

  CONTINENT_LANDMASSES.forEach(polygon => {
    ctx.beginPath();
    let first = true;
    polygon.forEach(([lng, lat]) => {
      const p = projectCoordinates(lat, lng, width, height, mode, yaw, pitch);
      if (p.visible) {
        if (first) {
          ctx.moveTo(p.x, p.y);
          first = false;
        } else {
          ctx.lineTo(p.x, p.y);
        }
      }
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  });

  ctx.restore();
}

function drawFiberLinks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  carrier: CarrierComplexG,
  mode: 'globe' | 'flat',
  yaw: number,
  pitch: number,
  phase: number
) {
  const nodeMap = new Map<string, HubNode>();
  carrier.nodes.forEach(n => nodeMap.set(n.id, n));

  carrier.links.forEach(link => {
    const sNode = nodeMap.get(link.sourceId);
    const tNode = nodeMap.get(link.targetId);
    if (!sNode || !tNode) return;

    const p1 = projectCoordinates(sNode.lat, sNode.lng, width, height, mode, yaw, pitch);
    const p2 = projectCoordinates(tNode.lat, tNode.lng, width, height, mode, yaw, pitch);

    if (!p1.visible && !p2.visible) return;

    ctx.save();

    if (link.isSevered) {
      // Severed Link (Red dashed line + alert glow)
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.85)';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Disruption cross marker at midpoint
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      ctx.fillStyle = '#f43f5e';
      ctx.beginPath();
      ctx.arc(midX, midY, 4, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Normal or Congested Link
      const isSubsea = link.type === 'submarine';
      const strokeCol = isSubsea ? 'rgba(34, 211, 238, 0.5)' : 'rgba(96, 165, 250, 0.45)';

      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = Math.min(3.5, Math.max(1.2, link.capacityTbps / 100));
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();

      // Pulsing Photon Packets moving at speed-of-light along link
      const packetCount = Math.max(1, Math.floor(link.lengthKm / 3500));
      for (let k = 0; k < packetCount; k++) {
        const offset = (phase + k / packetCount) % 1.0;
        const px = p1.x + (p2.x - p1.x) * offset;
        const py = p1.y + (p2.y - p1.y) * offset;

        ctx.fillStyle = '#67e8f9';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(px, py, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  });
}

function drawHubNodes(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  nodes: HubNode[],
  phiA: FieldChannels[],
  selectedId: string | null,
  mode: 'globe' | 'flat',
  yaw: number,
  pitch: number,
  animTime: number,
  thermalThreshold: number
) {
  nodes.forEach((node, i) => {
    const pos = projectCoordinates(node.lat, node.lng, width, height, mode, yaw, pitch);
    if (!pos.visible) return;

    const [util, queue, headroom, pue] = phiA[i] || [50, 20, 30, 1.2];
    const isSelected = selectedId === node.id;
    const isThermallyStressed = headroom <= thermalThreshold;

    // Node color gradient based on GPU Utilization and Thermal status
    let nodeColor = '#22d3ee'; // Cyan (optimal)
    if (util > 75) nodeColor = '#fbbf24'; // Amber (elevated)
    if (util > 88 || isThermallyStressed) nodeColor = '#f43f5e'; // Crimson (saturated or thermal stress)

    ctx.save();

    // 1. Thermal Stress Pulse Shockwaves & Radial Aura
    if (isThermallyStressed) {
      const deficit = thermalThreshold - headroom;
      const severity = Math.min(1.0, Math.max(0.15, deficit / 12.0));

      // Multi-stage outward expanding shockwave rings
      const ringSpeed = 1.4 + severity * 1.6;
      for (let k = 0; k < 3; k++) {
        const ringPhase = ((animTime * ringSpeed + k * 0.33) % 1.0);
        const ringRadius = 6.5 + ringPhase * (24 + severity * 16);
        const ringAlpha = (1.0 - ringPhase) * (0.85 * severity + 0.3);

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, ringRadius, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(244, 63, 94, ${ringAlpha})`;
        ctx.lineWidth = Math.max(1, 2.5 * (1.0 - ringPhase * 0.6));
        ctx.stroke();

        // Inner fiery incandescent golden shockwave
        if (k === 0) {
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, ringRadius * 0.55, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(251, 146, 60, ${ringAlpha * 0.9})`;
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
      }

      // Blazing radial thermal glow aura
      const auraRadius = 18 + severity * 14;
      const auraPulse = 0.35 + 0.25 * Math.sin(animTime * (8 + severity * 6));
      const auraGrad = ctx.createRadialGradient(pos.x, pos.y, 2, pos.x, pos.y, auraRadius);
      auraGrad.addColorStop(0, `rgba(244, 63, 94, ${auraPulse * 1.2})`);
      auraGrad.addColorStop(0.5, `rgba(251, 146, 60, ${auraPulse * 0.7})`);
      auraGrad.addColorStop(1, 'rgba(244, 63, 94, 0)');

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, auraRadius, 0, Math.PI * 2);
      ctx.fillStyle = auraGrad;
      ctx.fill();
    } else if (queue > 40 || util > 80) {
      // Standard queue/utilization buffer bloat pulse halo
      const pulseSize = 8 + (queue / 15);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pulseSize, 0, Math.PI * 2);
      ctx.strokeStyle = `${nodeColor}44`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (isSelected) {
      // Selected targeting ring
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 14, 0, Math.PI * 2);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.0;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
    }

    // Outer glow
    ctx.shadowColor = nodeColor;
    ctx.shadowBlur = isThermallyStressed ? 18 : isSelected ? 16 : 8;

    // Core Beacon circle (pulsating size when thermally stressed)
    const corePulse = isThermallyStressed
      ? (Math.sin(animTime * 12) * 0.5 + 0.5) * 2.8
      : 0;
    const coreRadius = (isSelected ? 6.5 : 5.0) + corePulse;

    ctx.beginPath();
    ctx.arc(pos.x, pos.y, coreRadius, 0, Math.PI * 2);
    ctx.fillStyle = nodeColor;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    // Node code text label
    ctx.shadowBlur = 0;
    ctx.fillStyle = isThermallyStressed ? '#fda4af' : isSelected ? '#38bdf8' : '#e2e8f0';
    ctx.font = isSelected || isThermallyStressed ? '600 11px Inter, sans-serif' : '500 9.5px Inter, sans-serif';
    ctx.fillText(node.code, pos.x + 8, pos.y + 3);

    // Thermal headroom readout badge for stressed nodes
    if (isThermallyStressed) {
      ctx.fillStyle = '#f43f5e';
      ctx.font = 'bold 9px Fira Code, monospace';
      ctx.fillText(`🔥 ${headroom.toFixed(1)}°C`, pos.x + 8, pos.y + 14);
    }

    ctx.restore();
  });
}
