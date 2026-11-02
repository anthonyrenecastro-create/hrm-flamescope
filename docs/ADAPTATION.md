# Adaptation inventory — HRM Planetary Manifold Telemetry → HRM FlameScope

Per the adaptation directive §1: what was reused, extended, or isolated.
"Operational" below means verified by the test suite / build on 2026-11-02,
not merely present in the source tree.

## Reused unchanged (operational, regression-tested)

| Component | Role in FlameScope |
|---|---|
| `src/engine/hrmMath.ts` | Preserved for planetary mode; its ledger tolerance concept informed the combustion ledger identity |
| `src/engine/dualWorldmodel.ts` | Planetary mode simulation core, unchanged |
| `src/engine/forecast.ts`, `src/engine/baselines.ts` | Planetary-mode forecast/baselines, unchanged |
| `src/engine/observer.ts`, `src/engine/clone.ts`, `src/engine/prng.ts` | Shared utilities; `prng.ts` (mulberry32) also seeds the synthetic demo generator and deterministic splits |
| `src/engine/telemetryAdapter.ts` | Planetary-mode Prometheus/OTLP ingestion, unchanged; the combustion side adds its own dataset adapters rather than forcing telemetry shapes onto experiment tables |
| `src/engine/benchmarks.ts` + `/api/benchmarks/run` | Deterministic benchmark infrastructure, unchanged |
| `server.ts` protections | Rate limiting, telemetry auth guard, SSRF allowlist proxy, 256 KB JSON limit — all preserved; one route added (below) |
| All planetary components + `src/test/` planetary suites | Preserved; original app now lives at `src/PlanetaryApp.tsx` behind the mode switch in `src/App.tsx` — 25/25 original tests still pass |

## Extended

| Component | Extension |
|---|---|
| `server.ts` | Added `POST /api/assistant/ask`: server-side Gemini phrasing over client-retrieved evidence only; returns `mode: 'offline'` gracefully when `GEMINI_API_KEY` is unset; rejects evidence-free questions with 400 |
| `src/engine/pythonExport.ts` pattern | FlameScope adds its own reproducible Python export (dataset statistics + split rule) in `FlameScopeApp.tsx`; the planetary Python export is untouched |
| `metadata.json`, `index.html` | Retitled to FlameScope; Gemini server-side capability declaration kept |

## New (combustion domain layer)

| File | Contents |
|---|---|
| `src/types/combustion.ts` | Typed combustion model: variable-length measurements, missing = null, provenance on every record, plausibility bounds |
| `src/data/flex_table_ix.csv` | Real NASA FLEX Table IX data (276 tests) — the primary bundled dataset |
| `src/data/campaigns.ts` | Campaign registry (FLEX ingested; BASS/ACME/CFI-G metadata-only, explicitly) |
| `src/engine/combustionData.ts` | Units, validation, FLEX adapter, generic upload adapter (2 MB limit), dataset statistics |
| `src/engine/combustionModel.ts` | Combustion state X = [Φ, G, T, M, C, H, B]; relationship graph; HRM graph model vs global-mean / per-fuel-mean / OLS baselines; ledger decomposition; d²-law derived trajectories; fire-safety ranking |
| `src/engine/syntheticCombustion.ts` | Clearly labeled synthetic demo dataset (seeded teaching model) |
| `src/engine/assistant.ts` | Retrieval-grounded assistant: curated cited evidence cards + live dataset statistics; citation validation; explicit insufficient-evidence answers |
| `src/components/FlameScopeApp.tsx` | Six research areas + presentation mode |
| `src/test/combustion_*.test.ts` | 20 new tests (data integrity, model, assistant) |

## Isolated / deliberately NOT carried over

- Planetary ledger terms `A_0` (diurnal drift), `A_react` (cubic reaction),
  `A_event` (topology severance) have no combustion meaning. They were
  **dropped, not relabeled**. The combustion ledger uses its own exact
  decomposition (global mean + graph coupling + stabilization + residual).
- The planetary "diffusion = physical transport" interpretation was not
  transferred: combustion graph edges are declared similarity relations,
  and diffusion over them is labeled a statistical smoothing assumption.
- The 500 ms forecast horizon is a planetary-telemetry concept; the
  combustion comparison task is cross-sectional (predict K for held-out
  tests) because that is what the real FLEX table supports.
