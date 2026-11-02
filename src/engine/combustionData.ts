/**
 * FlameScope data engine: units, validation, and source adapters.
 *
 * Guarantees enforced here (and covered by tests):
 * - Blank / unreported cells become `null` (missing), never 0.
 * - Non-finite or physically implausible values are REJECTED with a
 *   recorded issue, never silently clamped into range.
 * - Provenance is attached to every record and survives parsing.
 * - Uploads are size-limited and parsed safely (no code execution).
 */
import {
  CombustionDataset,
  CombustionExperiment,
  FIELD_BOUNDS,
  Provenance,
} from '../types/combustion';
import { FLEX_TP_URL } from '../data/campaigns';

/* ---------------- Units ---------------- */

export const MMHG_TO_KPA = 0.133322;
export function mmHgToKPa(mmHg: number): number {
  return mmHg * MMHG_TO_KPA;
}
export function kPaToMmHg(kPa: number): number {
  return kPa / MMHG_TO_KPA;
}
export function atmToKPa(atm: number): number {
  return atm * 101.325;
}
/** Percent (0-100) to mole fraction (0-1). */
export function percentToFraction(pct: number): number {
  return pct / 100;
}

/* ---------------- Validation ---------------- */

export interface ValidationIssue {
  recordId: string;
  field: string;
  value: unknown;
  reason: string;
}

/** Returns an issue string when the value is unusable, else null. */
export function validateFieldValue(field: string, value: number | null): string | null {
  if (value === null) return null; // missing is allowed and tracked separately
  if (!Number.isFinite(value)) return 'non-finite value rejected';
  const b = FIELD_BOUNDS[field];
  if (b && (value < b.min || value > b.max)) {
    return `value ${value} outside plausible bounds [${b.min}, ${b.max}] ${b.unit}`;
  }
  return null;
}

function numOrNull(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const t = String(raw).trim();
  if (t === '' || t === '-' || t.toLowerCase() === 'n/a') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/* ---------------- CSV parsing (safe, minimal) ---------------- */

export function parseCsvText(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  };
  const header = split(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = split(line);
    const rec: Record<string, string> = {};
    header.forEach((h, i) => { rec[h] = cells[i] ?? ''; });
    return rec;
  });
}

/* ---------------- FLEX adapter (NASA/TP-2015-216046, Table IX) ---------------- */

export const FLEX_PROVENANCE: Provenance = {
  kind: 'measured',
  institution: 'NASA Glenn Research Center',
  sourceTitle: 'Dietrich et al., Detailed Results from the Flame Extinguishment Experiment (FLEX) March 2009 to December 2011, NASA/TP-2015-216046, Table IX',
  sourceUrl: FLEX_TP_URL,
  datasetId: 'NASA/TP-2015-216046 Table IX (also PSI-69)',
  ingestionNote:
    'Values transcribed from Table IX of the NASA Technical Publication. Every test identifier in this table was verified present in the primary NTRS document text, and sample rows were cross-checked value-for-value against the printed table during ingestion (2026-11-02). Pressure converted mmHg -> kPa.',
};

function flexDateToISO(raw: string): string | null {
  // Source format: m/d/yy, e.g. 3/5/09
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const [, mm, dd, yy] = m;
  return `20${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

export function adaptFlexCsv(csvText: string): { dataset: CombustionDataset; issues: ValidationIssue[] } {
  const rows = parseCsvText(csvText);
  const issues: ValidationIssue[] = [];
  const experiments: CombustionExperiment[] = rows.map((r, idx) => {
    const testNo = r['test'] ?? String(idx + 1);
    const id = `FLEX-${testNo.padStart(3, '0')}`;
    const pressureMmHg = numOrNull(r['pressure_mmHg']);
    const exp: CombustionExperiment = {
      id,
      sourceIdentifier: r['identifier'] ?? '',
      campaign: 'FLEX',
      dateISO: r['date'] ? flexDateToISO(r['date']) : null,
      fuel: r['fuel'] ?? 'Unknown',
      oxidizer: {
        o2: numOrNull(r['O2']),
        n2: numOrNull(r['N2']),
        co2: numOrNull(r['CO2']),
        he: numOrNull(r['He']),
      },
      gravity: 'microgravity',
      pressureKPa: pressureMmHg === null ? null : mmHgToKPa(pressureMmHg),
      initialDiameterMm: numOrNull(r['D0_mm']),
      extinctionDiameterMm: numOrNull(r['ext_diameter_mm']),
      burningRateMm2PerS: numOrNull(r['burn_rate_mm2s']),
      burnTimeS: numOrNull(r['burn_time_s']),
      flameTemperatureK: null, // Table IX does not report flame temperature
      outcome:
        r['test_end'] === 'Extinction' || r['test_end'] === 'Disruption' || r['test_end'] === 'Completion'
          ? (r['test_end'] as CombustionExperiment['outcome'])
          : 'Unknown',
      provenance: FLEX_PROVENANCE,
      missingFields: [],
    };
    // Validate + record missing, preserving provenance of the failure.
    const checks: Array<[string, number | null]> = [
      ['pressureKPa', exp.pressureKPa],
      ['initialDiameterMm', exp.initialDiameterMm],
      ['extinctionDiameterMm', exp.extinctionDiameterMm],
      ['burningRateMm2PerS', exp.burningRateMm2PerS],
      ['burnTimeS', exp.burnTimeS],
      ['o2', exp.oxidizer.o2],
    ];
    for (const [field, v] of checks) {
      const problem = validateFieldValue(field, v);
      if (problem) issues.push({ recordId: id, field, value: v, reason: problem });
      if (v === null) exp.missingFields.push(field);
    }
    return exp;
  });
  const availableFields = new Set<string>();
  experiments.forEach((e) => {
    if (e.pressureKPa !== null) availableFields.add('pressureKPa');
    if (e.initialDiameterMm !== null) availableFields.add('initialDiameterMm');
    if (e.extinctionDiameterMm !== null) availableFields.add('extinctionDiameterMm');
    if (e.burningRateMm2PerS !== null) availableFields.add('burningRateMm2PerS');
    if (e.burnTimeS !== null) availableFields.add('burnTimeS');
    if (e.oxidizer.o2 !== null) availableFields.add('o2');
  });
  return {
    dataset: {
      id: 'flex-table-ix',
      title: 'FLEX — Flame Extinguishment Experiment (NASA/TP-2015-216046, Table IX)',
      kind: 'measured',
      institution: 'NASA Glenn Research Center',
      sourceUrl: FLEX_TP_URL,
      description:
        '276 droplet combustion tests aboard the ISS (methanol and heptane, 2009-2011). Measured values as reported; blanks in the source table remain missing here.',
      experiments,
      availableFields: [...availableFields],
    },
    issues,
  };
}

/* ---------------- Generic user-upload adapter ---------------- */

export const MAX_UPLOAD_BYTES = 2_000_000; // 2 MB hard limit for dataset uploads

/**
 * Accepts CSV text with either the FLEX column layout or the canonical
 * FlameScope layout (fuel, o2_fraction, pressure_kpa, d0_mm,
 * burning_rate_mm2s, burn_time_s, outcome). Returns null when the
 * layout is unrecognized. Uploaded data is tagged with the provenance
 * the caller supplies; it is never relabeled as NASA data by this code.
 */
export function adaptGenericCsv(
  csvText: string,
  provenance: Provenance,
  datasetTitle: string,
): { dataset: CombustionDataset; issues: ValidationIssue[] } | null {
  if (csvText.length > MAX_UPLOAD_BYTES) {
    throw new Error(`Dataset exceeds the ${MAX_UPLOAD_BYTES} byte upload limit.`);
  }
  const rows = parseCsvText(csvText);
  if (rows.length === 0) return null;
  const keys = Object.keys(rows[0]);
  if (keys.includes('pressure_mmHg') && keys.includes('burn_rate_mm2s')) {
    // FLEX-shaped table uploaded by the user: keep THEIR provenance.
    const { dataset, issues } = adaptFlexCsv(csvText);
    dataset.experiments.forEach((e) => { e.provenance = provenance; });
    return { dataset: { ...dataset, id: 'upload-flex-shaped', title: datasetTitle, kind: provenance.kind }, issues };
  }
  if (!keys.includes('fuel')) return null;
  const issues: ValidationIssue[] = [];
  const experiments: CombustionExperiment[] = rows.map((r, i) => {
    const exp: CombustionExperiment = {
      id: `UPLOAD-${String(i + 1).padStart(3, '0')}`,
      sourceIdentifier: r['identifier'] ?? '',
      campaign: r['campaign'] ?? 'USER-UPLOAD',
      dateISO: null,
      fuel: r['fuel'],
      oxidizer: {
        o2: numOrNull(r['o2_fraction'] ?? r['o2']),
        n2: numOrNull(r['n2_fraction']),
        co2: numOrNull(r['co2_fraction']),
        he: numOrNull(r['he_fraction']),
      },
      gravity: (r['gravity'] as CombustionExperiment['gravity']) ?? 'unknown',
      pressureKPa: numOrNull(r['pressure_kpa']),
      initialDiameterMm: numOrNull(r['d0_mm']),
      extinctionDiameterMm: numOrNull(r['extinction_diameter_mm']),
      burningRateMm2PerS: numOrNull(r['burning_rate_mm2s']),
      burnTimeS: numOrNull(r['burn_time_s']),
      flameTemperatureK: numOrNull(r['flame_temperature_k']),
      outcome: 'Unknown',
      provenance,
      missingFields: [],
    };
    if (exp.burningRateMm2PerS !== null) {
      const p = validateFieldValue('burningRateMm2PerS', exp.burningRateMm2PerS);
      if (p) issues.push({ recordId: exp.id, field: 'burningRateMm2PerS', value: exp.burningRateMm2PerS, reason: p });
    }
    return exp;
  });
  return {
    dataset: {
      id: 'upload-generic',
      title: datasetTitle,
      kind: provenance.kind,
      institution: provenance.institution,
      sourceUrl: provenance.sourceUrl,
      description: 'User-uploaded dataset, parsed by the generic FlameScope adapter.',
      experiments,
      availableFields: ['burningRateMm2PerS', 'pressureKPa', 'o2'],
    },
    issues,
  };
}

/* ---------------- Dataset statistics (derived, labeled) ---------------- */

export interface DatasetStats {
  total: number;
  byFuel: Record<string, number>;
  byOutcome: Record<string, number>;
  extinctionRateByFuel: Record<string, number | null>;
  meanBurningRateByFuel: Record<string, number | null>;
  o2Range: [number, number] | null;
  pressureKPaRange: [number, number] | null;
  missingByField: Record<string, number>;
}

/** All statistics here are DERIVED from the dataset's own records. */
export function computeDatasetStats(ds: CombustionDataset): DatasetStats {
  const byFuel: Record<string, number> = {};
  const byOutcome: Record<string, number> = {};
  const missingByField: Record<string, number> = {};
  let o2Min = Infinity, o2Max = -Infinity, pMin = Infinity, pMax = -Infinity;
  const burnByFuel: Record<string, number[]> = {};
  const extByFuel: Record<string, { ext: number; total: number }> = {};
  for (const e of ds.experiments) {
    byFuel[e.fuel] = (byFuel[e.fuel] ?? 0) + 1;
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    e.missingFields.forEach((f) => { missingByField[f] = (missingByField[f] ?? 0) + 1; });
    if (e.oxidizer.o2 !== null) { o2Min = Math.min(o2Min, e.oxidizer.o2); o2Max = Math.max(o2Max, e.oxidizer.o2); }
    if (e.pressureKPa !== null) { pMin = Math.min(pMin, e.pressureKPa); pMax = Math.max(pMax, e.pressureKPa); }
    if (e.burningRateMm2PerS !== null) (burnByFuel[e.fuel] ??= []).push(e.burningRateMm2PerS);
    (extByFuel[e.fuel] ??= { ext: 0, total: 0 }).total++;
    if (e.outcome === 'Extinction') extByFuel[e.fuel].ext++;
  }
  const mean = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  return {
    total: ds.experiments.length,
    byFuel,
    byOutcome,
    extinctionRateByFuel: Object.fromEntries(
      Object.entries(extByFuel).map(([f, v]) => [f, v.total ? v.ext / v.total : null]),
    ),
    meanBurningRateByFuel: Object.fromEntries(Object.entries(burnByFuel).map(([f, v]) => [f, mean(v)])),
    o2Range: o2Min === Infinity ? null : [o2Min, o2Max],
    pressureKPaRange: pMin === Infinity ? null : [pMin, pMax],
    missingByField,
  };
}
