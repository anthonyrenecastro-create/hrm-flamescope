import { describe, it, expect } from 'vitest';
import {
  runDeterministicBenchmark,
  generateNonHrmSyntheticTrace,
  runOutOfSampleTelemetryBenchmark,
} from '../engine/benchmarks';
import { FieldChannels } from '../types/hrm';

describe('HRM 4.1 Deterministic Benchmark Suite', () => {
  it('executes reproducible simulation benchmark with explicit seed and incident metrics', () => {
    const report = runDeterministicBenchmark({
      scenarioName: 'Test Benchmark',
      seed: 42,
      numTrials: 5,
      horizonMs: 500,
      stepMs: 1.0,
      benchmarkType: 'simulated_hrm',
    });

    expect(report.seed).toBe(42);
    expect(report.numTrials).toBe(5);
    expect(report.horizonMs).toBe(500);
    expect(report.isRealWorldVerified).toBe(false);
    expect(report.datasetType).toBe('simulated_hrm');

    // Metrics verification
    expect(report.hrm41.avgMae).toBeGreaterThan(0);
    expect(report.hrm41.avgRmse).toBeGreaterThan(0);
    expect(report.hrm41.invariantPreservedRate).toBeGreaterThanOrEqual(99.0);

    // Baseline comparisons
    expect(report.baselines.persistence.avgMae).toBeGreaterThan(0);
    expect(report.baselines.linearExtrap.avgMae).toBeGreaterThan(0);
    expect(report.baselines.diffusionOnly.avgMae).toBeGreaterThan(0);

    // Incident metrics
    expect(report.hrm41.incidentMetrics).toBeDefined();
    expect(report.hrm41.incidentMetrics!.leadTimeMs).toBe(500);
    expect(report.hrm41.incidentMetrics!.precision).toBeGreaterThanOrEqual(0);
    expect(report.hrm41.incidentMetrics!.recall).toBeGreaterThanOrEqual(0);

    // Runtime is measured
    expect(report.hrm41.runtimeMs).toBeGreaterThan(0);
  });

  it('generates independent non-HRM synthetic traces with coupled jump-diffusion', () => {
    const { timestamps, trace } = generateNonHrmSyntheticTrace(20, 10, 101);

    expect(timestamps.length).toBe(20);
    expect(trace.length).toBe(20);

    // Each sample contains 14 planetary nodes with 4 channels
    expect(trace[0].length).toBe(14);
    expect(trace[0][0].length).toBe(4);

    // Values are physically bounded
    for (const sample of trace) {
      for (const nodeChannels of sample) {
        expect(nodeChannels[0]).toBeGreaterThanOrEqual(5.0);
        expect(nodeChannels[0]).toBeLessThanOrEqual(98.0);
        expect(nodeChannels[1]).toBeGreaterThanOrEqual(2.0);
        expect(nodeChannels[2]).toBeGreaterThanOrEqual(2.0);
        expect(nodeChannels[3]).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it('runs deterministic benchmark on synthetic non-HRM generator', () => {
    const report = runDeterministicBenchmark({
      seed: 77,
      numTrials: 5,
      horizonMs: 500,
      benchmarkType: 'synthetic_stochastic',
    });

    expect(report.datasetType).toBe('synthetic_stochastic');
    expect(report.isRealWorldVerified).toBe(false);
    expect(report.hrm41.avgMae).toBeGreaterThan(0);
    expect(report.baselines.persistence.avgMae).toBeGreaterThan(0);
  });

  it('runs out-of-sample empirical benchmark on timestamped telemetry traces', () => {
    const mockTelemetryTrace: { timestampMs: number; phi: FieldChannels[] }[] = [];
    const baseTime = 1700000000000;

    for (let i = 0; i < 15; i++) {
      mockTelemetryTrace.push({
        timestampMs: baseTime + i * 250, // 250ms spacing
        phi: [
          [60.0 + Math.sin(i) * 5, 20.0, 30.0, 1.2],
          [55.0, 18.0, 32.0, 1.15],
          [70.0, 25.0, 28.0, 1.25],
          [58.0, 22.0, 29.0, 1.18],
          [75.0, 30.0, 26.0, 1.28],
          [50.0, 15.0, 35.0, 1.12],
        ],
      });
    }

    const report = runOutOfSampleTelemetryBenchmark(mockTelemetryTrace, {
      seed: 42,
      horizonMs: 500,
    });

    expect(report.datasetType).toBe('real_telemetry_heldout');
    expect(report.isRealWorldVerified).toBe(true);
    expect(report.hrm41.avgMae).toBeGreaterThan(0);
    expect(report.baselines.persistence.avgMae).toBeGreaterThan(0);
  });
});
