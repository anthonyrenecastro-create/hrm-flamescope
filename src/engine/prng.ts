/**
 * Deterministic Pseudo-Random Number Generator (PRNG) for HRM 4.1
 * Implements Mulberry32 and Box-Muller Gaussian generators.
 * Provides independent RNG streams for:
 * 1. Plant physical simulation
 * 2. Observational measurement noise & network jitter
 * 3. Forecast counterfactual projections
 */

export type RNGFunction = () => number;

/**
 * Creates a deterministic 32-bit PRNG (Mulberry32)
 * Returns values uniformly distributed in [0, 1)
 */
export function createMulberry32(seed: number): RNGFunction {
  let s = Math.floor(seed) >>> 0;
  return function (): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296.0;
  };
}

/**
 * Box-Muller transform to generate standard Gaussian N(0, 1) numbers
 * using a supplied uniform [0, 1) RNG function.
 */
export function createGaussianRNG(uniformRNG: RNGFunction): () => number {
  let hasSpare = false;
  let spare = 0.0;

  return function (): number {
    if (hasSpare) {
      hasSpare = false;
      return spare;
    }

    let u1 = uniformRNG();
    let u2 = uniformRNG();

    // Guard against log(0)
    while (u1 <= 1e-15) {
      u1 = uniformRNG();
    }

    const radius = Math.sqrt(-2.0 * Math.log(u1));
    const theta = 2.0 * Math.PI * u2;

    spare = radius * Math.sin(theta);
    hasSpare = true;

    return radius * Math.cos(theta);
  };
}

/**
 * Named PRNG streams bundle to ensure complete separation of concerns.
 * The forecaster NEVER accesses future draws of the plant stream.
 */
export interface HRMStreams {
  plantStream: RNGFunction;
  observerStream: RNGFunction;
  forecastStream: RNGFunction;
  seed: number;
}

export function initializeHRMStreams(baseSeed: number = 42): HRMStreams {
  return {
    plantStream: createMulberry32(baseSeed),
    observerStream: createMulberry32(baseSeed + 1013904223),
    forecastStream: createMulberry32(baseSeed + 2147483647),
    seed: baseSeed,
  };
}
