import { describe, it, expect } from 'vitest';
import { buildInitialCarrierComplex } from '../engine/planetaryCarrier';
import {
  initializeFieldChannels,
  initializeMetricTensor,
  computeHRMTransitionStep,
  TAU_LEDGER_TOLERANCE,
} from '../engine/hrmMath';
import { createMulberry32 } from '../engine/prng';
import { TransportOperatorStateT } from '../types/hrm';

describe('Conservation of Explanation Identity & Mathematical Invariance', () => {
  it('strictly satisfies Delta X_t = sum(A_k) + eps_t with ratio <= tau_ledger', () => {
    const G = buildInitialCarrierComplex();
    const N = G.nodes.length;
    const basePue = G.nodes.map(n => n.pueBaseline);
    const rng = createMulberry32(1337);

    let Phi = initializeFieldChannels(N, basePue);
    let T: TransportOperatorStateT = {
      lastTopologyMutationTime: 0,
      activeSeveredLinks: [],
      divertedTrafficRatio: 0,
      phantomEnergyResidual: 0,
    };
    let M = initializeMetricTensor(N);
    let alloc = Array(N).fill(1.0 / N);

    for (let step = 0; step < 50; step++) {
      const simTime = step * 1.0;
      const res = computeHRMTransitionStep(Phi, G, T, M, simTime, 1.0, [], alloc, rng);

      expect(res.ledger.invariantPreserved).toBe(true);
      expect(res.ledger.residualRatio).toBeLessThanOrEqual(TAU_LEDGER_TOLERANCE);

      Phi = res.Phi_next;
      T = res.updatedT;
      M = res.updatedM;
      alloc = res.allocation.dispatchVector;
    }
  });

  it('guarantees all channel values remain within admissible physical manifold bounds', () => {
    const G = buildInitialCarrierComplex();
    const N = G.nodes.length;
    const basePue = G.nodes.map(n => n.pueBaseline);
    const rng = createMulberry32(42);

    const Phi = initializeFieldChannels(N, basePue);
    const T: TransportOperatorStateT = {
      lastTopologyMutationTime: 0,
      activeSeveredLinks: [],
      divertedTrafficRatio: 0,
      phantomEnergyResidual: 0,
    };
    const M = initializeMetricTensor(N);
    const alloc = Array(N).fill(1.0 / N);

    // Inject massive discrete perturbation to test stabilization projection S_t ∘ P_t
    const severeSpike = [
      {
        id: 'spike_1',
        timeMs: 10,
        type: 'MICROBURST_SPIKE' as const,
        label: 'Spike',
        description: 'Overload',
        magnitude: 5.0,
      },
    ];

    const res = computeHRMTransitionStep(Phi, G, T, M, 10.0, 1.0, severeSpike, alloc, rng);

    for (let i = 0; i < N; i++) {
      const [util, queue, headroom, pue] = res.Phi_next[i];
      expect(util).toBeGreaterThanOrEqual(5.0);
      expect(util).toBeLessThanOrEqual(98.0);
      expect(queue).toBeGreaterThanOrEqual(1.0);
      expect(queue).toBeLessThanOrEqual(250.0);
      expect(headroom).toBeGreaterThanOrEqual(5.0);
      expect(headroom).toBeLessThanOrEqual(44.0);
      expect(pue).toBeGreaterThanOrEqual(1.05);
      expect(pue).toBeLessThanOrEqual(1.95);
    }

    expect(res.ledger.invariantPreserved).toBe(true);
  });
});
