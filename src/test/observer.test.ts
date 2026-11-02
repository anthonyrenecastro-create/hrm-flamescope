import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import { ingestArrivedPackets, reconstructObserverState } from '../engine/observer';
import { TelemetryHorizonH, TelemetryPacket } from '../types/hrm';

describe('Independent Observer-State Reconstructor', () => {
  it('delivers packets strictly when deliverAt <= currentSimTime', () => {
    const horizon: TelemetryHorizonH = {
      inflightPackets: [
        {
          nodeId: 'frankfurt',
          timestamp: 0,
          sentAt: 0,
          deliverAt: 30, // 30ms fiber delay
          fields: [60, 20, 30, 1.2],
        },
        {
          nodeId: 'tokyo',
          timestamp: 0,
          sentAt: 0,
          deliverAt: 55, // 55ms fiber delay
          fields: [70, 25, 28, 1.25],
        },
      ],
      observerLocationId: 'ashburn',
      receivedHistory: new Map(),
    };

    // At t = 20ms: no packets delivered yet
    const step1 = ingestArrivedPackets(horizon, 20);
    expect(step1.arrivedPackets.length).toBe(0);
    expect(step1.newInflight.length).toBe(2);

    // At t = 40ms: frankfurt arrives, tokyo still inflight
    const step2 = ingestArrivedPackets(step1.updatedHorizon, 40);
    expect(step2.arrivedPackets.length).toBe(1);
    expect(step2.arrivedPackets[0].nodeId).toBe('frankfurt');
    expect(step2.newInflight.length).toBe(1);
    expect(step2.updatedHorizon.receivedHistory.get('frankfurt')?.length).toBe(1);

    // At t = 60ms: tokyo arrives
    const step3 = ingestArrivedPackets(step2.updatedHorizon, 60);
    expect(step3.arrivedPackets.length).toBe(1);
    expect(step3.arrivedPackets[0].nodeId).toBe('tokyo');
    expect(step3.newInflight.length).toBe(0);
  });

  it('reconstructs observer state solely from arrived history with staleness tracking', () => {
    const G = buildInitialCarrierComplex();
    const horizon: TelemetryHorizonH = {
      inflightPackets: [],
      observerLocationId: 'ashburn',
      receivedHistory: new Map(),
    };

    // Ashburn receives fresh packet at t = 100ms
    horizon.receivedHistory.set('ashburn', [
      {
        nodeId: 'ashburn',
        timestamp: 100,
        sentAt: 100,
        deliverAt: 100,
        fields: [55.0, 18.0, 32.0, 1.2],
      },
    ]);

    // Frankfurt received packet was from t = 70ms
    horizon.receivedHistory.set('frankfurt', [
      {
        nodeId: 'frankfurt',
        timestamp: 70,
        sentAt: 70,
        deliverAt: 100,
        fields: [62.0, 22.0, 29.0, 1.22],
      },
    ]);

    const observer = reconstructObserverState(G, horizon, 100, []);

    const ashburnIdx = G.nodes.findIndex(n => n.id === 'ashburn');
    const frankfurtIdx = G.nodes.findIndex(n => n.id === 'frankfurt');

    expect(observer.reconstructedPhi[ashburnIdx][0]).toBe(55.0);
    expect(observer.stalenessMs[ashburnIdx]).toBe(0);

    expect(observer.reconstructedPhi[frankfurtIdx][0]).toBe(62.0);
    expect(observer.stalenessMs[frankfurtIdx]).toBe(30); // 100 - 70 = 30ms staleness
  });
});
