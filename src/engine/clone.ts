/**
 * Deep-Cloning Utilities for HRM 4.1 State Invariance
 * Ensures zero shared mutable state between physical plant simulation,
 * delayed observer state reconstruction, and forward numerical forecasters.
 */

import {
  ProductStateX,
  FieldChannels,
  CarrierComplexG,
  TransportOperatorStateT,
  MetricTensorM,
  AttributionLedgerC,
  TelemetryHorizonH,
  ResourceAllocationB,
  TelemetryPacket,
} from '../types/hrm';

export function cloneFieldChannels(phi: FieldChannels[]): FieldChannels[] {
  return phi.map(c => [c[0], c[1], c[2], c[3]]);
}

export function cloneMatrix(mat: number[][]): number[][] {
  return mat.map(row => [...row]);
}

export function cloneCarrierComplex(g: CarrierComplexG): CarrierComplexG {
  return {
    nodes: g.nodes.map(n => ({ ...n })),
    links: g.links.map(l => ({ ...l })),
    adjacency: cloneMatrix(g.adjacency),
    laplacian: cloneMatrix(g.laplacian),
    distanceMatrix: cloneMatrix(g.distanceMatrix),
    propagationLatency: cloneMatrix(g.propagationLatency),
  };
}

export function cloneTransportState(t: TransportOperatorStateT): TransportOperatorStateT {
  return {
    lastTopologyMutationTime: t.lastTopologyMutationTime,
    activeSeveredLinks: [...t.activeSeveredLinks],
    divertedTrafficRatio: t.divertedTrafficRatio,
    phantomEnergyResidual: t.phantomEnergyResidual,
  };
}

export function cloneMetricTensor(m: MetricTensorM): MetricTensorM {
  return {
    curvature: [...m.curvature],
    helicalPhase: [...m.helicalPhase],
    radiusZ: [...m.radiusZ],
  };
}

export function cloneLedger(c: AttributionLedgerC): AttributionLedgerC {
  return {
    step: c.step,
    timestampMs: c.timestampMs,
    A_0: [...c.A_0],
    A_react: [...c.A_react],
    A_diff: [...c.A_diff],
    A_xi: [...c.A_xi],
    A_event: [...c.A_event],
    A_corr: [...c.A_corr],
    epsilon: [...c.epsilon],
    totalDelta: [...c.totalDelta],
    residualRatio: c.residualRatio,
    invariantPreserved: c.invariantPreserved,
  };
}

export function cloneTelemetryPacket(p: TelemetryPacket): TelemetryPacket {
  return {
    nodeId: p.nodeId,
    timestamp: p.timestamp,
    sentAt: p.sentAt,
    deliverAt: p.deliverAt,
    fields: [p.fields[0], p.fields[1], p.fields[2], p.fields[3]],
  };
}

export function cloneTelemetryHorizon(h: TelemetryHorizonH): TelemetryHorizonH {
  const clonedHistory = new Map<string, TelemetryPacket[]>();
  h.receivedHistory.forEach((packets, nodeId) => {
    clonedHistory.set(nodeId, packets.map(cloneTelemetryPacket));
  });

  return {
    inflightPackets: h.inflightPackets.map(cloneTelemetryPacket),
    observerLocationId: h.observerLocationId,
    receivedHistory: clonedHistory,
  };
}

export function cloneResourceAllocation(b: ResourceAllocationB): ResourceAllocationB {
  return {
    dispatchVector: [...b.dispatchVector],
    utilityScores: [...b.utilityScores],
    switchingPenalty: b.switchingPenalty,
    totalBudgetCost: b.totalBudgetCost,
    carbonIntensity: [...b.carbonIntensity],
  };
}

export function cloneProductState(state: ProductStateX): ProductStateX {
  return {
    timeMs: state.timeMs,
    Phi: cloneFieldChannels(state.Phi),
    G: cloneCarrierComplex(state.G),
    T: cloneTransportState(state.T),
    M: cloneMetricTensor(state.M),
    C: cloneLedger(state.C),
    H: cloneTelemetryHorizon(state.H),
    B: cloneResourceAllocation(state.B),
  };
}
