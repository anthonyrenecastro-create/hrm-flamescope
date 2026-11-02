/**
 * Dual-Worldmodel Telemetry Architecture for HRM 4.1
 *
 * Model A: Ground-Truth Physical Plant Simulation
 * - 1ms discretized physical plant simulation
 * - Speed-of-light packet transmission over geodesic fiber paths
 * - Ingestion of delivered packets into H.receivedHistory
 * - Independent observer-state reconstruction from arrived telemetry
 *
 * Model B: True 500ms Numerical Predictive Integration
 * - Rolling multi-step numerical integration (forecastAt)
 * - Managed forecast ring buffer with strict target timestamp scoring
 * - Holdout calibration uncertainty bands (95% CI)
 * - Distinction between provisional forward predictions and matured evaluated errors
 */

import {
  FieldChannels,
  CarrierComplexG,
  TransportOperatorStateT,
  MetricTensorM,
  TelemetryHorizonH,
  DiscreteEvent,
  ProductStateX,
  DivergenceMetrics,
  TelemetryPacket,
  ObserverState,
  ForecastRecord,
  TelemetryIngestionConfig,
  NodeObservation,
} from '../types/hrm';
import {
  computeHRMTransitionStep,
  initializeFieldChannels,
  initializeMetricTensor,
} from './hrmMath';
import { buildInitialCarrierComplex, recalculateMatrices } from './planetaryCarrier';
import { cloneFieldChannels, cloneCarrierComplex, cloneProductState } from './clone';
import { initializeHRMStreams, HRMStreams } from './prng';
import {
  ingestArrivedPackets,
  reconstructObserverState,
  createObserverSnapshot,
  MAX_NODE_HISTORY_PACKETS,
} from './observer';
import { forecastAt, ForecastManager, DEFAULT_FORECAST_HORIZON_MS } from './forecast';

export const FORWARD_PROJECTION_HORIZON_MS = DEFAULT_FORECAST_HORIZON_MS; // 500ms
export const OBSERVER_HUB_ID = 'ashburn'; // Central observability collector
export const DIVERGENCE_ANOMALY_THRESHOLD = 8.5;

export interface DualWorldmodelState {
  timeMs: number;
  dt: number;
  modelA: ProductStateX; // Observational Ground Truth / Physical Plant
  modelB: ProductStateX; // Predictive Forward Twin (latest projected target state)
  observer: ObserverState; // Independent Observer State Reconstruction
  forecastManager: ForecastManager;
  latestForecast: ForecastRecord | null;
  latestMaturedForecast: ForecastRecord | null;
  calibrationBands: [number, number, number, number];
  divergence: DivergenceMetrics; // Lookahead scenario divergence
  divergenceHistory: { timeMs: number; div: number }[];
  activeEvents: DiscreteEvent[];
  eventHistory: DiscreteEvent[];
  groundTruthHistory: { timeMs: number; phi: FieldChannels[] }[];
  streams: HRMStreams;
  telemetryConfig: TelemetryIngestionConfig;
}

export function initializeDualWorldmodel(baseSeed: number = 42): DualWorldmodelState {
  const streams = initializeHRMStreams(baseSeed);
  const G_A = buildInitialCarrierComplex();
  const G_B = buildInitialCarrierComplex();

  const N = G_A.nodes.length;
  const basePueValues = G_A.nodes.map(n => n.pueBaseline);

  const Phi_A = initializeFieldChannels(N, basePueValues);
  const Phi_B = cloneFieldChannels(Phi_A);

  const T_A: TransportOperatorStateT = {
    lastTopologyMutationTime: 0,
    activeSeveredLinks: [],
    divertedTrafficRatio: 0,
    phantomEnergyResidual: 0,
  };
  const T_B: TransportOperatorStateT = { ...T_A };

  const M_A = initializeMetricTensor(N);
  const M_B = initializeMetricTensor(N);

  const H_A: TelemetryHorizonH = {
    inflightPackets: [],
    observerLocationId: OBSERVER_HUB_ID,
    receivedHistory: new Map(),
  };
  const H_B: TelemetryHorizonH = {
    inflightPackets: [],
    observerLocationId: OBSERVER_HUB_ID,
    receivedHistory: new Map(),
  };

  const initialTime = 0;
  const initialAllocation = Array(N).fill(1.0 / N);

  // Compute initial step for A
  const stepA = computeHRMTransitionStep(
    Phi_A,
    G_A,
    T_A,
    M_A,
    initialTime,
    1.0,
    [],
    initialAllocation,
    streams.plantStream
  );

  const modelA: ProductStateX = {
    timeMs: initialTime,
    Phi: stepA.Phi_next,
    G: G_A,
    T: stepA.updatedT,
    M: stepA.updatedM,
    C: stepA.ledger,
    H: H_A,
    B: stepA.allocation,
  };

  // Pre-populate observer receivedHistory with initial baseline packets
  for (let i = 0; i < N; i++) {
    const node = G_A.nodes[i];
    H_A.receivedHistory.set(node.id, [
      {
        nodeId: node.id,
        timestamp: 0,
        sentAt: 0,
        deliverAt: 0,
        fields: [...stepA.Phi_next[i]] as FieldChannels,
      },
    ]);
  }

  const observer = reconstructObserverState(G_A, H_A, initialTime, stepA.Phi_next);
  const forecastManager = new ForecastManager(80, 50);

  // Initial 500ms forward forecast from observer snapshot
  const initialSnapshot = createObserverSnapshot(modelA, observer, initialTime);
  const initialForecast = forecastAt(
    initialTime,
    initialSnapshot,
    FORWARD_PROJECTION_HORIZON_MS,
    1.0,
    streams.forecastStream(),
    []
  );
  forecastManager.addForecast(initialForecast);

  const modelB: ProductStateX = {
    timeMs: initialTime + FORWARD_PROJECTION_HORIZON_MS,
    Phi: cloneFieldChannels(initialForecast.prediction),
    G: G_B,
    T: { ...stepA.updatedT },
    M: { ...stepA.updatedM },
    C: { ...stepA.ledger },
    H: H_B,
    B: { ...stepA.allocation },
  };

  const initialDivergence: DivergenceMetrics = {
    timestampMs: 0,
    euclideanDivergence: 0.05,
    channelDivergences: [0.02, 0.04, 0.01, 0.005],
    maxNodeDivergence: { nodeId: 'ashburn', divergence: 0.05 },
    anomalyDetected: false,
  };

  const initialTelemetryConfig: TelemetryIngestionConfig = {
    sourceMode: 'simulated',
    endpoint: '/api/telemetry/sample/prometheus',
    bearerToken: '',
    queryIntervalMs: 2000,
    status: 'idle',
    lastSyncTimeMs: 0,
    nodeMetricMap: {
      ashburn: 'container_cpu_usage_seconds_total{instance="ashburn-dc01"}',
      frankfurt: 'container_cpu_usage_seconds_total{instance="frankfurt-dc01"}',
      tokyo: 'container_cpu_usage_seconds_total{instance="tokyo-dc01"}',
    },
  };

  return {
    timeMs: 0,
    dt: 1.0, // 1 ms simulation resolution
    modelA,
    modelB,
    observer,
    forecastManager,
    latestForecast: initialForecast,
    latestMaturedForecast: null,
    calibrationBands: [3.5, 4.0, 1.8, 0.025],
    divergence: initialDivergence,
    divergenceHistory: [{ timeMs: 0, div: 0.05 }],
    activeEvents: [],
    eventHistory: [],
    groundTruthHistory: [{ timeMs: 0, phi: cloneFieldChannels(stepA.Phi_next) }],
    streams,
    telemetryConfig: initialTelemetryConfig,
  };
}

/**
 * Steps the dual-worldmodel system by dt milliseconds
 */
export function stepDualWorldmodel(
  state: DualWorldmodelState,
  dt: number = 1.0,
  subSteps: number = 1
): DualWorldmodelState {
  let currentState = state;
  for (let s = 0; s < subSteps; s++) {
    currentState = executeSingleStep(currentState, dt / subSteps);
  }
  return currentState;
}

function executeSingleStep(state: DualWorldmodelState, dt: number): DualWorldmodelState {
  const nextTimeMs = state.timeMs + dt;
  const N = state.modelA.Phi.length;

  // Prune expired transient events
  const liveEvents = state.activeEvents.filter(
    ev => !ev.durationMs || (nextTimeMs - ev.timeMs) <= ev.durationMs
  );

  // 1. Advance Model A (Physical Plant Ground Truth)
  const G_A = state.modelA.G;
  const T_A = state.modelA.T;
  const M_A = state.modelA.M;

  const resA = computeHRMTransitionStep(
    state.modelA.Phi,
    G_A,
    T_A,
    M_A,
    nextTimeMs,
    dt,
    liveEvents,
    state.modelA.B.dispatchVector,
    state.streams.plantStream
  );

  // Maintain ground truth history buffer for scoring (keep last 1200ms)
  const updatedGroundTruthHistory = [
    ...state.groundTruthHistory,
    { timeMs: nextTimeMs, phi: cloneFieldChannels(resA.Phi_next) },
  ];
  if (updatedGroundTruthHistory.length > 250) {
    updatedGroundTruthHistory.shift();
  }

  // 2. Transmit & Ingest Telemetry Packets
  // Execution modes: SIMULATED (only plant packets), LIVE (only external telemetry), HYBRID (fused)
  const execMode = state.telemetryConfig?.executionMode ||
    (state.telemetryConfig?.sourceMode === 'simulated' ? 'SIMULATED' : 'LIVE');

  const observerIdx = G_A.nodes.findIndex(n => n.id === OBSERVER_HUB_ID);
  const safeObserverIdx = observerIdx >= 0 ? observerIdx : 0;
  let currentInflight = [...state.modelA.H.inflightPackets];

  // In LIVE mode, simulated packet generation is strictly DISABLED:
  // observer receives solely external real-world telemetry observations
  if (execMode !== 'LIVE' && Math.floor(nextTimeMs / 20) !== Math.floor(state.timeMs / 20)) {
    const newPackets: TelemetryPacket[] = [];
    for (let i = 0; i < N; i++) {
      const node = G_A.nodes[i];
      const delayMs = G_A.propagationLatency[i][safeObserverIdx];
      newPackets.push({
        nodeId: node.id,
        timestamp: nextTimeMs,
        sentAt: nextTimeMs,
        deliverAt: nextTimeMs + delayMs,
        fields: cloneFieldChannels([resA.Phi_next[i]])[0],
        provenance: 'simulated',
        measuredMask: [true, true, true, true],
        missingMask: [false, false, false, false],
      });
    }
    currentInflight = [...currentInflight, ...newPackets];
  }

  // Ingest arrived packets into H_A.receivedHistory
  const { updatedHorizon } = ingestArrivedPackets(
    {
      ...state.modelA.H,
      inflightPackets: currentInflight,
    },
    nextTimeMs
  );

  const nextModelA: ProductStateX = {
    timeMs: nextTimeMs,
    Phi: resA.Phi_next,
    G: G_A,
    T: resA.updatedT,
    M: resA.updatedM,
    C: resA.ledger,
    H: updatedHorizon,
    B: resA.allocation,
  };

  // 3. Reconstruct Independent Observer State from arrived packets
  // ZERO LEAKAGE: reconstructs solely from delivered telemetry packets, with explicit priors
  const observerState = reconstructObserverState(
    G_A,
    updatedHorizon,
    nextTimeMs
  );

  // 4. True Rolling 500ms Numerical Forecasting
  // Forecaster runs from independent observer snapshot with NO future knowledge and NO plant hidden state
  const forecastMgr = state.forecastManager;
  let latestFc = state.latestForecast;

  if (forecastMgr.shouldIssueForecast(nextTimeMs)) {
    // Allocation input is derived purely from observer state (not from hidden plant allocation)
    const observerSnapshot = createObserverSnapshot(
      G_A,
      observerState,
      nextTimeMs
    );
    const newForecast = forecastAt(
      nextTimeMs,
      observerSnapshot,
      FORWARD_PROJECTION_HORIZON_MS,
      1.0,
      state.streams.forecastStream(),
      liveEvents
    );
    forecastMgr.addForecast(newForecast);
    latestFc = newForecast;
  }

  // 5. Score Matured Forecasts whose targetAtMs <= nextTimeMs
  forecastMgr.evaluateMaturedForecasts(nextTimeMs, (targetMs: number) => {
    // Find closest ground-truth sample within 2.5ms tolerance
    let closest: { timeMs: number; phi: FieldChannels[] } | null = null;
    let minDiff = Infinity;
    for (const h of updatedGroundTruthHistory) {
      const diff = Math.abs(h.timeMs - targetMs);
      if (diff < minDiff) {
        minDiff = diff;
        closest = h;
      }
    }
    return closest && minDiff <= 3.0 ? closest.phi : null;
  });

  const latestMatured = forecastMgr.getLatestMaturedForecast();
  const calibrationBands = forecastMgr.getCalibrationBands();

  // Model B reflects the latest projected state for UI visualization
  const nextModelB: ProductStateX = {
    timeMs: nextTimeMs + FORWARD_PROJECTION_HORIZON_MS,
    Phi: latestFc ? cloneFieldChannels(latestFc.prediction) : cloneFieldChannels(resA.Phi_next),
    G: state.modelB.G,
    T: resA.updatedT,
    M: resA.updatedM,
    C: resA.ledger,
    H: state.modelB.H,
    B: resA.allocation,
  };

  // 6. Calculate Lookahead Scenario Divergence (Model A current vs Model B forward)
  const channelScale = [50.0, 40.0, 20.0, 0.4];
  let sumEuclidean = 0;
  const channelDivs: [number, number, number, number] = [0, 0, 0, 0];
  let maxNodeId = G_A.nodes[0].id;
  let maxNodeDiv = 0;

  for (let i = 0; i < N; i++) {
    const phiA = nextModelA.Phi[i];
    const phiB = nextModelB.Phi[i];
    let nodeDistSq = 0;

    for (let c = 0; c < 4; c++) {
      const diffNorm = (phiA[c] - phiB[c]) / channelScale[c];
      const diffSq = diffNorm * diffNorm;
      channelDivs[c] += Math.abs(phiA[c] - phiB[c]) / N;
      nodeDistSq += diffSq;
    }

    const nodeDist = Math.sqrt(nodeDistSq);
    sumEuclidean += nodeDist;
    if (nodeDist > maxNodeDiv) {
      maxNodeDiv = nodeDist;
      maxNodeId = G_A.nodes[i].id;
    }
  }

  const avgDivergence = sumEuclidean / N;
  const anomalyDetected = avgDivergence > DIVERGENCE_ANOMALY_THRESHOLD;

  const divergenceMetrics: DivergenceMetrics = {
    timestampMs: nextTimeMs,
    euclideanDivergence: Number(avgDivergence.toFixed(3)),
    channelDivergences: [
      Number(channelDivs[0].toFixed(2)),
      Number(channelDivs[1].toFixed(2)),
      Number(channelDivs[2].toFixed(2)),
      Number(channelDivs[3].toFixed(3)),
    ],
    maxNodeDivergence: {
      nodeId: maxNodeId,
      divergence: Number(maxNodeDiv.toFixed(2)),
    },
    anomalyDetected,
  };

  // Keep a rolling window of divergence history (last 120 points)
  const updatedHistory = [...state.divergenceHistory, { timeMs: nextTimeMs, div: avgDivergence }];
  if (updatedHistory.length > 120) {
    updatedHistory.shift();
  }

  return {
    ...state,
    timeMs: nextTimeMs,
    activeEvents: liveEvents,
    modelA: nextModelA,
    modelB: nextModelB,
    observer: observerState,
    latestForecast: latestFc,
    latestMaturedForecast: latestMatured,
    calibrationBands,
    divergence: divergenceMetrics,
    divergenceHistory: updatedHistory,
    groundTruthHistory: updatedGroundTruthHistory,
  };
}

/**
 * Injects a discrete event into both or either worldmodel (supports toggle-to-repair)
 */
export function injectDiscreteEvent(
  state: DualWorldmodelState,
  event: DiscreteEvent
): DualWorldmodelState {
  // 1. Toggle Cable Severance if already severed
  if (event.type === 'CABLE_SEVER' && event.targetId) {
    const existingIdx = state.activeEvents.findIndex(
      e => e.type === 'CABLE_SEVER' && e.targetId === event.targetId
    );

    if (existingIdx >= 0) {
      // Toggle back to repaired
      const applyRepair = (G: CarrierComplexG) => {
        const links = G.links.map(l =>
          l.id === event.targetId ? { ...l, isSevered: false, health: 1.0 } : l
        );
        const { adjacency, laplacian } = recalculateMatrices(G.nodes, links);
        return { ...G, links, adjacency, laplacian };
      };

      const repairEvent: DiscreteEvent = {
        id: `repair_${Date.now()}`,
        timeMs: state.timeMs,
        type: 'TOPOLOGY_RESTORE',
        label: `Repaired Trunk`,
        description: `Reconnected severed cable: ${event.targetId}`,
        targetId: event.targetId,
        magnitude: 1.0,
      };

      return {
        ...state,
        activeEvents: state.activeEvents.filter((_, idx) => idx !== existingIdx),
        eventHistory: [repairEvent, ...state.eventHistory].slice(0, 50),
        modelA: { ...state.modelA, G: applyRepair(state.modelA.G) },
        modelB: { ...state.modelB, G: applyRepair(state.modelB.G) },
      };
    }
  }

  // 2. Toggle Node Thermal Trip if already tripped
  if (event.type === 'NODE_THERMAL_TRIP' && event.targetId) {
    const existingTripIdx = state.activeEvents.findIndex(
      e => e.type === 'NODE_THERMAL_TRIP' && e.targetId === event.targetId
    );

    if (existingTripIdx >= 0) {
      // Toggle back to nominal
      const untripEvent: DiscreteEvent = {
        id: `untrip_${Date.now()}`,
        timeMs: state.timeMs,
        type: 'TOPOLOGY_RESTORE',
        label: `Cooled Node`,
        description: `Restored thermal cooling on: ${event.targetId}`,
        targetId: event.targetId,
        magnitude: 1.0,
      };

      return {
        ...state,
        activeEvents: state.activeEvents.filter((_, idx) => idx !== existingTripIdx),
        eventHistory: [untripEvent, ...state.eventHistory].slice(0, 50),
      };
    }
  }

  // Set transient duration for impulse spikes
  const normalizedEvent: DiscreteEvent = {
    ...event,
    durationMs:
      event.durationMs !== undefined
        ? event.durationMs
        : event.type === 'MICROBURST_SPIKE'
        ? 400
        : event.type === 'SOLAR_SHIFT'
        ? 800
        : undefined,
  };

  const newActive = [...state.activeEvents, normalizedEvent];
  const newHistory = [normalizedEvent, ...state.eventHistory].slice(0, 50);

  // If the event mutates a fiber link topology, sever that link in G_A and G_B
  let nextModelA = { ...state.modelA };
  let nextModelB = { ...state.modelB };

  if (normalizedEvent.type === 'CABLE_SEVER' && normalizedEvent.targetId) {
    const applySever = (G: CarrierComplexG) => {
      const links = G.links.map(l =>
        l.id === normalizedEvent.targetId ? { ...l, isSevered: true, health: 0.0 } : l
      );
      const { adjacency, laplacian } = recalculateMatrices(G.nodes, links);
      return { ...G, links, adjacency, laplacian };
    };

    nextModelA = { ...nextModelA, G: applySever(state.modelA.G) };
    nextModelB = { ...nextModelB, G: applySever(state.modelB.G) };
  } else if (normalizedEvent.type === 'TOPOLOGY_RESTORE') {
    const restoreAll = (G: CarrierComplexG) => {
      const links = G.links.map(l => ({ ...l, isSevered: false, health: 1.0 }));
      const { adjacency, laplacian } = recalculateMatrices(G.nodes, links);
      return { ...G, links, adjacency, laplacian };
    };

    nextModelA = { ...nextModelA, G: restoreAll(state.modelA.G) };
    nextModelB = { ...nextModelB, G: restoreAll(state.modelB.G) };
    return {
      ...state,
      activeEvents: [],
      eventHistory: newHistory,
      modelA: nextModelA,
      modelB: nextModelB,
    };
  }

  return {
    ...state,
    activeEvents: newActive,
    eventHistory: newHistory,
    modelA: nextModelA,
    modelB: nextModelB,
  };
}

/**
 * Ingests real-world telemetry observations from external Prometheus or OTLP streams.
 * Maps observed values to node packets, respecting planetary fiber delay horizons,
 * without contaminating or mutating simulated plant ground-truth dynamics.
 */
export function ingestLiveTelemetryObservations(
  state: DualWorldmodelState,
  observations: NodeObservation[]
): DualWorldmodelState {
  if (!observations || observations.length === 0) return state;

  const currentHorizon = state.modelA.H;
  const updatedHistory = new Map<string, TelemetryPacket[]>();
  currentHorizon.receivedHistory.forEach((pkts, nodeId) => {
    updatedHistory.set(nodeId, [...pkts]);
  });

  const nowMs = state.timeMs;
  const G = state.modelA.G;
  const observerIdx = G.nodes.findIndex(n => n.id === OBSERVER_HUB_ID);
  const safeObserverIdx = observerIdx >= 0 ? observerIdx : 0;

  let samplesRecorded = 0;

  for (const obs of observations) {
    const nodeIdx = G.nodes.findIndex(n => n.id === obs.nodeId);
    if (nodeIdx < 0) continue; // unknown node

    const node = G.nodes[nodeIdx];

    // Explicit missingness & verification masks:
    const measuredMask: [boolean, boolean, boolean, boolean] = [
      obs.channels.gpuUtil !== undefined && Number.isFinite(obs.channels.gpuUtil),
      obs.channels.queueLatencyMs !== undefined && Number.isFinite(obs.channels.queueLatencyMs),
      obs.channels.thermalHeadroomC !== undefined && Number.isFinite(obs.channels.thermalHeadroomC),
      obs.channels.pue !== undefined && Number.isFinite(obs.channels.pue),
    ];
    const missingMask: [boolean, boolean, boolean, boolean] = [
      !measuredMask[0],
      !measuredMask[1],
      !measuredMask[2],
      !measuredMask[3],
    ];

    const fields: FieldChannels = [
      measuredMask[0] ? obs.channels.gpuUtil! : (node.baselineGpuUtil ?? 55.0),
      measuredMask[1] ? obs.channels.queueLatencyMs! : (node.baselineQueueLatency ?? 20.0),
      measuredMask[2] ? obs.channels.thermalHeadroomC! : (node.baselineThermalHeadroom ?? 30.0),
      measuredMask[3] ? obs.channels.pue! : node.pueBaseline,
    ];

    // Wall-clock timestamp domain invariant:
    // Measurement time = obs.timestampMs
    // Ingestion time = obs.receivedAtMs
    // Delivery time at observer = ingestionTimeMs
    // NEVER apply artificial fiber propagation delays twice to real live telemetry!
    const ingestionTimeMs = obs.receivedAtMs || nowMs;
    const deliverAtMs = ingestionTimeMs;

    const pkt: TelemetryPacket = {
      nodeId: obs.nodeId,
      timestamp: obs.timestampMs || nowMs,
      sentAt: ingestionTimeMs,
      deliverAt: deliverAtMs,
      fields,
      provenance: 'live',
      measuredMask,
      missingMask,
    };

    const list = updatedHistory.get(obs.nodeId) || [];
    list.push(pkt);
    if (list.length > MAX_NODE_HISTORY_PACKETS) list.shift();
    updatedHistory.set(obs.nodeId, list);
    samplesRecorded++;
  }

  const updatedConfig: TelemetryIngestionConfig = {
    ...state.telemetryConfig,
    status: 'connected',
    lastSyncTimeMs: Date.now(),
    receivedSamplesCount: (state.telemetryConfig.receivedSamplesCount || 0) + samplesRecorded,
  };

  return {
    ...state,
    modelA: {
      ...state.modelA,
      H: {
        ...currentHorizon,
        receivedHistory: updatedHistory,
      },
    },
    telemetryConfig: updatedConfig,
  };
}

