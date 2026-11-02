/**
 * Helical Recursive Manifold (HRM 4.0) Types
 * Mathematical Typed Product State: X_t = [Φ, G, T, M, C, H, B]
 */

export interface HubNode {
  id: string;
  name: string;
  code: string;
  lat: number;
  lng: number;
  country: string;
  region: 'Americas' | 'Europe' | 'APAC' | 'Africa' | 'Middle East';
  pueBaseline: number;
  coolingCapacityMw: number;
  solarExposureCoeff: number; // 0 to 1 daylight sensitivity
  baselineGpuUtil?: number;
  baselineQueueLatency?: number;
  baselineThermalHeadroom?: number;
  carbonIntensityGPerKwh?: number;
}

export interface FiberLink {
  id: string;
  sourceId: string;
  targetId: string;
  name: string;
  type: 'submarine' | 'terrestrial';
  lengthKm: number;
  latencyMs: number; // based on c_fiber = 200 km/ms
  capacityTbps: number;
  weight: number;
  isSevered: boolean;
  health: number; // 0.0 to 1.0
}

/**
 * Continuous Field Channels (Φ_t in R^{N x 4})
 * Channel 0: GPU Compute Utilization % [0, 100]
 * Channel 1: Egress Queue Latency ms [0, 250]
 * Channel 2: Thermal Headroom °C [0, 45]
 * Channel 3: Power Usage Effectiveness (PUE) [1.05, 2.0]
 */
export type FieldChannels = [number, number, number, number]; // [util, queueLatency, thermalHeadroom, pue]

export interface CarrierComplexG {
  nodes: HubNode[];
  links: FiberLink[];
  adjacency: number[][]; // N x N weight matrix W
  laplacian: number[][]; // N x N Graph Laplacian L = D - W
  distanceMatrix: number[][]; // N x N geodesic km
  propagationLatency: number[][]; // N x N fiber propagation ms
}

export interface TransportOperatorStateT {
  lastTopologyMutationTime: number;
  activeSeveredLinks: string[];
  divertedTrafficRatio: number;
  phantomEnergyResidual: number; // must remain ~0
}

export interface MetricTensorM {
  curvature: number[]; // scalar curvature per node
  helicalPhase: number[]; // theta_i coordinate phase
  radiusZ: number[]; // helical elevation / radius coordinate
}

export interface AttributionLedgerC {
  step: number;
  timestampMs: number;
  // Breakdown of Explanation Vector: ΔX_t = A_0 + A_k + A_ij + A_xi + A_event + A_corr + eps
  A_0: number[]; // Planetary diurnal follow-the-sun drift (norm or per channel)
  A_react: number[]; // Local node cubic reaction R_Φ
  A_diff: number[]; // Graph Laplacian diffusion -D_Φ L Φ
  A_xi: number[]; // Stochastic micro-bursts / Gaussian fluctuations
  A_event: number[]; // Discrete topological / operational perturbations
  A_corr: number[]; // Stabilization projection correction S_t ∘ P_t
  epsilon: number[]; // Residual vector
  totalDelta: number[]; // Total ΔX_t
  residualRatio: number; // ||ε_t|| / (||ΔX_t|| + δ)
  invariantPreserved: boolean; // true if residualRatio <= tau_ledger
}

export type TelemetryProvenance = 'simulated' | 'live' | 'hybrid';

export interface TelemetryPacket {
  nodeId: string;
  timestamp: number;
  sentAt: number;
  deliverAt: number;
  fields: FieldChannels;
  provenance?: TelemetryProvenance;
  measuredMask?: [boolean, boolean, boolean, boolean];
  missingMask?: [boolean, boolean, boolean, boolean];
}

export interface TelemetryHorizonH {
  inflightPackets: TelemetryPacket[];
  observerLocationId: string; // Ground truth telemetry aggregation hub (e.g. Ashburn)
  receivedHistory: Map<string, TelemetryPacket[]>;
}

export interface ResourceAllocationB {
  dispatchVector: number[]; // Workload a_i* summing to 1.0
  utilityScores: number[]; // u_i per node
  switchingPenalty: number; // λ_switch * ||a - a_{t-1}||_1
  totalBudgetCost: number;
  carbonIntensity: number[];
}

/**
 * Full Typed Product State X_t = [Φ, G, T, M, C, H, B]
 */
export interface ProductStateX {
  timeMs: number;
  Phi: FieldChannels[]; // N x 4
  G: CarrierComplexG;
  T: TransportOperatorStateT;
  M: MetricTensorM;
  C: AttributionLedgerC;
  H: TelemetryHorizonH;
  B: ResourceAllocationB;
}

export interface DiscreteEvent {
  id: string;
  timeMs: number;
  type: 'CABLE_SEVER' | 'NODE_THERMAL_TRIP' | 'SOLAR_SHIFT' | 'MICROBURST_SPIKE' | 'TOPOLOGY_RESTORE';
  label: string;
  description: string;
  targetId?: string; // link or node ID
  magnitude: number;
  durationMs?: number; // optional transient expiration in ms
}

export interface DivergenceMetrics {
  timestampMs: number;
  euclideanDivergence: number;
  channelDivergences: [number, number, number, number];
  maxNodeDivergence: {
    nodeId: string;
    divergence: number;
  };
  anomalyDetected: boolean;
}

/**
 * HRM 4.1 Rolling Predictive Forecast Record
 */
export interface ForecastChannelMetrics {
  mae: [number, number, number, number];
  rmse: [number, number, number, number];
  mape: [number, number, number, number];
  avgMae: number;
  avgRmse: number;
}

export type ForecastMode = 'hrm-4.1' | 'persistence' | 'linear_extrap' | 'diffusion_only';

export interface ForecastRecord {
  forecastId: string;
  issuedAtMs: number;
  targetAtMs: number;
  horizonMs: number;
  sourceWatermarkMs: number;
  prediction: FieldChannels[]; // N x 4 predicted state at targetAtMs
  mode: ForecastMode;
  seed: number;
  status: 'pending' | 'scored';
  groundTruth?: FieldChannels[]; // physical plant truth at targetAtMs
  metrics?: ForecastChannelMetrics;
  trajectory?: { timeMs: number; values: FieldChannels[] }[];
}

/**
 * Independent Observer-State Reconstruction
 * Built strictly from arrived packets (deliverAt <= currentSimTime)
 */
export interface ObserverState {
  observerHubId: string;
  watermarkMs: number;
  reconstructedPhi: FieldChannels[];
  stalenessMs: number[]; // age of telemetry per node
  packetLossCount: number;
  receivedCount: number;
  lastUpdatedMs: number;
  coverageRate: number; // percentage of nodes with fresh received observations [0-100]
  isEstimated: boolean[]; // whether node value uses prior estimation vs direct observation
  measuredMasks?: [boolean, boolean, boolean, boolean][];
  provenancePerNode?: ('simulated' | 'live' | 'hybrid' | 'prior')[];
}

/**
 * Baseline Performance Metrics
 */
export interface BaselineMetrics {
  avgMae: number;
  avgRmse: number;
  channelMae: [number, number, number, number];
  runtimeMs: number;
  incidentMetrics?: IncidentMetrics;
}

export interface IncidentMetrics {
  precision: number;       // TP / (TP + FP)
  recall: number;          // TP / (TP + FN)
  falseAlarmRate: number;  // FP / (FP + TN)
  incidentCount: number;   // Total ground-truth threshold breaches
  leadTimeMs: number;      // Average warning lead time in milliseconds (e.g. 200 - 500ms)
}

export type BenchmarkDatasetType = 'simulated_hrm' | 'synthetic_stochastic' | 'real_telemetry_heldout';

/**
 * Deterministic Benchmark Report with Synthetic vs Real Separation
 */
export interface BenchmarkReport {
  scenario: string;
  datasetType: BenchmarkDatasetType;
  isRealWorldVerified: boolean;
  seed: number;
  numTrials: number;
  horizonMs: number;
  evaluatedAt: string;
  hrm41: BaselineMetrics & { invariantPreservedRate: number };
  baselines: {
    persistence: BaselineMetrics;
    linearExtrap: BaselineMetrics;
    diffusionOnly: BaselineMetrics;
  };
  summary: string;
  notes?: string;
}

/**
 * Live Telemetry Ingestion & Observations
 */
export type TelemetrySourceMode = 'simulated' | 'prometheus' | 'opentelemetry';
export type ExecutionMode = 'SIMULATED' | 'LIVE' | 'HYBRID';

export type MetricQuality = 'good' | 'suspect' | 'missing' | 'stale' | 'degraded';

export interface TelemetryObservation {
  nodeId: string;
  channel: 'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue';
  value: number;
  eventTimeMs: number;
  receivedAtMs: number;
  source: string;
  quality: MetricQuality;
}

export interface NodeObservation {
  nodeId: string;
  timestampMs: number;
  receivedAtMs: number;
  channels: {
    gpuUtil?: number;
    queueLatencyMs?: number;
    thermalHeadroomC?: number;
    pue?: number;
  };
  missingChannels: Array<'gpuUtil' | 'queueLatencyMs' | 'thermalHeadroomC' | 'pue'>;
  quality: MetricQuality;
  isRealWorld: boolean;
}

export interface TelemetryIngestionConfig {
  sourceMode: TelemetrySourceMode;
  executionMode?: ExecutionMode;
  endpoint: string;
  bearerToken: string;
  queryIntervalMs: number;
  status: 'idle' | 'connected' | 'error' | 'syncing';
  lastSyncTimeMs: number;
  lastError?: string;
  nodeMetricMap: Record<string, string>;
  receivedSamplesCount?: number;
}

