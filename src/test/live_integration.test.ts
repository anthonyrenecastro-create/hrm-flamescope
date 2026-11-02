import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import {
  initializeDualWorldmodel,
  stepDualWorldmodel,
  ingestLiveTelemetryObservations,
} from '../engine/dualWorldmodel';
import { reconstructObserverState, createObserverSnapshot } from '../engine/observer';
import { forecastAt, scoreForecastRecord } from '../engine/forecast';
import { parsePrometheusMetrics, parseOTLPMetrics, validateChannelValue } from '../engine/telemetryAdapter';
import { NodeObservation, FieldChannels, ForecastRecord } from '../types/hrm';

describe('HRM 4.1 Live Telemetry Integration & Correctness Hardening', () => {
  const G = buildInitialCarrierComplex();
  const nodes = G.nodes;

  it('1. STRICT EXECUTION MODES: LIVE mode completely disables simulated plant packet generation', () => {
    let state = initializeDualWorldmodel(42);
    // Switch to LIVE mode and clear simulated pre-population
    state.telemetryConfig.executionMode = 'LIVE';
    state.telemetryConfig.sourceMode = 'prometheus';
    state.modelA.H.receivedHistory.clear();

    // Advance 100ms in LIVE mode without external telemetry
    for (let i = 0; i < 100; i++) {
      state = stepDualWorldmodel(state, 1.0, 1);
    }

    // Since simulated packet generation is disabled in LIVE mode, inflight packets must be 0
    expect(state.modelA.H.inflightPackets.length).toBe(0);

    // Observer has received 0 plant packets and must fall back strictly to nominal priors
    const observer = reconstructObserverState(state.modelA.G, state.modelA.H, state.timeMs);
    expect(observer.coverageRate).toBe(0);
    expect(observer.isEstimated.every(e => e === true)).toBe(true);
    expect(observer.provenancePerNode?.every(p => p === 'prior')).toBe(true);

    // Now ingest genuine live observations into LIVE mode
    const liveObs: NodeObservation[] = [
      {
        nodeId: 'ashburn',
        timestampMs: state.timeMs,
        receivedAtMs: state.timeMs,
        channels: { gpuUtil: 78.5, queueLatencyMs: 32.0, thermalHeadroomC: 22.0, pue: 1.15 },
        missingChannels: [],
        quality: 'good',
        isRealWorld: true,
      },
    ];

    const stateWithLive = ingestLiveTelemetryObservations(state, liveObs);
    const observerWithLive = reconstructObserverState(stateWithLive.modelA.G, stateWithLive.modelA.H, stateWithLive.timeMs);

    // Ashburn must now reflect real-world telemetry with live provenance
    const ashburnIdx = G.nodes.findIndex(n => n.id === 'ashburn');
    expect(observerWithLive.reconstructedPhi[ashburnIdx][0]).toBe(78.5);
    expect(observerWithLive.isEstimated[ashburnIdx]).toBe(false);
    expect(observerWithLive.provenancePerNode?.[ashburnIdx]).toBe('live');
    expect(observerWithLive.coverageRate).toBeGreaterThan(0);
  });

  it('2. STRICT EXECUTION MODES: HYBRID mode fuses live and simulated telemetry with explicit provenance', () => {
    let state = initializeDualWorldmodel(77);
    state.telemetryConfig.executionMode = 'HYBRID';

    // Step 60ms to let simulated packets propagate
    for (let i = 0; i < 60; i++) {
      state = stepDualWorldmodel(state, 1.0, 1);
    }

    // Ingest live observation for Frankfurt
    const frankfurtIdx = G.nodes.findIndex(n => n.id === 'frankfurt');
    const liveObs: NodeObservation[] = [
      {
        nodeId: 'frankfurt',
        timestampMs: state.timeMs,
        receivedAtMs: state.timeMs,
        channels: { gpuUtil: 91.2, queueLatencyMs: 44.0 },
        missingChannels: ['thermalHeadroomC', 'pue'],
        quality: 'good',
        isRealWorld: true,
      },
    ];

    state = ingestLiveTelemetryObservations(state, liveObs);
    const observer = reconstructObserverState(state.modelA.G, state.modelA.H, state.timeMs);

    // Frankfurt should prioritize live observation
    expect(observer.reconstructedPhi[frankfurtIdx][0]).toBe(91.2);
    expect(observer.provenancePerNode?.[frankfurtIdx]).toBe('live');

    // Other nodes should have simulated provenance
    const ashburnIdx = G.nodes.findIndex(n => n.id === 'ashburn');
    expect(observer.provenancePerNode?.[ashburnIdx]).toBe('simulated');
  });

  it('3. CAUSAL OBSERVATION BOUNDARY: No packet with future delivery timestamp may influence forecasts', () => {
    const horizon = {
      inflightPackets: [],
      observerLocationId: 'ashburn',
      receivedHistory: new Map<string, any[]>(),
    };

    const currentTimeMs = 100;
    const futureDeliverAtMs = 150; // In the future!

    // Insert packet delivered at t = 150ms with an extreme value
    horizon.receivedHistory.set('tokyo', [
      {
        nodeId: 'tokyo',
        timestamp: currentTimeMs,
        sentAt: currentTimeMs,
        deliverAt: futureDeliverAtMs,
        fields: [99.9, 90.0, 5.0, 1.8],
        provenance: 'simulated',
        measuredMask: [true, true, true, true],
        missingMask: [false, false, false, false],
      },
    ]);

    // Observer at currentTimeMs = 100ms
    const observer = reconstructObserverState(G, horizon as any, currentTimeMs);
    const tokyoIdx = G.nodes.findIndex(n => n.id === 'tokyo');

    // Tokyo must NOT show 99.9% GPU util! It must fall back to prior because packet has not delivered yet!
    expect(observer.reconstructedPhi[tokyoIdx][0]).not.toBe(99.9);
    expect(observer.reconstructedPhi[tokyoIdx][0]).toBe(G.nodes[tokyoIdx].baselineGpuUtil ?? 55.0);
    expect(observer.isEstimated[tokyoIdx]).toBe(true);
    expect(observer.provenancePerNode?.[tokyoIdx]).toBe('prior');

    // Once currentTimeMs advances past futureDeliverAtMs (e.g. 160ms), it becomes accessible
    const observerLater = reconstructObserverState(G, horizon as any, 160);
    expect(observerLater.reconstructedPhi[tokyoIdx][0]).toBe(99.9);
    expect(observerLater.isEstimated[tokyoIdx]).toBe(false);
  });

  it('4. WALL-CLOCK TIMESTAMP DOMAIN: Live telemetry does NOT apply artificial fiber propagation delay twice', () => {
    let state = initializeDualWorldmodel(101);
    const nowMs = 1000;
    state.timeMs = nowMs;

    const liveObs: NodeObservation[] = [
      {
        nodeId: 'singapore', // Singapore has ~107ms simulated fiber propagation delay to Ashburn
        timestampMs: 980,
        receivedAtMs: nowMs,
        channels: { gpuUtil: 62.0 },
        missingChannels: ['queueLatencyMs', 'thermalHeadroomC', 'pue'],
        quality: 'good',
        isRealWorld: true,
      },
    ];

    const updated = ingestLiveTelemetryObservations(state, liveObs);
    const singaporeHistory = updated.modelA.H.receivedHistory.get('singapore');
    expect(singaporeHistory).toBeDefined();
    const packet = singaporeHistory![singaporeHistory!.length - 1];

    // deliverAt must be nowMs (immediate wall-clock ingestion), NOT nowMs + 107ms fiber delay!
    expect(packet.deliverAt).toBe(nowMs);
    expect(packet.deliverAt).toBeLessThan(nowMs + 5.0);
  });

  it('5. MISSING-VALUE MASKS: Baseline substitutions are masked out during empirical scoring', () => {
    const dummyRecord: ForecastRecord = {
      forecastId: 'fc-test-1',
      issuedAtMs: 100,
      targetAtMs: 600,
      horizonMs: 500,
      sourceWatermarkMs: 100,
      prediction: [
        [80.0, 25.0, 28.0, 1.2],
        [70.0, 20.0, 30.0, 1.1],
      ],
      mode: 'hrm-4.1',
      seed: 42,
      status: 'pending',
    };

    const groundTruth: FieldChannels[] = [
      [82.0, 25.0, 28.0, 1.2],
      [75.0, 20.0, 30.0, 1.1],
    ];

    // Node 0 has only channel 0 (GPU) verified; channels 1, 2, 3 were substituted baselines
    // Node 1 has all channels unverified
    const verifiedMasks: boolean[][] = [
      [true, false, false, false],
      [false, false, false, false],
    ];

    const scored = scoreForecastRecord(dummyRecord, groundTruth, verifiedMasks);

    // Channel 0 MAE was evaluated solely on verified measurement (|80 - 82| = 2.0)
    expect(scored.metrics?.mae[0]).toBe(2.0);
    // Unverified channels must have 0 error / not penalize score
    expect(scored.metrics?.mae[1]).toBe(0);
    expect(scored.metrics?.mae[2]).toBe(0);
    expect(scored.metrics?.mae[3]).toBe(0);
  });

  it('6. TELEMETRY VALIDATION: Malformed, non-finite, and out-of-bound inputs are strictly rejected', () => {
    expect(validateChannelValue('gpuUtil', NaN).valid).toBe(false);
    expect(validateChannelValue('gpuUtil', -1).valid).toBe(false);
    expect(validateChannelValue('gpuUtil', 101).valid).toBe(false);
    expect(validateChannelValue('queueLatencyMs', Infinity).valid).toBe(false);
    expect(validateChannelValue('queueLatencyMs', -0.5).valid).toBe(false);
    expect(validateChannelValue('pue', 0.9).valid).toBe(false); // below physical 1.0
    expect(validateChannelValue('thermalHeadroomC', -25).valid).toBe(false);
  });
});
