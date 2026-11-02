/**
 * Visual-to-data encodings for the Combustion Research Manifold.
 *
 * Every visual channel maps to a declared data variable; the mapping
 * functions here are pure and unit-tested so the visualization cannot
 * silently drift from the data (spec §11 "visual-to-data consistency").
 *
 * - Color: chosen encoding (outcome / O2 / held-out residual / fuel)
 * - Radius: initial droplet diameter D0 (missing -> mid default, outlined dashed in UI legend)
 * - Opacity: measurement completeness (1 - missing/7)
 * - Position: SCHEMATIC layout only (deterministic sphere distribution).
 *   Position carries NO physical meaning and the UI says so.
 */
import { CombustionExperiment } from '../types/combustion';

export type NodeEncoding = 'outcome' | 'o2' | 'residual' | 'fuel';

export const ENCODING_LABELS: Record<NodeEncoding, string> = {
  outcome: 'Test outcome',
  o2: 'Oxygen mole fraction',
  residual: 'HRM held-out residual (mm²/s)',
  fuel: 'Fuel',
};

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hexLerp(c1: [number, number, number], c2: [number, number, number], t: number): string {
  const r = Math.round(lerp(c1[0], c2[0], t));
  const g = Math.round(lerp(c1[1], c2[1], t));
  const b = Math.round(lerp(c1[2], c2[2], t));
  return `rgb(${r},${g},${b})`;
}

/** O2 color scale anchors: 0.10 (deep blue) -> 0.21 (orange) -> 0.30 (bright yellow). */
export function o2Color(o2: number | null): string {
  if (o2 === null) return '#64748b'; // slate: missing
  if (o2 <= 0.21) return hexLerp([56, 130, 246], [249, 115, 22], Math.max(0, (o2 - 0.1) / 0.11));
  return hexLerp([249, 115, 22], [253, 224, 71], Math.min(1, (o2 - 0.21) / 0.09));
}

export function outcomeColor(e: CombustionExperiment): string {
  switch (e.outcome) {
    case 'Extinction': return '#f43f5e'; // rose
    case 'Disruption': return '#f59e0b'; // amber
    case 'Completion': return '#34d399'; // emerald
    default: return '#94a3b8';
  }
}

export function fuelColor(e: CombustionExperiment): string {
  const f = e.fuel.toLowerCase();
  if (f.includes('heptane')) return '#38bdf8'; // sky
  if (f.includes('methanol')) return '#fb923c'; // orange
  return '#a78bfa';
}

/** Residual diverging scale: negative (under-predicted K) blue, ~0 slate-green, positive red. Range clamped at ±0.2 mm²/s. */
export function residualColor(residual: number | null | undefined): string {
  if (residual === null || residual === undefined) return '#475569'; // not in held-out set
  const t = Math.max(-1, Math.min(1, residual / 0.2));
  if (t < 0) return hexLerp([52, 211, 153], [56, 130, 246], -t);
  return hexLerp([52, 211, 153], [244, 63, 94], t);
}

export function nodeColor(
  e: CombustionExperiment,
  encoding: NodeEncoding,
  residuals: Map<string, number>,
): string {
  switch (encoding) {
    case 'outcome': return outcomeColor(e);
    case 'o2': return o2Color(e.oxidizer.o2);
    case 'fuel': return fuelColor(e);
    case 'residual': return residualColor(residuals.get(e.id));
  }
}

/** Radius in px from D0: 1mm -> 3.5px, 5mm -> 10px (sqrt scale). Missing D0 -> 5px. */
export function nodeRadius(e: CombustionExperiment): number {
  if (e.initialDiameterMm === null) return 5;
  return 3 + Math.sqrt(Math.max(0.1, e.initialDiameterMm)) * 3.2;
}

/** Opacity 0.35..1 from measurement completeness. */
export function nodeOpacity(e: CombustionExperiment): number {
  return 0.35 + 0.65 * (1 - e.missingFields.length / 7);
}

export interface LegendEntry { color: string; label: string }

export function legendFor(encoding: NodeEncoding): LegendEntry[] {
  switch (encoding) {
    case 'outcome':
      return [
        { color: '#f43f5e', label: 'Extinction (visible flame out)' },
        { color: '#f59e0b', label: 'Disruption' },
        { color: '#34d399', label: 'Completion (burned out)' },
        { color: '#94a3b8', label: 'Unknown outcome' },
      ];
    case 'o2':
      return [
        { color: o2Color(0.12), label: 'O2 ≈ 0.12' },
        { color: o2Color(0.17), label: 'O2 ≈ 0.17' },
        { color: o2Color(0.21), label: 'O2 ≈ 0.21 (air-like)' },
        { color: o2Color(0.28), label: 'O2 ≈ 0.28' },
        { color: '#64748b', label: 'O2 missing' },
      ];
    case 'fuel':
      return [
        { color: '#fb923c', label: 'Methanol' },
        { color: '#38bdf8', label: 'Heptane' },
        { color: '#a78bfa', label: 'Other / synthetic fuel' },
      ];
    case 'residual':
      return [
        { color: residualColor(-0.2), label: 'Observed K well above prediction' },
        { color: residualColor(0), label: 'Prediction ≈ observed' },
        { color: residualColor(0.2), label: 'Observed K well below prediction' },
        { color: '#475569', label: 'Not in held-out test set' },
      ];
  }
}

/**
 * Deterministic schematic layout: Fibonacci sphere, index-ordered.
 * Pure layout — carries no data meaning (declared in the UI).
 */
export function spherePosition(index: number, total: number): { x: number; y: number; z: number } {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = total <= 1 ? 0 : 1 - (index / (total - 1)) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = golden * index;
  return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
}
