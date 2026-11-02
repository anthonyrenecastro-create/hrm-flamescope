/**
 * Registry of NASA microgravity combustion campaigns relevant to
 * FlameScope. Only FLEX has machine-readable measurements ingested at
 * this time; the others are registered as metadata with authoritative
 * citations and an explicit "not ingested" status. Nothing here invents
 * measurements for them.
 */

export interface CampaignInfo {
  id: string;
  name: string;
  fullName: string;
  facility: string;
  gravity: 'microgravity';
  status: 'ingested' | 'metadata-only';
  description: string;
  sourceTitle: string;
  sourceUrl: string;
}

export const FLEX_TP_URL = 'https://ntrs.nasa.gov/citations/20150023456';
export const FLEX_PSI_URL = 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-69';
export const CHALLENGE_URL = 'https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/';

export const CAMPAIGNS: CampaignInfo[] = [
  {
    id: 'FLEX',
    name: 'FLEX',
    fullName: 'Flame Extinguishment Experiment',
    facility: 'ISS Combustion Integrated Rack (CIR) / Multi-User Droplet Combustion Apparatus (MDCA)',
    gravity: 'microgravity',
    status: 'ingested',
    description:
      'Droplet combustion tests mapping flammability limits of liquid fuels in microgravity and the effectiveness of gaseous suppressants (CO2, He, SF6). Table IX of NASA/TP-2015-216046 reports 276 tests (methanol and heptane, Mar 2009 – Dec 2011). FLEX also led to the discovery of cool flames: fuel continuing to burn in a low-temperature regime after visible-flame extinction.',
    sourceTitle: 'Dietrich et al., Detailed Results from the Flame Extinguishment Experiment (FLEX), NASA/TP-2015-216046',
    sourceUrl: FLEX_TP_URL,
  },
  {
    id: 'BASS',
    name: 'BASS',
    fullName: 'Burning and Suppression of Solids',
    facility: 'ISS Combustion Integrated Rack (CIR)',
    gravity: 'microgravity',
    status: 'metadata-only',
    description:
      'Investigates the burning and suppression of solid fuels in microgravity, including flame spread over solid surfaces — directly relevant to spacecraft material flammability. Data reside in the NASA Physical Sciences Informatics (PSI) system; no machine-readable extract is bundled with FlameScope yet.',
    sourceTitle: 'NASA Physical Sciences Informatics (PSI) — Combustion Science investigations',
    sourceUrl: 'https://psi.nasa.gov',
  },
  {
    id: 'ACME',
    name: 'ACME',
    fullName: 'Advanced Combustion via Microgravity Experiments',
    facility: 'ISS Combustion Integrated Rack (CIR), ACME insert',
    gravity: 'microgravity',
    status: 'metadata-only',
    description:
      'A suite of gaseous-fuel combustion experiments in the CIR studying flame structure, soot, and efficiency-relevant phenomena in microgravity. Registered for context and future ingestion; no measurements are bundled yet.',
    sourceTitle: 'NASA — Studying Combustion and Fire Safety (ISS research)',
    sourceUrl: 'https://www.nasa.gov/missions/station/iss-research/studying-combustion-and-fire-safety/',
  },
  {
    id: 'CFI-G',
    name: 'CFI-G',
    fullName: 'Cool Flames Investigation with Gases',
    facility: 'ISS Combustion Integrated Rack (CIR)',
    gravity: 'microgravity',
    status: 'metadata-only',
    description:
      'Investigates cool-flame chemistry with gaseous fuels in microgravity, following up the cool-flame behavior first observed in FLEX droplet tests. Registered for context; no measurements are bundled yet.',
    sourceTitle: 'NASA Physical Sciences Informatics (PSI) — Combustion Science investigations',
    sourceUrl: 'https://psi.nasa.gov',
  },
];
