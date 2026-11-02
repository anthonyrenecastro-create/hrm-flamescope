import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import {
  parsePrometheusMetrics,
  parseOTLPMetrics,
  validateChannelValue,
} from '../engine/telemetryAdapter';
import { initializeDualWorldmodel, ingestLiveTelemetryObservations } from '../engine/dualWorldmodel';
import { NodeObservation } from '../types/hrm';

describe('Live Telemetry Ingestion & Missing-Data Governance', () => {
  const G = buildInitialCarrierComplex();
  const nodes = G.nodes;

  it('rejects NaN, Infinity, and out-of-bound values in telemetry validation', () => {
    expect(validateChannelValue('gpuUtil', NaN).valid).toBe(false);
    expect(validateChannelValue('gpuUtil', Infinity).valid).toBe(false);
    expect(validateChannelValue('gpuUtil', -Infinity).valid).toBe(false);
    expect(validateChannelValue('gpuUtil', 150).valid).toBe(false); // > 100%
    expect(validateChannelValue('gpuUtil', 75).valid).toBe(true);

    expect(validateChannelValue('queueLatencyMs', -5).valid).toBe(false);
    expect(validateChannelValue('queueLatencyMs', 45).valid).toBe(true);

    expect(validateChannelValue('thermalHeadroomC', 100).valid).toBe(false);
    expect(validateChannelValue('thermalHeadroomC', 25).valid).toBe(true);

    expect(validateChannelValue('pue', 0.5).valid).toBe(false); // below physical 1.0
    expect(validateChannelValue('pue', 1.2).valid).toBe(true);
  });

  it('parses valid Prometheus payload and preserves missing-channel indicators', () => {
    const prometheusMock = {
      status: 'success',
      data: {
        resultType: 'vector',
        result: [
          // Ashburn has only CPU
          {
            metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'ashburn-dc01' },
            value: [1700000000, '65.5'],
          },
          // Frankfurt has CPU and Latency
          {
            metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'frankfurt-dc01' },
            value: [1700000000, '52.0'],
          },
          {
            metric: { __name__: 'http_request_duration_seconds', instance: 'frankfurt-dc01' },
            value: [1700000000, '0.024'], // 24ms
          },
          // Malformed series with NaN
          {
            metric: { __name__: 'container_cpu_usage_seconds_total', instance: 'tokyo-dc01' },
            value: [1700000000, 'NaN'],
          },
        ],
      },
    };

    const parsed = parsePrometheusMetrics(prometheusMock, nodes, 1700000000000);

    // Ashburn must have gpuUtil, with remaining channels marked missing
    const ashburnObs = parsed.observations.find(o => o.nodeId === 'ashburn');
    expect(ashburnObs).toBeDefined();
    expect(ashburnObs!.channels.gpuUtil).toBe(65.5);
    expect(ashburnObs!.channels.queueLatencyMs).toBeUndefined();
    expect(ashburnObs!.missingChannels).toContain('queueLatencyMs');
    expect(ashburnObs!.missingChannels).toContain('thermalHeadroomC');
    expect(ashburnObs!.missingChannels).toContain('pue');

    // Frankfurt has gpuUtil and queueLatency
    const frankfurtObs = parsed.observations.find(o => o.nodeId === 'frankfurt');
    expect(frankfurtObs).toBeDefined();
    expect(frankfurtObs!.channels.gpuUtil).toBe(52.0);
    expect(frankfurtObs!.channels.queueLatencyMs).toBe(24);

    // Tokyo had NaN, so it must be rejected
    const tokyoObs = parsed.observations.find(o => o.nodeId === 'tokyo');
    expect(tokyoObs).toBeUndefined();
    expect(parsed.rejectedSampleCount).toBeGreaterThan(0);
  });

  it('parses OpenTelemetry OTLP payload without hallucinating unmapped nodes', () => {
    const otlpMock = {
      resourceMetrics: [
        {
          resource: {
            attributes: [{ key: 'service.name', value: { stringValue: 'ashburn-telemetry' } }],
          },
          scopeMetrics: [
            {
              metrics: [
                {
                  name: 'cpu.utilization',
                  gauge: {
                    dataPoints: [{ asDouble: 72.4, timeUnixNano: '1700000000000000000' }],
                  },
                },
              ],
            },
          ],
        },
      ],
    };

    const parsed = parseOTLPMetrics(otlpMock, nodes, 1700000000000);

    expect(parsed.observations.length).toBe(1);
    expect(parsed.observations[0].nodeId).toBe('ashburn');
    expect(parsed.observations[0].channels.gpuUtil).toBe(72.4);

    // Nodes not in the payload must NOT be present
    expect(parsed.observations.find(o => o.nodeId === 'dublin')).toBeUndefined();
    expect(parsed.observations.find(o => o.nodeId === 'tokyo')).toBeUndefined();
  });

  it('ingests live telemetry observations without mutating simulated plant ground-truth', () => {
    let state = initializeDualWorldmodel(42);
    const initialPlantPhi = state.modelA.Phi.map(c => [...c]);

    const liveObservations: NodeObservation[] = [
      {
        nodeId: 'ashburn',
        timestampMs: 100,
        receivedAtMs: 100,
        channels: { gpuUtil: 88.0, queueLatencyMs: 40.0 },
        missingChannels: ['thermalHeadroomC', 'pue'],
        quality: 'good',
        isRealWorld: true,
      },
    ];

    const updated = ingestLiveTelemetryObservations(state, liveObservations);

    // Simulated physical plant Phi MUST NOT be modified
    expect(updated.modelA.Phi).toEqual(initialPlantPhi);

    // Observer's receivedHistory must have the live packet
    const ashburnHistory = updated.modelA.H.receivedHistory.get('ashburn');
    expect(ashburnHistory).toBeDefined();
    expect(ashburnHistory!.length).toBeGreaterThan(0);
    expect(ashburnHistory![ashburnHistory!.length - 1].fields[0]).toBe(88.0);
  });
});
