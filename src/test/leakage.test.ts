import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import { initializeDualWorldmodel, stepDualWorldmodel } from '../engine/dualWorldmodel';
import { reconstructObserverState, createObserverSnapshot } from '../engine/observer';
import { forecastAt } from '../engine/forecast';
import { cloneFieldChannels, cloneProductState } from '../engine/clone';
import { FieldChannels } from '../types/hrm';

describe('Information Leakage Verification & Boundary Hardening', () => {
  it('proves changing hidden plant Phi states cannot alter an issued forecast', () => {
    // 1. Initialize worldmodel at t = 0
    let state = initializeDualWorldmodel(42);

    // 2. Advance for 60ms to populate initial packet transmissions
    for (let i = 0; i < 60; i++) {
      state = stepDualWorldmodel(state, 1.0, 1);
    }

    const issueTimeMs = state.timeMs;
    const G = state.modelA.G;
    const tokyoIdx = G.nodes.findIndex(n => n.id === 'tokyo');

    // 3. Reconstruct observer state solely from arrived packets
    const observerState = reconstructObserverState(G, state.modelA.H, issueTimeMs);
    const snapshot1 = createObserverSnapshot(G, observerState, issueTimeMs);

    // 4. Issue forecast under original conditions
    const forecastOriginal = forecastAt(issueTimeMs, snapshot1, 500, 1.0, 777);

    // 5. Create counterfactual scenario: secretly tamper with hidden physical plant state
    // (e.g., set Tokyo GPU to 99% and thermal headroom to 1°C in plant modelA.Phi)
    const tamperedModelA = cloneProductState(state.modelA);
    tamperedModelA.Phi[tokyoIdx][0] = 99.9;
    tamperedModelA.Phi[tokyoIdx][2] = 1.0;

    // Secretly mutate plant's internal metric tensor and transport state
    tamperedModelA.M.curvature[tokyoIdx] = 55.0;
    tamperedModelA.T.phantomEnergyResidual = 42.0;

    // 6. Reconstruct observer and issue forecast again
    // Observer must reconstruct ONLY from arrived packets in H, without querying tamperedModelA
    const observerStateAfterPlantTamper = reconstructObserverState(G, tamperedModelA.H, issueTimeMs);
    const snapshot2 = createObserverSnapshot(G, observerStateAfterPlantTamper, issueTimeMs);
    const forecastAfterTamper = forecastAt(issueTimeMs, snapshot2, 500, 1.0, 777);

    // 7. ASSERT STRICT EQUALITY: Forecasts must be identical!
    expect(forecastAfterTamper.prediction).toEqual(forecastOriginal.prediction);
    expect(forecastAfterTamper.prediction[tokyoIdx]).toEqual(forecastOriginal.prediction[tokyoIdx]);
  });

  it('proves unannounced physical plant topology mutations cannot leak into forecaster', () => {
    let state = initializeDualWorldmodel(101);

    // Advance 50ms
    for (let i = 0; i < 50; i++) {
      state = stepDualWorldmodel(state, 1.0, 1);
    }

    const issueTimeMs = state.timeMs;
    const G_nominal = state.modelA.G;

    const observer = reconstructObserverState(G_nominal, state.modelA.H, issueTimeMs);
    const snapshotBase = createObserverSnapshot(G_nominal, observer, issueTimeMs);
    const forecastBase = forecastAt(issueTimeMs, snapshotBase, 500, 1.0, 999);

    // Secretly sever link in physical plant without emitting telemetry packet
    const severedG = { ...G_nominal };
    severedG.links = G_nominal.links.map(l => ({ ...l, isSevered: true, health: 0 }));

    // Observer snapshot must use nominal known topology
    const snapshotGuarded = createObserverSnapshot(G_nominal, observer, issueTimeMs);
    const forecastGuarded = forecastAt(issueTimeMs, snapshotGuarded, 500, 1.0, 999);

    expect(forecastGuarded.prediction).toEqual(forecastBase.prediction);
  });

  it('proves missing packets fall back to explicit priors rather than plant truth', () => {
    const G = buildInitialCarrierComplex();
    const emptyHorizon = {
      inflightPackets: [],
      observerLocationId: 'ashburn',
      receivedHistory: new Map(),
    };

    // Observer has received ZERO packets for any node
    const observer = reconstructObserverState(G, emptyHorizon, 50);

    expect(observer.coverageRate).toBe(0);
    expect(observer.packetLossCount).toBe(G.nodes.length);
    expect(observer.isEstimated.every(e => e === true)).toBe(true);

    // Node values must match explicit nominal datacenter priors
    for (let i = 0; i < G.nodes.length; i++) {
      const node = G.nodes[i];
      expect(observer.reconstructedPhi[i][0]).toBe(node.baselineGpuUtil ?? 55.0);
      expect(observer.reconstructedPhi[i][1]).toBe(node.baselineQueueLatency ?? 18.0);
      expect(observer.reconstructedPhi[i][2]).toBe(node.baselineThermalHeadroom ?? 30.0);
      expect(observer.reconstructedPhi[i][3]).toBe(node.pueBaseline);
    }
  });
});
