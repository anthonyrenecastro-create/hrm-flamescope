import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { adaptFlexCsv } from '../engine/combustionData';
import { answerQuestion, validateCitations, DOCUMENT_EVIDENCE } from '../engine/assistant';

const csvPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/flex_table_ix.csv');
const flex = adaptFlexCsv(readFileSync(csvPath, 'utf-8')).dataset;

describe('FlameScope evidence-grounded assistant', () => {
  it('answers the cool-flame question with citations to real sources', () => {
    const a = answerQuestion('What did FLEX discover about cool flames?', flex);
    expect(a.insufficientEvidence).toBe(false);
    expect(a.citedIds).toContain('E3');
    expect(a.answer).toContain('[E3]');
    expect(a.evidence.every((e) => e.sourceUrl.startsWith('https://'))).toBe(true);
  });

  it('refuses a controlled gravity comparison the bundled data cannot support', () => {
    const a = answerQuestion('What combustion behaviors differ between microgravity and normal gravity?', flex);
    expect(a.insufficientEvidence).toBe(true);
    expect(a.gaps.join(' ')).toContain('normal-gravity');
    expect(a.citedIds.length).toBeGreaterThan(0); // still cites what IS known
  });

  it('computes model-disagreement answers from the loaded dataset, with dataset citation', () => {
    const a = answerQuestion('Where do HRM predictions disagree most strongly with measured outcomes?', flex);
    expect(a.insufficientEvidence).toBe(false);
    expect(a.answer).toContain('MAE');
    expect(a.citedIds).toContain('D2');
  });

  it('says so when no evidence matches, instead of extrapolating', () => {
    const a = answerQuestion('What is the best pizza topping for astronauts?', flex);
    expect(a.insufficientEvidence).toBe(true);
    expect(a.answer).toContain('do not have retrieved evidence');
  });

  it('citation validation rejects invented evidence ids and uncited text', () => {
    expect(validateCitations('A claim [E99].', DOCUMENT_EVIDENCE).ok).toBe(false);
    expect(validateCitations('A claim with no citation.', DOCUMENT_EVIDENCE).ok).toBe(false);
    expect(validateCitations('A claim [E1].', DOCUMENT_EVIDENCE).ok).toBe(true);
  });
});
