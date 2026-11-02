/**
 * Conventional Forecasting Baselines for HRM 4.1 Benchmarking
 * Provides industry-standard reference models evaluated against the identical ground-truth plant:
 * 1. Persistence (Zero-Order Hold: last observed state remains constant)
 * 2. Linear Extrapolation (velocity projection from recent telemetry trend)
 * 3. Degree-Normalized Graph Laplacian Diffusion Only (linear heat conduction without cubic reaction or manifold)
 * 4. Exponential Moving Average (EWMA / smoothed trend)
 */

import { FieldChannels, CarrierComplexG, ForecastRecord } from '../types/hrm';
import { cloneFieldChannels } from './clone';
import { DIFFUSIVITY_TENSOR, PHYSICAL_BOUNDS } from './hrmMath';

/**
 * Persistence (Last-Value) Baseline:
 * Assumes the network state at t + horizonMs equals the latest observed state at issueTime.
 */
export function runPersistenceForecast(
  observedPhi: FieldChannels[],
  issueTimeMs: number,
  horizonMs: number = 500
): ForecastRecord {
  const prediction = cloneFieldChannels(observedPhi);
  return {
    forecastId: `fc-persist-${Math.round(issueTimeMs)}`,
    issuedAtMs: issueTimeMs,
    targetAtMs: issueTimeMs + horizonMs,
    horizonMs,
    sourceWatermarkMs: issueTimeMs,
    prediction,
    mode: 'persistence',
    seed: 0,
    status: 'pending',
  };
}

/**
 * Linear Extrapolation Baseline:
 * Uses estimated velocity between recent observation and prior observation to project forward.
 */
export function runLinearExtrapolationForecast(
  currentPhi: FieldChannels[],
  previousPhi: FieldChannels[],
  sampleIntervalMs: number,
  issueTimeMs: number,
  horizonMs: number = 500
): ForecastRecord {
  const N = currentPhi.length;
  const prediction: FieldChannels[] = [];
  const dt = Math.max(1, sampleIntervalMs);

  for (let i = 0; i < N; i++) {
    const cur = currentPhi[i];
    const prev = previousPhi[i] || cur;
    const projected: FieldChannels = [0, 0, 0, 0];

    for (let c = 0; c < 4; c++) {
      const velocity = (cur[c] - prev[c]) / dt; // units per ms
      let cand = cur[c] + velocity * horizonMs;

      // Dampen extreme velocity runaway and clamp to physical bounds
      if (!Number.isFinite(cand)) {
        cand = cur[c];
      }
      cand = Math.max(PHYSICAL_BOUNDS.min[c], Math.min(PHYSICAL_BOUNDS.max[c], cand));
      projected[c] = cand;
    }
    prediction.push(projected);
  }

  return {
    forecastId: `fc-linearextrap-${Math.round(issueTimeMs)}`,
    issuedAtMs: issueTimeMs,
    targetAtMs: issueTimeMs + horizonMs,
    horizonMs,
    sourceWatermarkMs: issueTimeMs,
    prediction,
    mode: 'linear_extrap',
    seed: 0,
    status: 'pending',
  };
}

/**
 * Pure Graph Laplacian Diffusion Baseline:
 * Simulates standard linear continuous diffusion on the network: dΦ/dt = -D_Φ L_rw Φ
 * Omits non-linear cubic reaction forces, helical coupling, and dynamic diurnal tracking.
 */
export function runDiffusionOnlyForecast(
  observedPhi: FieldChannels[],
  G: CarrierComplexG,
  issueTimeMs: number,
  horizonMs: number = 500,
  stepMs: number = 1.0
): ForecastRecord {
  const N = observedPhi.length;
  let currentPhi = cloneFieldChannels(observedPhi);
  const numSteps = Math.max(1, Math.ceil(horizonMs / stepMs));
  const normLaplacian = G.laplacian;

  for (let s = 0; s < numSteps; s++) {
    const nextPhi: FieldChannels[] = [];
    for (let i = 0; i < N; i++) {
      const nextChan: FieldChannels = [0, 0, 0, 0];
      for (let c = 0; c < 4; c++) {
        let lPhi = 0;
        for (let j = 0; j < N; j++) {
          lPhi += normLaplacian[i][j] * currentPhi[j][c];
        }
        const delta = -DIFFUSIVITY_TENSOR[c] * lPhi * stepMs;
        let cand = currentPhi[i][c] + delta;
        cand = Math.max(PHYSICAL_BOUNDS.min[c], Math.min(PHYSICAL_BOUNDS.max[c], cand));
        nextChan[c] = cand;
      }
      nextPhi.push(nextChan);
    }
    currentPhi = nextPhi;
  }

  return {
    forecastId: `fc-diffusion-${Math.round(issueTimeMs)}`,
    issuedAtMs: issueTimeMs,
    targetAtMs: issueTimeMs + horizonMs,
    horizonMs,
    sourceWatermarkMs: issueTimeMs,
    prediction: currentPhi,
    mode: 'diffusion_only',
    seed: 0,
    status: 'pending',
  };
}
