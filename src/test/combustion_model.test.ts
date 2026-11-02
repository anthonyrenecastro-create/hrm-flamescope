import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { adaptFlexCsv } from '../engine/combustionData';
import { generateSyntheticDataset } from '../engine/syntheticCombustion';
import {
  runCombustionComparison,
  splitTrainTest,
  predictHrmGraph,
  rankExperiments,
  derivedDiameterTrajectory,
  buildRelationshipGraph,
  DEFAULT_RANKING_WEIGHTS,
} from '../engine/combustionModel';
import { CombustionExperiment } from '../types/combustion';

const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/flex_table_ix.csv');
const flex = adaptFlexCsv(readFileSync(csvPath, 'utf-8')).dataset;

describe('FlameScope HRM combustion model', () => {
  it('split is deterministic and disjoint', () => {
    const a = splitTrainTest(flex.experiments, 0.25, 42);
    const b = splitTrainTest(flex.experiments, 0.25, 42);
    expect(a.test.map((e) => e.id)).toEqual(b.test.map((e) => e.id));
    const trainIds = new Set(a.train.map((e) => e.id));
    expect(a.test.every((e) => !trainIds.has(e.id))).toBe(true);
  });

  it('comparison runs on held-out FLEX data with finite metrics and an honest winner field', () => {
    const report = runCombustionComparison(flex);
    expect(report.testCount).toBeGreaterThan(40);
    expect(report.trainCount + report.testCount).toBe(260); // 276 - 16 missing burning rate
    for (const s of report.scores) {
      expect(Number.isFinite(s.mae)).toBe(true);
      expect(Number.isFinite(s.rmse)).toBe(true);
      expect(s.n).toBe(report.testCount);
    }
    expect(report.scores.map((s) => s.model)).toContain(report.winner);
    expect(report.datasetKind).toBe('measured');
  });

  it('HRM ledger identity holds exactly and scored residuals reconcile', () => {
    const report = runCombustionComparison(flex);
    expect(report.hrmLedgerIdentityRate).toBe(1);
    expect(report.hrmScoredResidualCheck).toBe(true);
  });

  it('leakage: mutating a held-out target value cannot change its prediction', () => {
    const scorable = flex.experiments.filter((e) => e.burningRateMm2PerS !== null);
    const { train, test } = splitTrainTest(scorable, 0.25, 42);
    const target = test[0];
    const before = predictHrmGraph(train, target).predicted;
    const mutated: CombustionExperiment = { ...target, burningRateMm2PerS: 9.99 };
    const after = predictHrmGraph(train, mutated).predicted;
    expect(after).toBe(before);
  });

  it('all model predictions and trajectory values remain finite', () => {
    const report = runCombustionComparison(flex);
    for (const s of report.scores) {
      for (const r of s.residuals) {
        expect(Number.isFinite(r.predicted)).toBe(true);
        expect(Number.isFinite(r.residual)).toBe(true);
      }
    }
    const traj = derivedDiameterTrajectory(flex.experiments[0]);
    expect(traj).not.toBeNull();
    expect(traj!.every((p) => Number.isFinite(p.diameterMm) && p.diameterMm >= 0)).toBe(true);
    // d²-law: trajectory ends at the reported extinction diameter for FLEX-001
    expect(traj![traj!.length - 1].diameterMm).toBeCloseTo(0.89, 6);
  });

  it('relationship graph edges only encode declared relations', () => {
    const g = buildRelationshipGraph(flex.experiments.slice(0, 30));
    expect(g.semantics).toContain('not physical transport');
    for (const e of g.edges) expect(e.relations).toContain('comparable-conditions');
  });

  it('ranking is transparent, bounded, and weight-sensitive', () => {
    const ranked = rankExperiments(flex);
    expect(ranked.length).toBe(276);
    for (const r of ranked) {
      expect(r.total).toBeGreaterThanOrEqual(0);
      expect(r.total).toBeLessThanOrEqual(100);
      expect(Object.keys(r.components)).toEqual(Object.keys(DEFAULT_RANKING_WEIGHTS));
      expect(r.explanation.length).toBeGreaterThan(0);
    }
    const alt = rankExperiments(flex, { ...DEFAULT_RANKING_WEIGHTS, completeness: 0.5, relevance: 0 });
    expect(alt[0].experiment.id).not.toBeUndefined();
    // sorted descending
    for (let i = 1; i < ranked.length; i++) expect(ranked[i - 1].total).toBeGreaterThanOrEqual(ranked[i].total);
  });

  it('synthetic dataset is labeled synthetic everywhere and never measured', () => {
    const synth = generateSyntheticDataset(7, 20);
    expect(synth.kind).toBe('synthetic-demo');
    expect(synth.experiments.every((e) => e.provenance.kind === 'synthetic-demo')).toBe(true);
    const report = runCombustionComparison(synth);
    expect(report.notes).toContain('SYNTHETIC');
  });
});
