# FlameScope — Limitations and unvalidated assumptions

Read this before citing any FlameScope output. Updated 2026-11-02.

## Data limitations

1. **Only one measured dataset is ingested**: FLEX Table IX
   (NASA/TP-2015-216046), 276 droplet tests, methanol and heptane,
   2009–2011. BASS, ACME, and CFI-G are registered as metadata only —
   no measurements for them are bundled, and none are implied.
2. **No normal-gravity comparison set.** The bundled measured data are
   microgravity-only, so gravity comparisons are reported as
   inconclusive in the app rather than estimated.
3. **Flame temperature is unreported** in the Table IX extract;
   temperature-dependent analysis is impossible from this dataset.
4. **No per-measurement uncertainties are reported** in Table IX. The
   ranking engine therefore proxies uncertainty by missing-data
   fraction and says so.
5. Transcription risk: values were transcribed from the published
   table and spot-verified against the primary document (all 276 test
   identifiers confirmed present; sample rows matched exactly). A full
   cell-by-cell independent re-extraction has not been performed.

## Model limitations

6. **The HRM graph model is unvalidated.** On held-out FLEX tests
   (seed 42, 182 train / 78 test) it scored MAE 0.0866 mm²/s —
   better than global-mean (0.0982) and per-fuel-mean (0.0968)
   baselines, **worse than ordinary least-squares regression
   (0.0502)**. The app displays this as computed. No claim of HRM
   superiority is supported.
7. Graph edges are similarity relations (shared fuel, comparable
   conditions, same date), **not physical transport**. Diffusion over
   them is a smoothing assumption, not combustion physics.
8. The stabilization clamp (predictions clipped to the training
   target range) is an engineering guard, disclosed in the ledger.
9. The derived d²-law trajectories are reconstructions from two
   reported scalars (D0, K), not measured time series.
10. The fire-safety ranking is a **prioritization aid** with
    researcher-set weights. It is not a fire-risk probability, not
    validated against outcomes, and not a NASA product.
11. The synthetic demonstration dataset comes from a seeded teaching
    model with hand-chosen rules. Results on it describe the teaching
    model only.

## AI limitations

12. The assistant answers from retrieved evidence only and its
    offline mode is extractive. Gemini phrasing (when a server key is
    configured) is citation-validated, but citation validation checks
    form, not deep semantic entailment — a human should verify any
    statement before relying on it.
13. Evidence cards are short excerpts/summaries of the cited sources;
    the sources themselves are authoritative.

## Standing disclaimers

- FlameScope is an independent NASA Space Apps Challenge 2026
  project by Axiom Zeta Innovations LLC. **Not endorsed by NASA.**
- Nothing in FlameScope is a validated fire-safety assessment tool.
  Do not use it for operational spacecraft decisions.
