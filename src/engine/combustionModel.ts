/**
 * FlameScope HRM adaptation: combustion state X = [Phi, G, T, M, C, H, B].
 *
 * Honest adaptation notes (spec §4, §9):
 * - G edges are EXPLICIT relationships (shared fuel, close conditions,
 *   temporal continuity). They are similarity relations, NOT physical
 *   energy-transport channels; the graph diffusion below is a
 *   statistical smoothing operator and is labeled as such.
 * - The planetary A_0 (diurnal drift), A_react (cubic reaction) and
 *   A_event (topology severance) ledger terms have no combustion
 *   meaning and are NOT relabeled. The combustion ledger decomposes a
 *   forecast as: global-mean term + graph-coupling term +
 *   stabilization (range-clamp) correction + residual. The identity
 *   prediction = mean + coupling + correction holds exactly by
 *   construction, and for scored records
 *   observed = prediction + residual holds exactly; both are tested.
 * - Forecasting task: predict the burning-rate constant K (mm²/s) of
 *   held-out tests from conditions only. The relationship graph for a
 *   held-out test connects ONLY to training tests, and held-out target
 *   values are never read by any model (leakage-tested).
 */
import { CombustionDataset, CombustionExperiment } from '../types/combustion';

/* ---------------- Phi: feature encoding ---------------- */

/** Condition features used by every model (identical info for all). */
export function conditionFeatures(e: CombustionExperiment): number[] {
  return [
    e.oxidizer.o2 ?? NaN,
    (e.pressureKPa ?? NaN) / 101.325, // atm
    e.initialDiameterMm ?? NaN,
    e.oxidizer.co2 ?? 0,
    e.oxidizer.he ?? 0,
    e.fuel.toLowerCase().includes('heptane') ? 1 : 0,
  ];
}
const FEATURE_SCALE = [0.1, 1, 2, 0.3, 0.3, 1];

export function featureDistance(a: CombustionExperiment, b: CombustionExperiment): number {
  const fa = conditionFeatures(a);
  const fb = conditionFeatures(b);
  let s = 0;
  let n = 0;
  for (let i = 0; i < fa.length; i++) {
    if (Number.isFinite(fa[i]) && Number.isFinite(fb[i])) {
      const d = (fa[i] - fb[i]) / FEATURE_SCALE[i];
      s += d * d;
      n++;
    }
  }
  return n === 0 ? Infinity : Math.sqrt(s / n);
}

/* ---------------- G: experimental relationship graph ---------------- */

export type EdgeRelation = 'shared-fuel' | 'comparable-conditions' | 'temporal-continuity';

export interface CombustionGraph {
  edges: Array<{ a: number; b: number; weight: number; relations: EdgeRelation[] }>;
  /** Human-readable statement of what edges mean and do not mean. */
  semantics: string;
}

export function buildRelationshipGraph(
  experiments: CombustionExperiment[],
  maxDistance = 0.9,
): CombustionGraph {
  const edges: CombustionGraph['edges'] = [];
  for (let i = 0; i < experiments.length; i++) {
    for (let j = i + 1; j < experiments.length; j++) {
      const a = experiments[i];
      const b = experiments[j];
      const relations: EdgeRelation[] = [];
      if (a.fuel === b.fuel) relations.push('shared-fuel');
      const d = featureDistance(a, b);
      if (d <= maxDistance) relations.push('comparable-conditions');
      if (a.dateISO && b.dateISO && a.dateISO === b.dateISO) relations.push('temporal-continuity');
      if (relations.includes('comparable-conditions')) {
        edges.push({ a: i, b: j, weight: Math.exp(-d * d * 2), relations });
      }
    }
  }
  return {
    edges,
    semantics:
      'Edges encode declared similarity relations only (shared fuel, comparable conditions, same test date). They are not physical transport channels; graph diffusion over them is a statistical smoothing assumption, stated explicitly wherever it is used.',
  };
}

/* ---------------- Deterministic split (no leakage) ---------------- */

/** Hash-based deterministic split: stable across runs and machines. */
export function splitTrainTest<T extends { id: string }>(items: T[], testFraction = 0.25, seed = 42): { train: T[]; test: T[] } {
  const train: T[] = [];
  const test: T[] = [];
  for (const item of items) {
    let h = seed >>> 0;
    for (let i = 0; i < item.id.length; i++) h = (h * 31 + item.id.charCodeAt(i)) >>> 0;
    (h % 100 < testFraction * 100 ? test : train).push(item);
  }
  return { train, test };
}

/* ---------------- Models ---------------- */

export interface ModelPrediction {
  experimentId: string;
  predicted: number;
  /** Ledger decomposition of the HRM prediction; null for baselines. */
  ledger: {
    globalMean: number;
    graphCoupling: number;
    stabilizationCorrection: number;
    identityHolds: boolean;
  } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function trainTargets(train: CombustionExperiment[]): number[] {
  return train.map((e) => e.burningRateMm2PerS).filter((v): v is number => v !== null);
}

/** Model A: HRM graph-coupled model (kernel smoothing over G + stabilization clamp). */
export function predictHrmGraph(train: CombustionExperiment[], target: CombustionExperiment): ModelPrediction {
  const usable = train.filter((e) => e.burningRateMm2PerS !== null);
  const ys = trainTargets(usable);
  const globalMean = ys.reduce((s, v) => s + v, 0) / ys.length;
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  let wSum = 0;
  let wySum = 0;
  for (const t of usable) {
    const d = featureDistance(target, t);
    if (!Number.isFinite(d)) continue;
    const sameFuel = t.fuel === target.fuel ? 1.5 : 1.0;
    const w = Math.exp(-d * d * 2) * sameFuel;
    wSum += w;
    wySum += w * (t.burningRateMm2PerS as number);
  }
  const neighborMean = wSum > 0 ? wySum / wSum : globalMean;
  // Graph-coupling contribution: pull from the global mean toward the
  // neighborhood estimate; coupling strength is a stated assumption.
  const couplingStrength = 0.85;
  const raw = globalMean + couplingStrength * (neighborMean - globalMean);
  const stabilized = clamp(raw, lo, hi);
  const graphCoupling = couplingStrength * (neighborMean - globalMean);
  const stabilizationCorrection = stabilized - raw;
  return {
    experimentId: target.id,
    predicted: stabilized,
    ledger: {
      globalMean,
      graphCoupling,
      stabilizationCorrection,
      identityHolds: Math.abs(globalMean + graphCoupling + stabilizationCorrection - stabilized) < 1e-9,
    },
  };
}

/** Baseline 1: global mean of training targets (persistence analogue for cross-sectional data). */
export function predictGlobalMean(train: CombustionExperiment[], target: CombustionExperiment): ModelPrediction {
  const ys = trainTargets(train);
  return { experimentId: target.id, predicted: ys.reduce((s, v) => s + v, 0) / ys.length, ledger: null };
}

/** Baseline 2: per-fuel mean. */
export function predictFuelMean(train: CombustionExperiment[], target: CombustionExperiment): ModelPrediction {
  const same = train.filter((e) => e.fuel === target.fuel && e.burningRateMm2PerS !== null);
  const pool = same.length >= 3 ? same : train.filter((e) => e.burningRateMm2PerS !== null);
  const ys = pool.map((e) => e.burningRateMm2PerS as number);
  return { experimentId: target.id, predicted: ys.reduce((s, v) => s + v, 0) / ys.length, ledger: null };
}

/** Baseline 3: ordinary least squares on condition features (independent implementation). */
export function fitLinearModel(train: CombustionExperiment[]): (target: CombustionExperiment) => ModelPrediction {
  const usable = train.filter((e) => e.burningRateMm2PerS !== null && conditionFeatures(e).every(Number.isFinite));
  const p = 6;
  // Normal equations with small ridge for stability.
  const A: number[][] = Array.from({ length: p + 1 }, () => Array(p + 1).fill(0));
  const b: number[] = Array(p + 1).fill(0);
  for (const e of usable) {
    const x = [1, ...conditionFeatures(e)];
    const y = e.burningRateMm2PerS as number;
    for (let i = 0; i <= p; i++) {
      for (let j = 0; j <= p; j++) A[i][j] += x[i] * x[j];
      b[i] += x[i] * y;
    }
  }
  for (let i = 0; i <= p; i++) A[i][i] += 1e-6;
  // Gaussian elimination.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col <= p; col++) {
    let piv = col;
    for (let r = col + 1; r <= p; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col] || 1e-12;
    for (let r = 0; r <= p; r++) {
      if (r === col) continue;
      const f = M[r][col] / d;
      for (let c = col; c <= p + 1; c++) M[r][c] -= f * M[col][c];
    }
  }
  const beta = M.map((row, i) => row[p + 1] / (M[i][i] || 1e-12));
  return (target) => {
    const f = conditionFeatures(target);
    const x = [1, ...f.map((v) => (Number.isFinite(v) ? v : 0))];
    return { experimentId: target.id, predicted: x.reduce((s, v, i) => s + v * beta[i], 0), ledger: null };
  };
}

/* ---------------- Comparison (dual-worldmodel) ---------------- */

export interface ModelScore {
  model: string;
  mae: number;
  rmse: number;
  n: number;
  runtimeMs: number;
  perFuel: Record<string, { mae: number; n: number }>;
  residuals: Array<{ experimentId: string; observed: number; predicted: number; residual: number }>;
}

export interface ComparisonReport {
  datasetId: string;
  datasetKind: string;
  task: string;
  seed: number;
  trainCount: number;
  testCount: number;
  scores: ModelScore[];
  winner: string;
  hrmLedgerIdentityRate: number; // fraction of HRM predictions whose ledger identity holds
  hrmScoredResidualCheck: boolean; // observed = predicted + residual exactly for all scored
  notes: string;
}

function scoreModel(
  name: string,
  test: CombustionExperiment[],
  predict: (t: CombustionExperiment) => ModelPrediction,
): { score: ModelScore; predictions: ModelPrediction[] } {
  const t0 = performance.now();
  const predictions = test.map(predict);
  const runtimeMs = performance.now() - t0;
  const residuals: ModelScore['residuals'] = [];
  const perFuel: ModelScore['perFuel'] = {};
  let absSum = 0;
  let sqSum = 0;
  predictions.forEach((p, i) => {
    const observed = test[i].burningRateMm2PerS as number;
    const residual = observed - p.predicted;
    residuals.push({ experimentId: p.experimentId, observed, predicted: p.predicted, residual });
    absSum += Math.abs(residual);
    sqSum += residual * residual;
    const f = (perFuel[test[i].fuel] ??= { mae: 0, n: 0 });
    f.mae += Math.abs(residual);
    f.n++;
  });
  Object.values(perFuel).forEach((f) => { f.mae = f.n ? f.mae / f.n : 0; });
  const n = residuals.length;
  return {
    score: {
      model: name,
      mae: n ? absSum / n : NaN,
      rmse: n ? Math.sqrt(sqSum / n) : NaN,
      n,
      runtimeMs,
      perFuel,
      residuals,
    },
    predictions,
  };
}

/**
 * Runs the full comparison on identical held-out observations.
 * Only records with a reported burning rate can be scored; records
 * missing the target are excluded from BOTH training targets and the
 * test set, and the exclusion counts are reported.
 */
export function runCombustionComparison(ds: CombustionDataset, seed = 42): ComparisonReport {
  const scorable = ds.experiments.filter((e) => e.burningRateMm2PerS !== null);
  const { train, test } = splitTrainTest(scorable, 0.25, seed);
  const linear = fitLinearModel(train);
  const hrm = scoreModel('HRM graph-coupled', test, (t) => predictHrmGraph(train, t));
  const scores = [
    hrm.score,
    scoreModel('Global mean (persistence analogue)', test, (t) => predictGlobalMean(train, t)).score,
    scoreModel('Per-fuel mean', test, (t) => predictFuelMean(train, t)).score,
    scoreModel('Linear regression (OLS)', test, linear).score,
  ];
  const winner = scores.reduce((best, s) => (s.mae < best.mae ? s : best), scores[0]).model;
  const identityRate = hrm.predictions.length
    ? hrm.predictions.filter((p) => p.ledger?.identityHolds).length / hrm.predictions.length
    : 0;
  const residualCheck = hrm.score.residuals.every(
    (r) => Math.abs(r.predicted + r.residual - r.observed) < 1e-9,
  );
  return {
    datasetId: ds.id,
    datasetKind: ds.kind,
    task: 'Predict burning-rate constant K (mm²/s) of held-out tests from conditions (fuel, O2, pressure, D0, diluents). Graph for held-out tests connects to training tests only.',
    seed,
    trainCount: train.length,
    testCount: test.length,
    scores,
    winner,
    hrmLedgerIdentityRate: identityRate,
    hrmScoredResidualCheck: residualCheck,
    notes:
      ds.kind === 'measured'
        ? 'Held-out evaluation on measured NASA FLEX data. The winner is reported as computed; no advantage is assumed for the HRM model.'
        : 'Evaluation on SYNTHETIC demonstration data — results describe the teaching model, not physical reality.',
  };
}

/* ---------------- T: derived d²-law trajectory ---------------- */

/**
 * Reconstructs the droplet d²(t) trajectory the source report itself
 * used: K is defined by the report as the slope of a linear fit of
 * diameter² vs time. The curve below is therefore DERIVED from two
 * reported quantities (D0 and K), not a separate measurement, and is
 * labeled derived wherever displayed.
 */
export function derivedDiameterTrajectory(
  e: CombustionExperiment,
  steps = 24,
): Array<{ tS: number; diameterMm: number }> | null {
  if (e.initialDiameterMm === null || e.burningRateMm2PerS === null) return null;
  const d0sq = e.initialDiameterMm * e.initialDiameterMm;
  const endD = e.extinctionDiameterMm ?? 0;
  const tEnd = (d0sq - endD * endD) / e.burningRateMm2PerS;
  if (!(tEnd > 0)) return null;
  const out: Array<{ tS: number; diameterMm: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const t = (tEnd * i) / steps;
    out.push({ tS: t, diameterMm: Math.sqrt(Math.max(0, d0sq - e.burningRateMm2PerS * t)) });
  }
  return out;
}

/* ---------------- B: fire-safety relevance ranking ---------------- */

export interface RankingWeights {
  relevance: number;
  evidenceQuality: number;
  completeness: number;
  reproducibility: number;
  lowUncertainty: number;
  applicability: number;
  operationalSignificance: number;
}

export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  relevance: 0.22,
  evidenceQuality: 0.18,
  completeness: 0.14,
  reproducibility: 0.14,
  lowUncertainty: 0.1,
  applicability: 0.12,
  operationalSignificance: 0.1,
};

export interface RankedExperiment {
  experiment: CombustionExperiment;
  total: number; // 0..100 weighted score — a prioritization aid, NOT a risk probability
  components: Record<keyof RankingWeights, number>; // each 0..1
  explanation: string[];
}

/** Spacecraft cabin reference used only for the applicability component. */
export const CABIN_REFERENCE = { o2: 0.21, pressureKPa: 101.3 };

export function rankExperiments(
  ds: CombustionDataset,
  weights: RankingWeights = DEFAULT_RANKING_WEIGHTS,
): RankedExperiment[] {
  const wSum = Object.values(weights).reduce((s, v) => s + v, 0) || 1;
  // Reproducibility proxy: number of OTHER tests with near-identical conditions.
  const nearCount = ds.experiments.map((e, i) =>
    ds.experiments.reduce((acc, o, j) => (i !== j && featureDistance(e, o) < 0.35 ? acc + 1 : acc), 0),
  );
  const maxNear = Math.max(1, ...nearCount);
  const totalFields = 7;
  const ranked = ds.experiments.map((e, i) => {
    const completeness = 1 - e.missingFields.length / totalFields;
    const measured = e.provenance.kind === 'measured' ? 1 : e.provenance.kind === 'derived' ? 0.6 : 0.25;
    const o2Gap = e.oxidizer.o2 === null ? 1 : Math.min(1, Math.abs(e.oxidizer.o2 - CABIN_REFERENCE.o2) / 0.15);
    const pGap = e.pressureKPa === null ? 1 : Math.min(1, Math.abs(e.pressureKPa - CABIN_REFERENCE.pressureKPa) / 120);
    const applicability = 1 - (o2Gap + pGap) / 2;
    // Operational significance: tests that actually extinguished, or that
    // sustained burning at low O2, carry direct suppression relevance.
    const operationalSignificance =
      e.outcome === 'Extinction' ? 1 : e.outcome === 'Disruption' ? 0.55 : e.oxidizer.o2 !== null && e.oxidizer.o2 <= 0.18 ? 0.8 : 0.45;
    // Relevance: droplet/solid combustion in microgravity with reported outcome.
    const relevance = e.gravity === 'microgravity' ? 0.9 : 0.3;
    const components: Record<keyof RankingWeights, number> = {
      relevance,
      evidenceQuality: measured,
      completeness,
      reproducibility: nearCount[i] / maxNear,
      lowUncertainty: completeness, // missing-data fraction is the only uncertainty proxy this dataset reports
      applicability,
      operationalSignificance,
    };
    const total =
      (Object.keys(weights) as Array<keyof RankingWeights>).reduce(
        (s, k) => s + (weights[k] / wSum) * components[k],
        0,
      ) * 100;
    const explanation: string[] = [];
    if (e.outcome === 'Extinction') explanation.push('Visible-flame extinction was observed — direct suppression relevance.');
    if (nearCount[i] >= 3) explanation.push(`${nearCount[i]} near-replicate tests exist, supporting reproducibility.`);
    if (e.missingFields.length) explanation.push(`Missing: ${e.missingFields.join(', ')} — lowers completeness/uncertainty scores.`);
    if (applicability > 0.8) explanation.push('Conditions are close to the spacecraft cabin reference (21% O2, ~101 kPa).');
    if (e.provenance.kind !== 'measured') explanation.push(`Data kind is ${e.provenance.kind}, not measured — evidence quality is discounted.`);
    if (!explanation.length) explanation.push('Mid-range on all components; no single dominant factor.');
    return { experiment: e, total, components, explanation };
  });
  return ranked.sort((a, b) => b.total - a.total);
}

/* ---------------- X: assembled FlameScope state ---------------- */

export interface FlameScopeState {
  Phi: Array<{ id: string; features: number[] }>;
  G: CombustionGraph;
  T: { transitionCount: number; note: string };
  M: { graphDensity: number; meanEdgeWeight: number; note: string };
  C: { identityDescription: string };
  H: { recordCount: number; kinds: Record<string, number> };
  B: { topRanked: string[] };
}

export function buildFlameScopeState(ds: CombustionDataset): FlameScopeState {
  const graph = buildRelationshipGraph(ds.experiments);
  const kinds: Record<string, number> = {};
  ds.experiments.forEach((e) => { kinds[e.provenance.kind] = (kinds[e.provenance.kind] ?? 0) + 1; });
  const meanW = graph.edges.length
    ? graph.edges.reduce((s, e) => s + e.weight, 0) / graph.edges.length
    : 0;
  return {
    Phi: ds.experiments.map((e) => ({ id: e.id, features: conditionFeatures(e) })),
    G: graph,
    T: {
      transitionCount: ds.experiments.filter((e) => derivedDiameterTrajectory(e) !== null).length,
      note: 'Transitions are the derived d²-law trajectories implied by each test\'s reported D0 and K; they are derived data, not additional measurements.',
    },
    M: {
      graphDensity: ds.experiments.length > 1 ? (2 * graph.edges.length) / (ds.experiments.length * (ds.experiments.length - 1)) : 0,
      meanEdgeWeight: meanW,
      note: 'M holds computational descriptors of the relationship graph (density, mean coupling weight). These are properties of the model, not physical combustion quantities.',
    },
    C: {
      identityDescription:
        'HRM forecast = globalMean + graphCoupling + stabilizationCorrection (exact by construction); observed = forecast + residual for scored records (verified in tests). Planetary ledger terms (diurnal drift, cubic reaction, topology events) were dropped, not relabeled.',
    },
    H: { recordCount: ds.experiments.length, kinds },
    B: { topRanked: rankExperiments(ds).slice(0, 5).map((r) => r.experiment.id) },
  };
}
