/**
 * Independent Observer-State Reconstructor for HRM 4.1
 * Reconstructs planetary network state exclusively from arrived telemetry packets
 * delivered to the central observer hub (e.g. Ashburn) respecting speed-of-light horizons.
 * Prevents future physical plant state leakage into the forecaster.
 */

import {
  HubNode,
  CarrierComplexG,
  FieldChannels,
  TelemetryPacket,
  TelemetryHorizonH,
  ProductStateX,
  ObserverState,
  TransportOperatorStateT,
  MetricTensorM,
  ResourceAllocationB,
  AttributionLedgerC,
} from '../types/hrm';
import { cloneCarrierComplex } from './clone';
import { initializeMetricTensor } from './hrmMath';

export const MAX_NODE_HISTORY_PACKETS = 250;

/**
 * Inserts newly arrived packets into the observer's receivedHistory Map.
 * Prunes packets beyond MAX_NODE_HISTORY_PACKETS to preserve memory.
 */
export function ingestArrivedPackets(
  horizon: TelemetryHorizonH,
  currentSimTimeMs: number
): {
  updatedHorizon: TelemetryHorizonH;
  arrivedPackets: TelemetryPacket[];
  newInflight: TelemetryPacket[];
} {
  const arrivedPackets: TelemetryPacket[] = [];
  const newInflight: TelemetryPacket[] = [];

  for (const pkt of horizon.inflightPackets) {
    if (pkt.deliverAt <= currentSimTimeMs) {
      arrivedPackets.push(pkt);
    } else {
      newInflight.push(pkt);
    }
  }

  // Insert arrived packets into history
  const updatedHistory = new Map<string, TelemetryPacket[]>();
  horizon.receivedHistory.forEach((list, nodeId) => {
    updatedHistory.set(nodeId, [...list]);
  });

  for (const pkt of arrivedPackets) {
    const list = updatedHistory.get(pkt.nodeId) || [];
    list.push(pkt);
    if (list.length > MAX_NODE_HISTORY_PACKETS) {
      list.shift();
    }
    updatedHistory.set(pkt.nodeId, list);
  }

  return {
    updatedHorizon: {
      ...horizon,
      inflightPackets: newInflight,
      receivedHistory: updatedHistory,
    },
    arrivedPackets,
    newInflight,
  };
}

/**
 * Reconstructs the observed planetary field state Φ_obs(t)
 * based strictly on the latest received packet per node with deliverAt <= currentSimTimeMs.
 * 
 * ZERO INFORMATION LEAKAGE:
 * - Does NOT access ground truth plant state.
 * - If no recent packet arrived, uses the last known observation from receivedHistory.
 * - If a node has NEVER delivered a packet (e.g. system cold start or severed link),
 *   uses the explicit initialization prior for that datacenter node.
 */
export function reconstructObserverState(
  G: CarrierComplexG,
  horizon: TelemetryHorizonH,
  currentSimTimeMs: number,
  _optionalLegacyFallback?: FieldChannels[]
): ObserverState {
  const N = G.nodes.length;
  const reconstructedPhi: FieldChannels[] = [];
  const stalenessMs: number[] = [];
  const isEstimated: boolean[] = [];
  let minWatermark = currentSimTimeMs;
  let totalReceivedCount = 0;
  let packetLossCount = 0;
  let nodesWithFreshTelemetry = 0;

  const measuredMasks: [boolean, boolean, boolean, boolean][] = [];
  const provenancePerNode: ('simulated' | 'live' | 'hybrid' | 'prior')[] = [];

  for (let i = 0; i < N; i++) {
    const node = G.nodes[i];
    const packets = horizon.receivedHistory.get(node.id) || [];
    totalReceivedCount += packets.length;

    // Filter packets that strictly arrived at or before currentSimTimeMs
    // CAUSAL OBSERVATION BOUNDARY: deliverAt MUST be <= currentSimTimeMs!
    const eligible = packets.filter(p => p.deliverAt <= currentSimTimeMs);

    if (eligible.length > 0) {
      // In hybrid/general scenarios: if a live packet is fresh, prioritize live telemetry
      const liveEligible = eligible.filter(p => p.provenance === 'live');
      const latest = liveEligible.length > 0 ? liveEligible[liveEligible.length - 1] : eligible[eligible.length - 1];

      reconstructedPhi.push([
        latest.fields[0],
        latest.fields[1],
        latest.fields[2],
        latest.fields[3],
      ]);
      const age = Math.max(0, currentSimTimeMs - latest.timestamp);
      stalenessMs.push(age);
      isEstimated.push(false);
      measuredMasks.push(latest.measuredMask || [true, true, true, true]);
      provenancePerNode.push(latest.provenance || 'simulated');
      nodesWithFreshTelemetry++;
      if (latest.timestamp < minWatermark) {
        minWatermark = latest.timestamp;
      }
    } else {
      // STRICT CAUSAL BOUNDARY: No packet has delivered yet by currentSimTimeMs!
      // Future delivery packets CANNOT be accessed. Fall back to explicit initialization prior.
      const priorPhi: FieldChannels = [
        node.baselineGpuUtil ?? 55.0,
        node.baselineQueueLatency ?? 18.0,
        node.baselineThermalHeadroom ?? 30.0,
        node.pueBaseline,
      ];
      reconstructedPhi.push(priorPhi);
      stalenessMs.push(9999);
      isEstimated.push(true);
      measuredMasks.push([false, false, false, false]); // Baseline substitution: not measured!
      provenancePerNode.push('prior');
      packetLossCount++;
      minWatermark = Math.min(minWatermark, 0);
    }
  }

  const coverageRate = N > 0 ? (nodesWithFreshTelemetry / N) * 100 : 0;

  return {
    observerHubId: horizon.observerLocationId,
    watermarkMs: minWatermark,
    reconstructedPhi,
    stalenessMs,
    packetLossCount,
    receivedCount: totalReceivedCount,
    lastUpdatedMs: currentSimTimeMs,
    coverageRate: Number(coverageRate.toFixed(1)),
    isEstimated,
    measuredMasks,
    provenancePerNode,
  };
}

/**
 * Creates an Observer Snapshot ProductStateX
 * used as the pure starting point for forward numerical predictions.
 * 
 * Strict Information Boundary:
 * Does NOT contain future plant state, unannounced plant events,
 * or private plant variables.
 */
export function createObserverSnapshot(
  carrierOrPlant: CarrierComplexG | ProductStateX,
  observerState: ObserverState,
  issueTimeMs: number,
  knownAllocation?: number[]
): ProductStateX {
  const G = 'G' in carrierOrPlant ? carrierOrPlant.G : carrierOrPlant;
  const N = G.nodes.length;

  // Clean observer ledger initialized at issueTimeMs
  const observerLedger: AttributionLedgerC = {
    step: 0,
    timestampMs: issueTimeMs,
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
  };

  // Observer's metric tensor derived from observed fields (independent of plant internal M)
  const observerMetric: MetricTensorM = initializeMetricTensor(N);

  // Observer's transport operator (only tracks known topology)
  const observerTransport: TransportOperatorStateT = {
    lastTopologyMutationTime: issueTimeMs,
    activeSeveredLinks: [],
    divertedTrafficRatio: 0,
    phantomEnergyResidual: 0,
  };

  // Dispatch allocation known to the central observer
  const dispatch = knownAllocation && knownAllocation.length === N
    ? [...knownAllocation]
    : Array(N).fill(1.0 / N);

  const observerAllocation: ResourceAllocationB = {
    dispatchVector: dispatch,
    utilityScores: Array(N).fill(0.5),
    switchingPenalty: 0,
    totalBudgetCost: 1.0,
    carbonIntensity: G.nodes.map(n => n.carbonIntensityGPerKwh ?? 220.0),
  };

  return {
    timeMs: issueTimeMs,
    Phi: observerState.reconstructedPhi.map(c => [c[0], c[1], c[2], c[3]]),
    G: cloneCarrierComplex(G),
    T: observerTransport,
    M: observerMetric,
    C: observerLedger,
    H: {
      inflightPackets: [], // forecaster does not observe un-arrived packets
      observerLocationId: observerState.observerHubId,
      receivedHistory: new Map(), // clean isolated memory
    },
    B: observerAllocation,
  };
}
