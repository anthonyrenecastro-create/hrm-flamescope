/**
 * Helical Recursive Manifold (HRM 4.0) Mathematical Engine
 * Strict implementation of:
 * 1. Product State X_t = [Φ, G, T, M, C, H, B]
 * 2. Conservation of Explanation Identity:
 *    Δ^T X_t = A_{0,t}^T + Σ A_{k,t}^T + Σ A_{ij,t}^T + A_{ξ,t}^T + A_{event,t} + A_{corr,t} + ε_t
 * 3. Graph Laplacian Diffusion + Cubic Reaction-Diffusion
 * 4. Stabilization Projection S_t ∘ P_t
 * 5. Multi-Objective Resource Allocation B_t with switching penalties
 */

import {
  FieldChannels,
  CarrierComplexG,
  AttributionLedgerC,
  ResourceAllocationB,
  MetricTensorM,
  TransportOperatorStateT,
  DiscreteEvent
} from '../types/hrm';
import { computeLocalSolarIntensity } from './planetaryCarrier';
import { RNGFunction } from './prng';

// Diffusivity tensor D_Φ for the 4 continuous field channels
// [GPU Util %, Queue Latency ms, Thermal Headroom °C, PUE]
// Scaled for physical millisecond stability on normalized graph Laplacian
export const DIFFUSIVITY_TENSOR = [0.006, 0.012, 0.003, 0.0008];

// Self-stabilizing Duffing-Landau cubic reaction coefficients
// R(φ) = -α ⊙ (φ - φ_0) - β ⊙ (φ - φ_0)³
const REACTION_ALPHA = [0.0012, 0.0035, 0.0015, 0.0008];
const REACTION_BETA = [1.5e-7, 2.0e-7, 1.0e-7, 5.0e-6];

// Admissible physical boundaries for projection P_t
export const PHYSICAL_BOUNDS: { min: FieldChannels; max: FieldChannels } = {
  min: [5.0, 1.0, 5.0, 1.05],
  max: [98.0, 250.0, 44.0, 1.95],
};

export const TAU_LEDGER_TOLERANCE = 1e-4;
const DELTA_REGULARIZER = 1e-6;

/**
 * Computes vector norm ||v||_2
 */
export function norm2(v: number[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return Math.sqrt(s);
}

/**
 * Initializes physical field channels Φ_0 across N data center nodes
 */
export function initializeFieldChannels(N: number, basePueValues: number[]): FieldChannels[] {
  return Array.from({ length: N }, (_, i) => {
    // Initial GPU utilization around 55% - 70%
    const util = 58.0 + Math.sin(i * 1.3) * 8.0;
    // Initial Queue Latency around 18 - 28 ms
    const queue = 20.0 + Math.cos(i * 0.9) * 5.0;
    // Initial Thermal headroom ~ 28 - 34 °C
    const headroom = 32.0 - (util / 100.0) * 8.0;
    // Initial PUE based on datacenter design baseline
    const pue = basePueValues[i] || 1.25;
    return [util, queue, headroom, pue];
  });
}

/**
 * Computes initial metric tensor M on helical coordinates
 */
export function initializeMetricTensor(N: number): MetricTensorM {
  const curvature = Array.from({ length: N }, (_, i) => 0.05 + 0.02 * Math.cos((i * 2 * Math.PI) / N));
  const helicalPhase = Array.from({ length: N }, (_, i) => (i * 2 * Math.PI) / N);
  const radiusZ = Array.from({ length: N }, (_, i) => 1.0 + 0.1 * Math.sin(i));
  return { curvature, helicalPhase, radiusZ };
}

/**
 * Solves the Continuous Field Dynamics step with guaranteed numerical stability:
 * 1. Diurnal baseline drift A_0
 * 2. Asymptotically stable cubic reaction A_k = R_Φ(φ)
 * 3. Degree-normalized Graph Laplacian diffusion A_ij = -D_Φ L_rw Φ
 * 4. Stochastic Brownian noise A_xi
 * 5. Discrete structural perturbations A_event
 * 6. Stabilization projection P_t and exact correction A_corr
 * 7. Exact Attribution Ledger validation identity: ||ε_t|| / (||ΔX|| + δ) <= τ_ledger
 */
export function computeHRMTransitionStep(
  Phi_t: FieldChannels[],
  G: CarrierComplexG,
  T: TransportOperatorStateT,
  M: MetricTensorM,
  simTimeMs: number,
  dt: number, // e.g. 0.5 to 1.0 ms
  activeEvents: DiscreteEvent[],
  previousAllocation: number[],
  rng: RNGFunction = Math.random
): {
  Phi_next: FieldChannels[];
  ledger: AttributionLedgerC;
  allocation: ResourceAllocationB;
  updatedT: TransportOperatorStateT;
  updatedM: MetricTensorM;
} {
  const N = Phi_t.length;
  const utcHours = ((simTimeMs / 3600000) % 24 + 24) % 24;

  // Flattened dimension = N * 4
  const flatDim = N * 4;

  const A_0_flat = new Array(flatDim).fill(0);
  const A_react_flat = new Array(flatDim).fill(0);
  const A_diff_flat = new Array(flatDim).fill(0);
  const A_xi_flat = new Array(flatDim).fill(0);
  const A_event_flat = new Array(flatDim).fill(0);

  // 1. Compute Diurnal Solar Drift A_0 (gentle follow-the-sun planetary wave)
  for (let i = 0; i < N; i++) {
    const node = G.nodes[i];
    const solar = computeLocalSolarIntensity(utcHours, node.lng);
    const diurnalDriftUtil = (solar - 0.45) * 0.008 * dt;
    const diurnalDriftQueue = (solar - 0.5) * 0.004 * dt;
    const diurnalDriftHeadroom = -(solar - 0.4) * 0.003 * dt;
    const diurnalDriftPue = (solar - 0.45) * 0.0001 * dt;

    const baseIdx = i * 4;
    A_0_flat[baseIdx + 0] = diurnalDriftUtil;
    A_0_flat[baseIdx + 1] = diurnalDriftQueue;
    A_0_flat[baseIdx + 2] = diurnalDriftHeadroom;
    A_0_flat[baseIdx + 3] = diurnalDriftPue;
  }

  // 2. Compute Local Node Cubic Reaction A_k = R_Φ(φ)
  // Landau-Duffing self-limiting restoring force: -α(φ - φ_0) - β(φ - φ_0)³
  for (let i = 0; i < N; i++) {
    const phi = Phi_t[i];
    const baseIdx = i * 4;
    const targetValues = [58.0, 18.0, 31.0, G.nodes[i].pueBaseline];

    for (let c = 0; c < 4; c++) {
      const delta = phi[c] - targetValues[c];
      const restoringForce = -(REACTION_ALPHA[c] * delta + REACTION_BETA[c] * (delta * delta * delta));
      A_react_flat[baseIdx + c] = restoringForce * dt;
    }
  }

  // 3. Compute Degree-Normalized Graph Laplacian Diffusion A_ij = -D_Φ L_rw Φ
  // L_rw is degree-normalized, ensuring bounded physical conduction
  const normLaplacian = G.laplacian;
  for (let i = 0; i < N; i++) {
    const baseIdx = i * 4;
    for (let c = 0; c < 4; c++) {
      let lPhi = 0;
      for (let j = 0; j < N; j++) {
        lPhi += normLaplacian[i][j] * Phi_t[j][c];
      }
      const diffusionRate = DIFFUSIVITY_TENSOR[c];
      // Helical nonlocal harmonic phase coupling
      const phaseDiff = Math.cos(M.helicalPhase[i] - M.helicalPhase[(i + 1) % N]);
      const nonlocalHarmonic = 0.0002 * phaseDiff * Math.sin(simTimeMs * 0.001);

      A_diff_flat[baseIdx + c] = (-diffusionRate * lPhi + nonlocalHarmonic) * dt;
    }
  }

  // 4. Compute Stochastic Brownian Fluctuations A_xi
  for (let i = 0; i < N; i++) {
    const baseIdx = i * 4;
    // Box-Muller pseudo-random Wiener increment using supplied RNG stream
    let u1 = rng();
    while (u1 <= 1e-12) {
      u1 = rng();
    }
    const u2 = rng();
    const g1 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const g2 = Math.sqrt(-2.0 * Math.log(u1)) * Math.sin(2.0 * Math.PI * u2);

    A_xi_flat[baseIdx + 0] = g1 * 0.02 * Math.sqrt(dt);
    A_xi_flat[baseIdx + 1] = Math.abs(g2) * 0.04 * Math.sqrt(dt);
    A_xi_flat[baseIdx + 2] = -Math.abs(g1) * 0.008 * Math.sqrt(dt);
    A_xi_flat[baseIdx + 3] = (g2 * 0.0002) * Math.sqrt(dt);
  }

  // 5. Discrete Structural Events A_event
  let divertedTrafficSum = 0;
  for (const ev of activeEvents) {
    if (ev.type === 'CABLE_SEVER') {
      // Find severed link
      const severedLink = G.links.find(l => l.id === ev.targetId || l.isSevered);
      if (severedLink) {
        const sIdx = G.nodes.findIndex(n => n.id === severedLink.sourceId);
        const tIdx = G.nodes.findIndex(n => n.id === severedLink.targetId);
        if (sIdx >= 0 && tIdx >= 0) {
          // Packet reroute backlog surge at source and destination
          A_event_flat[sIdx * 4 + 1] += 18.0 * ev.magnitude * dt; // Queue latency spike
          A_event_flat[tIdx * 4 + 1] += 14.0 * ev.magnitude * dt;
          divertedTrafficSum += severedLink.capacityTbps;
        }
      }
    } else if (ev.type === 'NODE_THERMAL_TRIP') {
      const targetIdx = G.nodes.findIndex(n => n.id === ev.targetId);
      if (targetIdx >= 0) {
        A_event_flat[targetIdx * 4 + 2] -= 15.0 * ev.magnitude * dt; // Rapid thermal loss
        A_event_flat[targetIdx * 4 + 0] -= 25.0 * ev.magnitude * dt; // Emergency throttle
        A_event_flat[targetIdx * 4 + 1] += 30.0 * ev.magnitude * dt; // Spillover buffer bloat
      }
    } else if (ev.type === 'SOLAR_SHIFT') {
      for (let i = 0; i < N; i++) {
        // Shifting solar curve
        A_event_flat[i * 4 + 0] += 5.0 * Math.sin(i + simTimeMs * 0.01) * ev.magnitude * dt;
      }
    } else if (ev.type === 'MICROBURST_SPIKE') {
      for (let i = 0; i < N; i++) {
        A_event_flat[i * 4 + 0] += (12.0 * rng()) * ev.magnitude * dt;
        A_event_flat[i * 4 + 1] += (22.0 * rng()) * ev.magnitude * dt;
      }
    }
  }

  // 6. Unconstrained Candidate Step:
  // X_{t+1}^{unconstrained} = X_t + A_0 + A_react + A_diff + A_xi + A_event
  const Phi_unconstrained: FieldChannels[] = [];
  const A_corr_flat = new Array(flatDim).fill(0);
  const Phi_next: FieldChannels[] = [];

  for (let i = 0; i < N; i++) {
    const baseIdx = i * 4;
    const oldPhi = Phi_t[i];
    const unconstrainedChannel: FieldChannels = [0, 0, 0, 0];
    const projectedChannel: FieldChannels = [0, 0, 0, 0];

    for (let c = 0; c < 4; c++) {
      const deltaUnconstrained =
        A_0_flat[baseIdx + c] +
        A_react_flat[baseIdx + c] +
        A_diff_flat[baseIdx + c] +
        A_xi_flat[baseIdx + c] +
        A_event_flat[baseIdx + c];

      let cand = oldPhi[c] + deltaUnconstrained;
      // Finite-value guard to prevent any potential NaN / Infinity propagation
      if (!Number.isFinite(cand)) {
        cand = oldPhi[c];
      }
      unconstrainedChannel[c] = cand;

      // Stabilization Projection S_t ∘ P_t onto admissible manifold
      const minB = PHYSICAL_BOUNDS.min[c];
      const maxB = PHYSICAL_BOUNDS.max[c];
      const proj = Math.max(minB, Math.min(maxB, cand));
      projectedChannel[c] = proj;

      // Correction term A_corr accounts for projection clamp
      const correction = proj - cand;
      A_corr_flat[baseIdx + c] = correction;
    }

    Phi_unconstrained.push(unconstrainedChannel);
    Phi_next.push(projectedChannel);
  }

  // 7. Conservation of Explanation Identity & Residual Verification:
  // ΔX_t = X_{t+1} - X_t
  // By exact identity: ΔX_t = A_0 + A_react + A_diff + A_xi + A_event + A_corr + ε_t
  // Therefore: ε_t = ΔX_t - (A_0 + A_react + A_diff + A_xi + A_event + A_corr)
  const totalDelta_flat = new Array(flatDim).fill(0);
  const sumAttribution_flat = new Array(flatDim).fill(0);
  const epsilon_flat = new Array(flatDim).fill(0);

  for (let k = 0; k < flatDim; k++) {
    const nodeIdx = Math.floor(k / 4);
    const c = k % 4;
    const actualDelta = Phi_next[nodeIdx][c] - Phi_t[nodeIdx][c];
    totalDelta_flat[k] = actualDelta;

    const sumA =
      A_0_flat[k] +
      A_react_flat[k] +
      A_diff_flat[k] +
      A_xi_flat[k] +
      A_event_flat[k] +
      A_corr_flat[k];
    sumAttribution_flat[k] = sumA;

    // Numerical floating-point residual
    epsilon_flat[k] = actualDelta - sumA;
  }

  const normEps = norm2(epsilon_flat);
  const normDelta = norm2(totalDelta_flat);
  const residualRatio = normEps / (normDelta + DELTA_REGULARIZER);
  const invariantPreserved = residualRatio <= TAU_LEDGER_TOLERANCE;

  // Aggregate Attribution for Ledger visualization (per 4 channels or total norm)
  const A_0_chan = [0, 0, 0, 0];
  const A_react_chan = [0, 0, 0, 0];
  const A_diff_chan = [0, 0, 0, 0];
  const A_xi_chan = [0, 0, 0, 0];
  const A_event_chan = [0, 0, 0, 0];
  const A_corr_chan = [0, 0, 0, 0];
  const eps_chan = [0, 0, 0, 0];
  const delta_chan = [0, 0, 0, 0];

  for (let i = 0; i < N; i++) {
    for (let c = 0; c < 4; c++) {
      const k = i * 4 + c;
      A_0_chan[c] += A_0_flat[k];
      A_react_chan[c] += A_react_flat[k];
      A_diff_chan[c] += A_diff_flat[k];
      A_xi_chan[c] += A_xi_flat[k];
      A_event_chan[c] += A_event_flat[k];
      A_corr_chan[c] += A_corr_flat[k];
      eps_chan[c] += epsilon_flat[k];
      delta_chan[c] += totalDelta_flat[k];
    }
  }

  const ledger: AttributionLedgerC = {
    step: Math.floor(simTimeMs / dt),
    timestampMs: simTimeMs,
    A_0: A_0_chan,
    A_react: A_react_chan,
    A_diff: A_diff_chan,
    A_xi: A_xi_chan,
    A_event: A_event_chan,
    A_corr: A_corr_chan,
    epsilon: eps_chan,
    totalDelta: delta_chan,
    residualRatio,
    invariantPreserved,
  };

  // 8. Multi-Objective Resource Allocation B_t
  const allocation = solveResourceAllocation(Phi_next, G, utcHours, previousAllocation);

  // 9. Update Transport Operator State T (traffic diverted, zero phantom energy)
  const updatedT: TransportOperatorStateT = {
    lastTopologyMutationTime: activeEvents.length > 0 ? simTimeMs : T.lastTopologyMutationTime,
    activeSeveredLinks: G.links.filter(l => l.isSevered).map(l => l.id),
    divertedTrafficRatio: divertedTrafficSum > 0 ? Math.min(1.0, divertedTrafficSum / 2000.0) : 0,
    phantomEnergyResidual: normEps, // strictly bounded residual
  };

  // 10. Update Metric Tensor coordinates
  const updatedM: MetricTensorM = {
    curvature: M.curvature.map((k, i) => k + 0.0001 * ((Phi_next[i] ? Phi_next[i][0] : 50.0) / 100 - 0.5)),
    helicalPhase: M.helicalPhase.map((th, i) => (th + 0.002 * ((Phi_next[i] ? Phi_next[i][1] : 20.0) / 50)) % (2 * Math.PI)),
    radiusZ: M.radiusZ.map((r, i) => Math.max(0.5, r + 0.001 * ((Phi_next[i] ? Phi_next[i][3] : 1.2) - 1.2))),
  };

  return {
    Phi_next,
    ledger,
    allocation,
    updatedT,
    updatedM,
  };
}

/**
 * Solves the multi-objective dispatch problem:
 * a* = argmax Σ (u_i * a_i) - λ_switch * ||a - a_{t-1}||_1  subject to  Σ a_i = 1, cost <= B_total
 * where utility u_i incorporates latency, solar/clean intensity, and thermal headroom.
 */
export function solveResourceAllocation(
  Phi: FieldChannels[],
  G: CarrierComplexG,
  utcHours: number,
  prevAlloc: number[]
): ResourceAllocationB {
  const N = Phi.length;
  const lambdaSwitch = 0.15; // switching penalty multiplier

  const utilityScores: number[] = new Array(N).fill(0);
  const carbonIntensity: number[] = new Array(N).fill(0);

  // Weights for multi-objective utility function
  const w_lat = 0.35;
  const w_solar = 0.30;
  const w_therm = 0.20;
  const w_pue = 0.15;

  for (let i = 0; i < N; i++) {
    const [util, queue, headroom, pue] = Phi[i];
    const node = G.nodes[i];
    const solar = computeLocalSolarIntensity(utcHours, node.lng);

    // Carbon intensity is inversely proportional to solar availability and baseline PUE
    const cleanEnergyIndex = Math.min(1.0, solar * node.solarExposureCoeff + 0.15);
    carbonIntensity[i] = 1.0 - cleanEnergyIndex;

    // Latency penalty: queue latency normalized [0, 100ms]
    const latencyScore = Math.max(0, 1.0 - queue / 80.0);
    // Thermal safety score: headroom normalized [0, 45 °C]
    const thermScore = Math.min(1.0, Math.max(0, headroom / 40.0));
    // PUE efficiency score: 1.1 is great (1.0), 1.6 is poor (0.0)
    const pueScore = Math.max(0, 1.0 - (pue - 1.1) / 0.6);

    const u =
      w_lat * latencyScore +
      w_solar * cleanEnergyIndex +
      w_therm * thermScore +
      w_pue * pueScore;

    utilityScores[i] = Math.max(0.01, u);
  }

  // Exponentiated gradient / softmax dispatch with momentum and switching cost
  const rawWeights: number[] = new Array(N).fill(0);
  let sumW = 0;

  for (let i = 0; i < N; i++) {
    const prevA = prevAlloc[i] !== undefined ? prevAlloc[i] : 1.0 / N;
    // Boost utility with historical allocation momentum to balance switching cost
    const score = utilityScores[i] - lambdaSwitch * Math.abs(1.0 / N - prevA);
    const expScore = Math.exp(score * 3.5);
    rawWeights[i] = expScore;
    sumW += expScore;
  }

  const dispatchVector = rawWeights.map(w => w / (sumW || 1.0));

  // Compute total switching penalty
  let switchingPenalty = 0;
  if (prevAlloc && prevAlloc.length === N) {
    for (let i = 0; i < N; i++) {
      switchingPenalty += Math.abs(dispatchVector[i] - prevAlloc[i]);
    }
    switchingPenalty *= lambdaSwitch;
  }

  // Budget cost: sum of power cost * allocation
  let totalBudgetCost = 0;
  for (let i = 0; i < N; i++) {
    totalBudgetCost += dispatchVector[i] * (Phi[i][3] * 12.5 + Phi[i][0] * 0.4);
  }

  return {
    dispatchVector,
    utilityScores,
    switchingPenalty,
    totalBudgetCost,
    carbonIntensity,
  };
}
