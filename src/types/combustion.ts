/**
 * HRM FlameScope — Combustion domain model.
 *
 * Design rules (from the adaptation spec):
 * - Variable-length measurements: every field is optional; unknown is
 *   represented as `null` (missing), NEVER as 0.
 * - Every observation carries provenance: source institution, document /
 *   dataset URL, and a kind tag distinguishing measured / derived /
 *   simulated / synthetic-demonstration data.
 * - Units are explicit on every measurement and conversions are only
 *   applied where physically meaningful (see engine/combustionData.ts).
 */

export type DataKind = 'measured' | 'derived' | 'simulated' | 'synthetic-demo';

export type GravityEnvironment = 'microgravity' | 'normal-gravity' | 'partial-gravity' | 'unknown';

export interface Provenance {
  kind: DataKind;
  /** e.g. "NASA Glenn Research Center" */
  institution: string;
  /** Human-readable source document / dataset title. */
  sourceTitle: string;
  /** Canonical URL of the source document or dataset. */
  sourceUrl: string;
  /** Dataset identifier, e.g. "NASA/TP-2015-216046 Table IX" or "PSI-69". */
  datasetId: string;
  /** How the record entered FlameScope (adapter name + verification note). */
  ingestionNote: string;
}

/**
 * A single experimental run (one row of an experiment table, or one
 * time-resolved test). Fields are SI-canonical where a canonical unit
 * exists in this model; the original reported unit is preserved in
 * `reportedUnits` when a conversion was applied.
 */
export interface CombustionExperiment {
  /** Stable id inside FlameScope, e.g. "FLEX-001" or "SYNTH-0007". */
  id: string;
  /** Identifier used by the source facility, e.g. CIR identifier "20CAL08". */
  sourceIdentifier: string;
  campaign: string; // 'FLEX' | 'BASS' | 'ACME' | 'CFI-G' | 'SYNTHETIC-DEMO' | string
  /** ISO date (yyyy-mm-dd) when known; experimental time otherwise null. */
  dateISO: string | null;
  fuel: string;
  /** Oxidizer / diluent mole fractions (0..1). Missing species are null. */
  oxidizer: {
    o2: number | null;
    n2: number | null;
    co2: number | null;
    he: number | null;
  };
  gravity: GravityEnvironment;
  /** Ambient pressure, kPa (canonical). Null when unreported. */
  pressureKPa: number | null;
  /** Initial droplet diameter / characteristic length, mm. */
  initialDiameterMm: number | null;
  /** Visible-flame extinction diameter, mm. Null = did not occur / unreported. */
  extinctionDiameterMm: number | null;
  /** Burning-rate constant K in the d²-law (mm²/s). */
  burningRateMm2PerS: number | null;
  /** Total burn time, s. */
  burnTimeS: number | null;
  /** Flame temperature, K, when a dataset reports it. */
  flameTemperatureK: number | null;
  /** How the test ended, in the source's own categories. */
  outcome: 'Extinction' | 'Disruption' | 'Completion' | 'Unknown';
  provenance: Provenance;
  /** Names of measurement fields that are missing for this record. */
  missingFields: string[];
}

/** A named dataset: a set of experiments sharing one provenance frame. */
export interface CombustionDataset {
  id: string;
  title: string;
  kind: DataKind;
  institution: string;
  sourceUrl: string;
  description: string;
  experiments: CombustionExperiment[];
  /** Fields present in >= 1 record; used for completeness scoring. */
  availableFields: string[];
}

/** The full field list this model knows how to carry. */
export const COMBUSTION_FIELDS = [
  'pressureKPa',
  'initialDiameterMm',
  'extinctionDiameterMm',
  'burningRateMm2PerS',
  'burnTimeS',
  'flameTemperatureK',
  'o2',
] as const;
export type CombustionField = (typeof COMBUSTION_FIELDS)[number];

/** Physical plausibility bounds used by validation (not physical laws). */
export const FIELD_BOUNDS: Record<string, { min: number; max: number; unit: string }> = {
  pressureKPa: { min: 1, max: 1000, unit: 'kPa' },
  initialDiameterMm: { min: 0.05, max: 50, unit: 'mm' },
  extinctionDiameterMm: { min: 0, max: 50, unit: 'mm' },
  burningRateMm2PerS: { min: 0.001, max: 10, unit: 'mm²/s' },
  burnTimeS: { min: 0.01, max: 3600, unit: 's' },
  flameTemperatureK: { min: 200, max: 4000, unit: 'K' },
  o2: { min: 0, max: 1, unit: 'mole fraction' },
};
