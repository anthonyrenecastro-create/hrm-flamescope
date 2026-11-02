/**
 * Synthetic demonstration dataset for FlameScope.
 *
 * This generator exists so the application can be demonstrated offline
 * and so the model laboratory has a fully controlled test bed. Every
 * record is tagged kind: 'synthetic-demo'. These values are NOT NASA
 * measurements, are never merged into empirical datasets, and any
 * statistic computed from them must be labeled synthetic.
 *
 * The generator uses a d²-law droplet model with an oxygen-dependent
 * burning-rate constant and a simple radiative-extinction rule. It is a
 * teaching model, not a validated combustion simulation.
 */
import { createMulberry32, createGaussianRNG } from './prng';
import { CombustionDataset, CombustionExperiment, Provenance } from '../types/combustion';

export const SYNTHETIC_PROVENANCE: Provenance = {
  kind: 'synthetic-demo',
  institution: 'Axiom Zeta Innovations LLC (FlameScope demo generator)',
  sourceTitle: 'FlameScope synthetic demonstration generator (seeded, d²-law teaching model)',
  sourceUrl: 'https://www.spaceappschallenge.org/2026/challenges/flame-in-freefall/',
  datasetId: 'FLAMESCOPE-SYNTHETIC-DEMO-v1',
  ingestionNote: 'Generated locally by a seeded PRNG. No measured data involved.',
};

export function generateSyntheticDataset(seed = 2026, count = 60): CombustionDataset {
  const rng = createMulberry32(seed);
  const gauss = createGaussianRNG(rng);
  const fuels = [
    { name: 'Synthetic Methanol-like', baseK: 0.55 },
    { name: 'Synthetic Heptane-like', baseK: 0.75 },
  ];
  const experiments: CombustionExperiment[] = [];
  for (let i = 0; i < count; i++) {
    const fuel = fuels[i % fuels.length];
    const o2 = 0.14 + rng() * 0.14; // 0.14 - 0.28
    const co2 = rng() < 0.4 ? rng() * 0.3 : 0;
    const pressureKPa = [50.7, 70.9, 101.3][Math.floor(rng() * 3)];
    const d0 = 1.2 + rng() * 2.6;
    // Teaching-model K: rises with O2, suppressed by CO2 dilution.
    const k = Math.max(0.05, fuel.baseK * (0.45 + 2.4 * (o2 - 0.14)) * (1 - 0.55 * co2) * (0.9 + 0.2 * (pressureKPa / 101.3)) + gauss() * 0.03);
    // Radiative-extinction teaching rule: large droplets at low O2 extinguish.
    const radiative = d0 > 2.6 && o2 < 0.2;
    const disruptive = rng() < 0.12;
    const outcome = disruptive ? 'Disruption' : radiative || rng() < 0.35 ? 'Extinction' : 'Completion';
    const extD = outcome === 'Extinction' ? Math.max(0.4, d0 * (0.45 + rng() * 0.25)) : null;
    const burnTime = outcome === 'Completion' ? d0 * d0 / k : extD !== null ? (d0 * d0 - extD * extD) / k : (d0 * d0) / k * (0.5 + rng() * 0.4);
    experiments.push({
      id: `SYNTH-${String(i + 1).padStart(3, '0')}`,
      sourceIdentifier: `DEMO-${i + 1}`,
      campaign: 'SYNTHETIC-DEMO',
      dateISO: null,
      fuel: fuel.name,
      oxidizer: { o2, n2: Math.max(0, 1 - o2 - co2), co2, he: 0 },
      gravity: 'microgravity',
      pressureKPa,
      initialDiameterMm: d0,
      extinctionDiameterMm: extD,
      burningRateMm2PerS: k,
      burnTimeS: burnTime,
      flameTemperatureK: null,
      outcome,
      provenance: SYNTHETIC_PROVENANCE,
      missingFields: extD === null ? ['extinctionDiameterMm'] : [],
    });
  }
  return {
    id: 'synthetic-demo',
    title: 'SYNTHETIC DEMONSTRATION DATA — not NASA measurements',
    kind: 'synthetic-demo',
    institution: SYNTHETIC_PROVENANCE.institution,
    sourceUrl: SYNTHETIC_PROVENANCE.sourceUrl,
    description:
      'Seeded teaching-model data for offline demonstration. Clearly synthetic; never mix with measured datasets.',
    experiments,
    availableFields: ['pressureKPa', 'initialDiameterMm', 'extinctionDiameterMm', 'burningRateMm2PerS', 'burnTimeS', 'o2'],
  };
}
