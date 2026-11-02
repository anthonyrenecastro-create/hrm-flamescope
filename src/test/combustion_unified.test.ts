import { describe, expect, it } from 'vitest';
import flexText from '../data/flex_table_ix.csv?raw';
import { adaptFlexCsv } from '../engine/combustionData';
import { contextPrediction, runCombustionComparison } from '../engine/combustionModel';
import {
  legendFor, nodeColor, nodeOpacity, nodeRadius, o2Color, outcomeColor, residualColor, spherePosition,
} from '../engine/visualEncoding';
import { answerExperimentQuestion, experimentEvidence } from '../engine/assistant';

const { dataset } = adaptFlexCsv(flexText);

describe('visual-to-data consistency: encodings are pure functions of the data', () => {
  it('outcome colors differ per outcome class and are stable', () => {
    const ext = dataset.experiments.find((e) => e.outcome === 'Extinction')!;
    const comp = dataset.experiments.find((e) => e.outcome === 'Completion')!;
    expect(outcomeColor(ext)).not.toBe(outcomeColor(comp));
    expect(nodeColor(ext, 'outcome', new Map())).toBe(outcomeColor(ext));
  });

  it('O2 color is missing-safe and interpolates across the air-like point', () => {
    expect(o2Color(null)).toBe('#64748b');
    expect(o2Color(0.12)).not.toBe(o2Color(0.21));
    expect(o2Color(0.21)).not.toBe(o2Color(0.28));
  });

  it('radius increases with D0; opacity increases with completeness', () => {
    const big = dataset.experiments.reduce((a, b) => ((a.initialDiameterMm ?? 0) > (b.initialDiameterMm ?? 0) ? a : b));
    const small = dataset.experiments.find((e) => e.initialDiameterMm !== null && e.initialDiameterMm < 1.6)!;
    expect(nodeRadius(big)).toBeGreaterThan(nodeRadius(small));
    const incomplete = dataset.experiments.find((e) => e.missingFields.length >= 2)!;
    const complete = dataset.experiments.find((e) => e.missingFields.length === 0)!;
    expect(nodeOpacity(incomplete)).toBeLessThan(nodeOpacity(complete));
  });

  it('residual encoding marks experiments outside the held-out set distinctly', () => {
    expect(residualColor(null)).toBe('#475569');
    expect(residualColor(0)).not.toBe(residualColor(0.2));
    const report = runCombustionComparison(dataset);
    const map = new Map(report.scores[0].residuals.map((r) => [r.experimentId, r.residual]));
    expect(map.size).toBe(report.testCount);
  });

  it('every encoding has a legend and the layout is deterministic', () => {
    for (const enc of ['outcome', 'o2', 'fuel', 'residual'] as const) {
      expect(legendFor(enc).length).toBeGreaterThanOrEqual(3);
    }
    expect(spherePosition(5, 100)).toEqual(spherePosition(5, 100));
    const p = spherePosition(5, 100);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(1, 6);
  });

  it('comparison report now carries HRM predictions with ledgers for the ledger overlay', () => {
    const report = runCombustionComparison(dataset);
    expect(report.hrmPredictions).toHaveLength(report.testCount);
    for (const p of report.hrmPredictions) {
      expect(p.ledger).not.toBeNull();
      expect(p.ledger!.identityHolds).toBe(true);
    }
  });
});

describe('unified state: leave-one-out context prediction for the selected node', () => {
  it('excludes the target record itself (mutating its K does not change its prediction)', () => {
    const target = dataset.experiments.find((e) => e.burningRateMm2PerS !== null)!;
    const before = contextPrediction(dataset, target);
    const mutated = { ...dataset, experiments: dataset.experiments.map((e) => (e.id === target.id ? { ...e, burningRateMm2PerS: 99 } : e)) };
    const targetMutated = mutated.experiments.find((e) => e.id === target.id)!;
    const after = contextPrediction(mutated, targetMutated);
    expect(after.prediction.predicted).toBeCloseTo(before.prediction.predicted, 10);
  });

  it('returns observed and residual when K is reported, nulls when not', () => {
    const withK = dataset.experiments.find((e) => e.burningRateMm2PerS !== null)!;
    const ctx = contextPrediction(dataset, withK);
    expect(ctx.observed).toBe(withK.burningRateMm2PerS);
    expect(Math.abs(ctx.residual! - (ctx.observed! - ctx.prediction.predicted))).toBeLessThan(1e-9);
    const withoutK = dataset.experiments.find((e) => e.burningRateMm2PerS === null);
    if (withoutK) {
      const ctx2 = contextPrediction(dataset, withoutK);
      expect(ctx2.observed).toBeNull();
      expect(ctx2.residual).toBeNull();
    }
  });
});

describe('assistant is manifold-context aware', () => {
  it('experiment evidence carries the record values and provenance', () => {
    const e = dataset.experiments[0];
    const ev = experimentEvidence(e);
    expect(ev.id).toBe('D3');
    expect(ev.text).toContain(e.id);
    expect(ev.text).toContain(e.fuel);
  });

  it('"what happened" answers from the record with a [D3] citation', () => {
    const e = dataset.experiments[0];
    const a = answerExperimentQuestion('What happened during this experimental run?', e, dataset);
    expect(a.citedIds).toContain('D3');
    expect(a.answer).toContain(e.id);
    expect(a.answer).toContain('[D3]');
  });

  it('"what is missing" lists exactly the record missing fields', () => {
    const e = dataset.experiments.find((x) => x.missingFields.length > 0)!;
    const a = answerExperimentQuestion('What information is missing?', e, dataset);
    for (const f of e.missingFields) expect(a.answer).toContain(f);
  });
});
