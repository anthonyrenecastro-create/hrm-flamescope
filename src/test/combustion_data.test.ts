import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import {
  adaptFlexCsv,
  adaptGenericCsv,
  mmHgToKPa,
  percentToFraction,
  validateFieldValue,
  computeDatasetStats,
} from '../engine/combustionData';

const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/flex_table_ix.csv');
const flexCsv = readFileSync(csvPath, 'utf-8');

describe('FlameScope combustion data integrity (real NASA FLEX Table IX)', () => {
  const { dataset, issues } = adaptFlexCsv(flexCsv);

  it('loads all 276 FLEX tests with measured provenance', () => {
    expect(dataset.experiments.length).toBe(276);
    expect(dataset.kind).toBe('measured');
    expect(dataset.experiments[0].provenance.datasetId).toContain('NASA/TP-2015-216046');
    expect(dataset.experiments[0].id).toBe('FLEX-001');
    expect(dataset.experiments[0].sourceIdentifier).toBe('20CAL08');
  });

  it('matches the values printed in the NASA report for the first test', () => {
    const first = dataset.experiments[0];
    expect(first.fuel).toBe('Methanol');
    expect(first.initialDiameterMm).toBeCloseTo(1.69, 6);
    expect(first.extinctionDiameterMm).toBeCloseTo(0.89, 6);
    expect(first.burningRateMm2PerS).toBeCloseTo(0.52, 6);
    // 757.7 mmHg in the report -> kPa by exact conversion
    expect(first.pressureKPa).toBeCloseTo(757.7 * 0.133322, 4);
  });

  it('keeps missing values missing (never zero-filled)', () => {
    const stats = computeDatasetStats(dataset);
    // Source table blanks: ext diameter 78, D0 12, burn rate 16, pressure 1
    expect(stats.missingByField['extinctionDiameterMm']).toBe(78);
    expect(stats.missingByField['initialDiameterMm']).toBe(12);
    expect(stats.missingByField['burningRateMm2PerS']).toBe(16);
    for (const e of dataset.experiments) {
      for (const f of e.missingFields) {
        const v = (e as unknown as Record<string, unknown>)[f];
        if (v !== undefined) expect(v).toBeNull();
      }
    }
  });

  it('produces no validation issues on the real table and preserves provenance through stats', () => {
    expect(issues).toEqual([]);
    const stats = computeDatasetStats(dataset);
    expect(stats.byFuel).toEqual({ Methanol: 157, Heptane: 119 });
    expect(stats.byOutcome['Extinction']).toBe(186);
  });

  it('rejects non-finite and out-of-bound values', () => {
    expect(validateFieldValue('burningRateMm2PerS', NaN)).toBeTruthy();
    expect(validateFieldValue('burningRateMm2PerS', Infinity)).toBeTruthy();
    expect(validateFieldValue('pressureKPa', -5)).toBeTruthy();
    expect(validateFieldValue('flameTemperatureK', 99999)).toBeTruthy();
    expect(validateFieldValue('burningRateMm2PerS', null)).toBeNull(); // missing is allowed
    expect(validateFieldValue('burningRateMm2PerS', 0.5)).toBeNull();
  });

  it('unit conversions are exact and reversible', () => {
    expect(mmHgToKPa(760)).toBeCloseTo(101.32472, 4);
    expect(percentToFraction(21)).toBeCloseTo(0.21, 10);
  });

  it('upload adapter refuses oversize payloads and unknown layouts', () => {
    expect(() => adaptGenericCsv('x'.repeat(2_000_001), {
      kind: 'measured', institution: 't', sourceTitle: 't', sourceUrl: '', datasetId: 't', ingestionNote: 't',
    }, 't')).toThrow(/upload limit/);
    expect(adaptGenericCsv('a,b\n1,2', {
      kind: 'measured', institution: 't', sourceTitle: 't', sourceUrl: '', datasetId: 't', ingestionNote: 't',
    }, 't')).toBeNull();
  });
});
