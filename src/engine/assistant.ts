/**
 * FlameScope evidence-grounded assistant.
 *
 * Rules enforced by construction:
 * - Every empirical statement in an answer carries an evidence id [E#].
 * - Evidence comes only from (a) curated source cards whose text was
 *   taken from the cited NASA documents, or (b) statistics computed
 *   live from the currently loaded dataset (labeled derived).
 * - When retrieval finds nothing adequate, the assistant says so and
 *   names the gap instead of extrapolating.
 * - Optional Gemini phrasing happens server-side (see server.ts
 *   /api/assistant/ask); the client validates that returned text still
 *   cites known evidence ids before displaying it as grounded.
 */
import { CombustionDataset } from '../types/combustion';
import { computeDatasetStats } from './combustionData';
import { runCombustionComparison } from './combustionModel';
import { CAMPAIGNS, FLEX_TP_URL, CHALLENGE_URL } from '../data/campaigns';

export interface Evidence {
  id: string;
  text: string;
  sourceTitle: string;
  sourceUrl: string;
  kind: 'document' | 'dataset-derived';
}

export const DOCUMENT_EVIDENCE: Evidence[] = [
  {
    id: 'E1',
    text: 'The Flame Extinguishment Experiment (FLEX) aims to map the flammability limits of liquid fuels in microgravity, measure the effectiveness of gaseous fire suppressants such as CO2, He, and SF6, and develop predictive models for combustion limits under reduced gravity.',
    sourceTitle: 'NASA Physical Sciences Informatics (PSI), FLEX investigation PSI-69',
    sourceUrl: 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-69',
    kind: 'document',
  },
  {
    id: 'E2',
    text: 'FLEX was performed with the Multi-User Droplet Combustion Apparatus (MDCA) inside the Combustion Integrated Rack (CIR) in the Destiny module of the ISS. Its results table (Table IX) reports each test\'s fuel, ambient pressure, ambient composition (O2, N2, CO2, He mole fractions), initial droplet diameter, visible-flame extinction diameter, average burning-rate constant (the slope of a linear fit of droplet diameter squared versus time), and burn time.',
    sourceTitle: 'Dietrich et al., NASA/TP-2015-216046 (NTRS 20150023456)',
    sourceUrl: FLEX_TP_URL,
    kind: 'document',
  },
  {
    id: 'E3',
    text: 'FLEX led to the discovery of a type of cool flame, in which fuel continued to burn under certain conditions after extinction of the visible flame. FLEX-2 went on to study how quickly fuel droplets burn, conditions for soot formation, and evaporation of liquid fuel mixtures.',
    sourceTitle: 'NASA — Studying Combustion and Fire Safety (ISS research)',
    sourceUrl: 'https://www.nasa.gov/missions/station/iss-research/studying-combustion-and-fire-safety/',
    kind: 'document',
  },
  {
    id: 'E4',
    text: 'NASA\'s Physical Sciences Informatics system hosts combustion investigations including BASS (Burning and Suppression of Solids), FLEX, SAME, SLICE, and SPICE; the Combustion Integrated Rack also supports the ACME (Advanced Combustion via Microgravity Experiments) insert.',
    sourceTitle: 'NASA PSI Appendix C solicitation NNH15ZTT001N-15PSI_C; NASA ISS combustion research page',
    sourceUrl: 'https://psi.nasa.gov',
    kind: 'document',
  },
  {
    id: 'E5',
    text: 'The NASA Space Apps Challenge 2026 "Flame in Freefall" challenge asks teams to build AI-powered fire-safety insights from microgravity combustion data. FlameScope is an independent project built for that challenge; it is not endorsed by NASA.',
    sourceTitle: 'NASA Space Apps Challenge 2026 — Flame in Freefall',
    sourceUrl: CHALLENGE_URL,
    kind: 'document',
  },
];

/** Derived evidence computed live from the loaded dataset. */
export function datasetEvidence(ds: CombustionDataset): Evidence[] {
  const s = computeDatasetStats(ds);
  const ev: Evidence[] = [];
  ev.push({
    id: 'D1',
    text: `The loaded dataset "${ds.title}" contains ${s.total} tests (${Object.entries(s.byFuel).map(([f, n]) => `${f}: ${n}`).join(', ')}). Outcomes: ${Object.entries(s.byOutcome).map(([o, n]) => `${o}: ${n}`).join(', ')}. Data kind: ${ds.kind}.`,
    sourceTitle: ds.title,
    sourceUrl: ds.sourceUrl,
    kind: 'dataset-derived',
  });
  const ext = Object.entries(s.extinctionRateByFuel)
    .map(([f, r]) => `${f} ${(r !== null ? (r * 100).toFixed(0) : 'n/a')}%`)
    .join(', ');
  const mean = Object.entries(s.meanBurningRateByFuel)
    .map(([f, r]) => `${f} ${r !== null ? r.toFixed(3) : 'n/a'} mm²/s`)
    .join(', ');
  ev.push({
    id: 'D2',
    text: `Derived from the loaded dataset: visible-flame extinction outcome rate by fuel — ${ext}. Mean reported burning-rate constant by fuel — ${mean}. O2 mole-fraction range ${s.o2Range ? `${s.o2Range[0]} to ${s.o2Range[1]}` : 'n/a'}; pressure range ${s.pressureKPaRange ? `${s.pressureKPaRange[0].toFixed(1)} to ${s.pressureKPaRange[1].toFixed(1)} kPa` : 'n/a'}. Missing values by field: ${Object.entries(s.missingByField).map(([f, n]) => `${f}: ${n}`).join(', ') || 'none'}.`,
    sourceTitle: `Computed from ${ds.id} at query time`,
    sourceUrl: ds.sourceUrl,
    kind: 'dataset-derived',
  });
  return ev;
}

export interface AssistantAnswer {
  answer: string;
  evidence: Evidence[];
  /** Citation ids actually used in the answer text. */
  citedIds: string[];
  /** True when retrieval was too weak to support an empirical answer. */
  insufficientEvidence: boolean;
  gaps: string[];
}

const KEYWORD_MAP: Array<{ keys: string[]; evidenceIds: string[] }> = [
  { keys: ['cool flame', 'cool flames'], evidenceIds: ['E3', 'E1'] },
  { keys: ['suppress', 'extinguish', 'extinction', 'went out'], evidenceIds: ['E1', 'D2'] },
  { keys: ['flex', 'droplet'], evidenceIds: ['E1', 'E2', 'D1'] },
  { keys: ['bass', 'acme', 'cfi', 'campaign', 'experiment'], evidenceIds: ['E4', 'D1'] },
  { keys: ['burning rate', 'burn rate', 'burns', 'combustion behavior', 'behaviour'], evidenceIds: ['E2', 'D2'] },
  { keys: ['missing', 'gap', 'improve', 'need'], evidenceIds: ['D2'] },
  { keys: ['challenge', 'space apps', 'nasa endorsement', 'endorsed'], evidenceIds: ['E5'] },
];

export function retrieveEvidence(question: string, ds: CombustionDataset): Evidence[] {
  const q = question.toLowerCase();
  const all = [...DOCUMENT_EVIDENCE, ...datasetEvidence(ds)];
  const picked = new Map<string, Evidence>();
  for (const rule of KEYWORD_MAP) {
    if (rule.keys.some((k) => q.includes(k))) {
      rule.evidenceIds.forEach((id) => {
        const e = all.find((x) => x.id === id);
        if (e) picked.set(id, e);
      });
    }
  }
  return [...picked.values()];
}

/**
 * Offline, extractive answer composition: it assembles retrieved
 * evidence into an answer. It adds no facts of its own; connective
 * text is non-empirical framing.
 */
export function answerQuestion(question: string, ds: CombustionDataset): AssistantAnswer {
  const q = question.toLowerCase();
  const gaps: string[] = [];

  // Gravity comparison: the bundled measured data are microgravity-only.
  if ((q.includes('gravity') && (q.includes('differ') || q.includes('compare') || q.includes('normal'))) || q.includes('1-g') || q.includes('1g')) {
    const ev = retrieveEvidence(question, ds);
    gaps.push('No directly comparable normal-gravity droplet dataset is bundled, so a controlled microgravity-vs-1g comparison cannot be computed here; configuration differences (fuel, O2, pressure, droplet size) would confound any informal comparison.');
    return {
      answer:
        'The bundled measured dataset is microgravity-only, so I cannot run a controlled gravity comparison from it. What the sources do establish: FLEX mapped flammability limits and suppressant effectiveness specifically under reduced gravity [E1], and it revealed cool-flame burning after visible-flame extinction — a phenomenon first observed in these microgravity tests [E3]. Any stronger claim about how behavior differs from 1-g would need a matched ground dataset, which is a named gap below.',
      evidence: ev.length ? ev : DOCUMENT_EVIDENCE.filter((e) => ['E1', 'E3'].includes(e.id)),
      citedIds: ['E1', 'E3'],
      insufficientEvidence: true,
      gaps,
    };
  }

  // Model disagreement: compute the live comparison.
  if (q.includes('hrm') && (q.includes('disagree') || q.includes('predict') || q.includes('baseline') || q.includes('performance'))) {
    if (ds.experiments.length < 12) {
      return {
        answer: 'The loaded dataset is too small to run a leakage-safe held-out comparison (fewer than 12 scorable tests). Load the FLEX dataset or a larger upload to use the Model Performance Laboratory.',
        evidence: [],
        citedIds: [],
        insufficientEvidence: true,
        gaps: ['A held-out model comparison needs at least ~12 tests with reported burning rates.'],
      };
    }
    const report = runCombustionComparison(ds);
    const hrm = report.scores[0];
    const worst = [...hrm.residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 3);
    const lines = report.scores.map((s) => `${s.model}: MAE ${s.mae.toFixed(4)} mm²/s (n=${s.n})`).join('; ');
    return {
      answer:
        `On held-out tests from "${ds.title}" (train ${report.trainCount} / test ${report.testCount}, seed ${report.seed}): ${lines}. Best MAE: ${report.winner}. HRM's largest absolute residuals are on ${worst.map((r) => `${r.experimentId} (observed ${r.observed.toFixed(3)}, predicted ${r.predicted.toFixed(3)})`).join(', ')}. These figures are computed from the loaded dataset at query time [D2] and the comparison task is defined in the Model Performance Laboratory.`,
      evidence: datasetEvidence(ds),
      citedIds: ['D2'],
      insufficientEvidence: false,
      gaps: [],
    };
  }

  const ev = retrieveEvidence(question, ds);
  if (ev.length === 0) {
    return {
      answer:
        'I do not have retrieved evidence that supports an empirical answer to that question. I can answer questions about the FLEX dataset and its statistics, extinction and suppression findings, cool flames, the registered campaigns (FLEX, BASS, ACME, CFI-G), missing measurements, and where the HRM model disagrees with measured outcomes.',
      evidence: [],
      citedIds: [],
      insufficientEvidence: true,
      gaps: ['No matching evidence cards or dataset statistics for this question.'],
    };
  }
  const citedIds = ev.map((e) => e.id);
  const body = ev.map((e) => `${e.text} [${e.id}]`).join('\n\n');
  return {
    answer: body,
    evidence: ev,
    citedIds,
    insufficientEvidence: false,
    gaps: q.includes('missing') || q.includes('gap')
      ? ['Flame temperature is not reported in the FLEX Table IX extract, so temperature-dependent analysis is not possible from this dataset. BASS, ACME, and CFI-G measurements are registered but not yet ingested in machine-readable form.']
      : [],
  };
}

/** Validates that a (possibly Gemini-phrased) answer cites only known ids and cites at least one. */
export function validateCitations(text: string, known: Evidence[]): { ok: boolean; unknownIds: string[]; citedIds: string[] } {
  const found = [...text.matchAll(/\[([A-Z]\d+)\]/g)].map((m) => m[1]);
  const knownIds = new Set(known.map((e) => e.id));
  const unknownIds = [...new Set(found.filter((id) => !knownIds.has(id)))];
  return { ok: found.length > 0 && unknownIds.length === 0, unknownIds, citedIds: [...new Set(found)] };
}

export function campaignSummary(): string {
  return CAMPAIGNS.map(
    (c) => `${c.name} (${c.fullName}) — ${c.status === 'ingested' ? 'measurements ingested' : 'metadata only, no measurements bundled'}.`,
  ).join(' ');
}
