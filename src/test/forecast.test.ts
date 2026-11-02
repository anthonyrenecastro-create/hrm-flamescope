import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import { initializeFieldChannels, initializeMetricTensor } from '../engine/hrmMath';
import { forecastAt, scoreForecastRecord, ForecastManager } from '../engine/forecast';
import { cloneFieldChannels } from '../engine/clone';
import { ProductStateX } from '../types/hrm';

describe('HRM 4.1 Rolling 500ms Forward Predictive Integrator', () => {
  function createTestSnapshot(simTimeMs: number): ProductStateX {
    const G = buildInitialCarrierComplex();
    const N = G.nodes.length;
    const basePue = G.nodes.map(n => n.pueBaseline);
    const Phi = initializeFieldChannels(N, basePue);

    return {
      timeMs: simTimeMs,
      Phi,
      G,
      T: {
        lastTopologyMutationTime: 0,
        activeSeveredLinks: [],
        divertedTrafficRatio: 0,
        phantomEnergyResidual: 0,
      },
      M: initializeMetricTensor(N),
      C: {
        step: 0,
        timestampMs: simTimeMs,
        A_0: [0, 0, 0, 0],
        A_react: [0, 0, 0, 0],
        A_diff: [0, 0, 0, 0],
        A_xi: [0, 0, 0, 0],
        A_event: [0, 0, 0, 0],
        A_corr: [0, 0, 0, 0],
        epsilon: [0, 0, 0, 0],
        totalDelta: [0, 0, 0, 0],
        residualRatio: 0,
        invariantPreserved: true,
      },
      H: {
        inflightPackets: [],
        observerLocationId: 'ashburn',
        receivedHistory: new Map(),
      },
      B: {
        dispatchVector: Array(N).fill(1.0 / N),
        utilityScores: Array(N).fill(0.5),
        switchingPenalty: 0,
        totalBudgetCost: 1.0,
        carbonIntensity: Array(N).fill(0.2),
      },
    };
  }

  it('performs exact multi-step numerical integration across the 500ms horizon', () => {
    const snapshot = createTestSnapshot(100);
    const horizonMs = 500;
    const stepMs = 1.0;

    const forecast = forecastAt(100, snapshot, horizonMs, stepMs, 42);

    expect(forecast.issuedAtMs).toBe(100);
    expect(forecast.targetAtMs).toBe(600);
    expect(forecast.status).toBe('pending');
    expect(forecast.prediction.length).toBe(snapshot.Phi.length);
    // Trajectory sampled periodically
    expect(forecast.trajectory?.length).toBeGreaterThan(5);
  });

  it('guarantees state isolation and zero mutation of source snapshot', () => {
    const snapshot = createTestSnapshot(50);
    const originalPhi = cloneFieldChannels(snapshot.Phi);

    const forecast = forecastAt(50, snapshot, 500, 1.0, 99);

    // Ensure snapshot.Phi was not mutated
    expect(snapshot.Phi).toEqual(originalPhi);
    // Forecast prediction should reflect evolved state, not identical to initial
    expect(forecast.prediction).not.toEqual(originalPhi);
  });

  it('scores forecast accurately when target timestamp matures', () => {
    const snapshot = createTestSnapshot(0);
    const forecast = forecastAt(0, snapshot, 500, 1.0, 100);

    const groundTruthPhi = cloneFieldChannels(forecast.prediction);
    // Introduce slight discrepancy to test metric calculation
    groundTruthPhi[0][0] += 2.0;

    const scored = scoreForecastRecord(forecast, groundTruthPhi);

    expect(scored.status).toBe('scored');
    expect(scored.metrics).toBeDefined();
    expect(scored.metrics!.mae[0]).toBeGreaterThan(0);
    expect(scored.metrics!.avgMae).toBeGreaterThan(0);
  });

  it('ForecastManager respects cadence and queues pending records', () => {
    const manager = new ForecastManager(10, 50);
    const snapshot = createTestSnapshot(0);

    expect(manager.shouldIssueForecast(0)).toBe(true);
    const fc = forecastAt(0, snapshot, 500, 1.0, 1);
    manager.addForecast(fc);

    // 20ms later should be throttled
    expect(manager.shouldIssueForecast(20)).toBe(false);
    // 60ms later should trigger
    expect(manager.shouldIssueForecast(60)).toBe(true);
  });
});
