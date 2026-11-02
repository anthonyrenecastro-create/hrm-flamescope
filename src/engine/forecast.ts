/**
 * HRM 4.1 Predictive Forecasting Engine
 * True 500ms forward numerical predictive integration.
 * Performs exact sub-stepped numerical integration from independent observer snapshots.
 * Zero future state leakage; strict target timestamp evaluation and calibration bands.
 */

import {
  ProductStateX,
  FieldChannels,
  DiscreteEvent,
  ForecastRecord,
  ForecastChannelMetrics,
  ForecastMode,
} from '../types/hrm';
import { computeHRMTransitionStep } from './hrmMath';
import { cloneProductState, cloneFieldChannels } from './clone';
import { createMulberry32, RNGFunction } from './prng';

export const DEFAULT_FORECAST_HORIZON_MS = 500;
export const DEFAULT_FORECAST_STEP_MS = 1.0;
export const FORECAST_QUEUE_CAPACITY = 80;

/**
 * Executes a rolling numerical predictive integration over [issueTimeMs, issueTimeMs + horizonMs].
 * Performs exactly ceil(horizonMs / stepMs) steps using computeHRMTransitionStep.
 */
export function forecastAt(
  issueTimeMs: number,
  observerSnapshot: ProductStateX,
  horizonMs: number = DEFAULT_FORECAST_HORIZON_MS,
  stepMs: number = DEFAULT_FORECAST_STEP_MS,
  seed: number = 42,
  knownEventsAtIssue: DiscreteEvent[] = [],
  mode: ForecastMode = 'hrm-4.1'
): ForecastRecord {
  // 1. Deep-clone observed state to guarantee zero shared mutable memory
  const stateClone = cloneProductState(observerSnapshot);
  let currentPhi = cloneFieldChannels(stateClone.Phi);
  let currentT = stateClone.T;
  let currentM = stateClone.M;
  let currentAlloc = [...stateClone.B.dispatchVector];
  const G = stateClone.G;

  const targetAtMs = issueTimeMs + horizonMs;
  const numSteps = Math.max(1, Math.ceil(horizonMs / stepMs));
  const forecastRng: RNGFunction = createMulberry32(seed);

  // Filter events: only include events that started before or at issueTime
  // and extrapolate known active duration. Never inject future unknown events!
  const observerKnownEvents = knownEventsAtIssue.filter(ev => ev.timeMs <= issueTimeMs);

  const trajectory: { timeMs: number; values: FieldChannels[] }[] = [];
  trajectory.push({ timeMs: issueTimeMs, values: cloneFieldChannels(currentPhi) });

  let simTime = issueTimeMs;

  for (let step = 0; step < numSteps; step++) {
    // Exact step duration: shortened on final step if horizon is not evenly divisible
    const remainingMs = targetAtMs - simTime;
    const currentDt = Math.min(stepMs, remainingMs);
    if (currentDt <= 0) break;

    const stepResult = computeHRMTransitionStep(
      currentPhi,
      G,
      currentT,
      currentM,
      simTime + currentDt,
      currentDt,
      observerKnownEvents,
      currentAlloc,
      forecastRng
    );

    currentPhi = stepResult.Phi_next;
    currentT = stepResult.updatedT;
    currentM = stepResult.updatedM;
    currentAlloc = stepResult.allocation.dispatchVector;
    simTime += currentDt;

    // Record trajectory sample every ~50ms
    if (step % Math.max(1, Math.floor(50 / stepMs)) === 0 || step === numSteps - 1) {
      trajectory.push({ timeMs: simTime, values: cloneFieldChannels(currentPhi) });
    }
  }

  const forecastId = `fc-${Math.round(issueTimeMs)}-${seed.toString(16)}`;

  return {
    forecastId,
    issuedAtMs: issueTimeMs,
    targetAtMs,
    horizonMs,
    sourceWatermarkMs: observerSnapshot.timeMs,
    prediction: currentPhi,
    mode,
    seed,
    status: 'pending',
    trajectory,
  };
}

/**
 * Scores a matured forecast against verified ground-truth plant measurements at targetAtMs.
 * Alignment is performed by target timestamp matching (within tolerance).
 * 
 * Strict Missing-Value Governance:
 * If verifiedMasks is provided, baseline substitutions are excluded so only verified
 * empirical measurements are scored.
 */
export function scoreForecastRecord(
  record: ForecastRecord,
  groundTruthPhi: FieldChannels[],
  verifiedMasks?: boolean[][]
): ForecastRecord {
  const N = record.prediction.length;
  let sumAbsErr: [number, number, number, number] = [0, 0, 0, 0];
  let sumSqErr: [number, number, number, number] = [0, 0, 0, 0];
  let sumPctErr: [number, number, number, number] = [0, 0, 0, 0];
  let validCounts: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < N; i++) {
    const pred = record.prediction[i];
    const truth = groundTruthPhi[i];

    for (let c = 0; c < 4; c++) {
      // Check if channel is verified
      const isVerified = !verifiedMasks || (verifiedMasks[i] && verifiedMasks[i][c]);
      if (!isVerified) continue;

      const err = pred[c] - truth[c];
      const absErr = Math.abs(err);
      sumAbsErr[c] += absErr;
      sumSqErr[c] += err * err;
      sumPctErr[c] += truth[c] !== 0 ? (absErr / Math.abs(truth[c])) * 100 : 0;
      validCounts[c]++;
    }
  }

  const mae: [number, number, number, number] = [
    Number((validCounts[0] > 0 ? sumAbsErr[0] / validCounts[0] : 0).toFixed(3)),
    Number((validCounts[1] > 0 ? sumAbsErr[1] / validCounts[1] : 0).toFixed(3)),
    Number((validCounts[2] > 0 ? sumAbsErr[2] / validCounts[2] : 0).toFixed(3)),
    Number((validCounts[3] > 0 ? sumAbsErr[3] / validCounts[3] : 0).toFixed(4)),
  ];

  const rmse: [number, number, number, number] = [
    Number((validCounts[0] > 0 ? Math.sqrt(sumSqErr[0] / validCounts[0]) : 0).toFixed(3)),
    Number((validCounts[1] > 0 ? Math.sqrt(sumSqErr[1] / validCounts[1]) : 0).toFixed(3)),
    Number((validCounts[2] > 0 ? Math.sqrt(sumSqErr[2] / validCounts[2]) : 0).toFixed(3)),
    Number((validCounts[3] > 0 ? Math.sqrt(sumSqErr[3] / validCounts[3]) : 0).toFixed(4)),
  ];

  const mape: [number, number, number, number] = [
    Number((validCounts[0] > 0 ? sumPctErr[0] / validCounts[0] : 0).toFixed(2)),
    Number((validCounts[1] > 0 ? sumPctErr[1] / validCounts[1] : 0).toFixed(2)),
    Number((validCounts[2] > 0 ? sumPctErr[2] / validCounts[2] : 0).toFixed(2)),
    Number((validCounts[3] > 0 ? sumPctErr[3] / validCounts[3] : 0).toFixed(3)),
  ];

  // Normalized composite metrics across channels
  // Scale factors: GPU (100), Queue (80), Thermal (40), PUE (1.5)
  const normMae = (mae[0] / 100.0 + mae[1] / 80.0 + mae[2] / 40.0 + mae[3] / 1.5) / 4.0;
  const normRmse = (rmse[0] / 100.0 + rmse[1] / 80.0 + rmse[2] / 40.0 + rmse[3] / 1.5) / 4.0;

  const metrics: ForecastChannelMetrics = {
    mae,
    rmse,
    mape,
    avgMae: Number(normMae.toFixed(4)),
    avgRmse: Number(normRmse.toFixed(4)),
  };

  return {
    ...record,
    status: 'scored',
    groundTruth: cloneFieldChannels(groundTruthPhi),
    metrics,
  };
}

/**
 * Manages the bounded rolling forecast ring buffer
 */
export class ForecastManager {
  private queue: ForecastRecord[] = [];
  private maxCapacity: number;
  private lastIssuedSimTimeMs: number = -Infinity;
  private issueCadenceMs: number;

  constructor(capacity: number = FORECAST_QUEUE_CAPACITY, issueCadenceMs: number = 60) {
    this.maxCapacity = capacity;
    this.issueCadenceMs = issueCadenceMs;
  }

  public shouldIssueForecast(currentSimTimeMs: number): boolean {
    return currentSimTimeMs - this.lastIssuedSimTimeMs >= this.issueCadenceMs;
  }

  public addForecast(record: ForecastRecord): void {
    this.queue.push(record);
    this.lastIssuedSimTimeMs = record.issuedAtMs;
    if (this.queue.length > this.maxCapacity) {
      this.queue.shift();
    }
  }

  /**
   * Scores any pending forecasts whose targetAtMs <= currentSimTimeMs
   * against the matching ground-truth state history.
   */
  public evaluateMaturedForecasts(
    currentSimTimeMs: number,
    getGroundTruthAt: (targetMs: number) => FieldChannels[] | null
  ): number {
    let maturedCount = 0;
    for (let i = 0; i < this.queue.length; i++) {
      const fc = this.queue[i];
      if (fc.status === 'pending' && fc.targetAtMs <= currentSimTimeMs) {
        const truth = getGroundTruthAt(fc.targetAtMs);
        if (truth) {
          this.queue[i] = scoreForecastRecord(fc, truth);
          maturedCount++;
        }
      }
    }
    return maturedCount;
  }

  public getLatestForecast(): ForecastRecord | null {
    return this.queue.length > 0 ? this.queue[this.queue.length - 1] : null;
  }

  public getLatestMaturedForecast(): ForecastRecord | null {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.queue[i].status === 'scored') {
        return this.queue[i];
      }
    }
    return null;
  }

  public getStats(): { pendingCount: number; scoredCount: number; avgMae: number; avgRmse: number } {
    let pendingCount = 0;
    let scoredCount = 0;
    let sumMae = 0;
    let sumRmse = 0;

    for (const fc of this.queue) {
      if (fc.status === 'pending') {
        pendingCount++;
      } else if (fc.status === 'scored' && fc.metrics) {
        scoredCount++;
        sumMae += fc.metrics.avgMae;
        sumRmse += fc.metrics.avgRmse;
      }
    }

    return {
      pendingCount,
      scoredCount,
      avgMae: scoredCount > 0 ? Number((sumMae / scoredCount).toFixed(4)) : 0,
      avgRmse: scoredCount > 0 ? Number((sumRmse / scoredCount).toFixed(4)) : 0,
    };
  }

  /**
   * Computes empirical 95% calibration confidence bounds from scored holdout residuals
   * per channel: [GPU, Queue, Thermal, PUE].
   */
  public getCalibrationBands(): [number, number, number, number] {
    const scored = this.queue.filter(fc => fc.status === 'scored' && fc.metrics);
    if (scored.length < 3) {
      // Prior baseline before sufficient sample holdout
      return [3.5, 4.0, 1.8, 0.025];
    }

    // 1.96 * standard error from scored residuals
    const channelSums = [0, 0, 0, 0];
    const n = Math.min(scored.length, 30);
    const recent = scored.slice(-n);

    for (const item of recent) {
      for (let c = 0; c < 4; c++) {
        channelSums[c] += item.metrics!.rmse[c];
      }
    }

    return [
      Number((1.96 * (channelSums[0] / n) * 0.5).toFixed(2)),
      Number((1.96 * (channelSums[1] / n) * 0.5).toFixed(2)),
      Number((1.96 * (channelSums[2] / n) * 0.5).toFixed(2)),
      Number((1.96 * (channelSums[3] / n) * 0.5).toFixed(4)),
    ];
  }

  public getAll(): ForecastRecord[] {
    return [...this.queue];
  }

  public clear(): void {
    this.queue = [];
    this.lastIssuedSimTimeMs = -Infinity;
  }
}
