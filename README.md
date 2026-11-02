# HRM FlameScope — Microgravity Combustion Intelligence & Fire Safety Research Platform

**Developer:** Axiom Zeta Innovations LLC
**Built for:** NASA Space Apps Challenge 2026 — *Flame in Freefall*
**Architecture:** adapted from HRM 4.0/4.1 Planetary Manifold Telemetry (preserved in-app as Planetary mode)
**UNIFIED APPLICATION (2026-11-02):** FlameScope is a single fused
application — the original planetary manifold's visual architecture
and HRM engine carry the combustion mission in one shell with one
shared state (see `docs/UNIFIED.md`). There is no separate planetary
mode and no second dashboard.

**Status:** independent project. **Not endorsed by NASA.** The HRM model is unvalidated — see [LIMITATIONS.md](LIMITATIONS.md).
**Live:** https://hrm-flamescope-seven.vercel.app (Vercel, static build; the Express API routes are local-dev only, so the assistant runs in offline evidence mode there).

FlameScope organizes real NASA microgravity combustion measurements into a
single research environment: provenance-preserving ingestion, an experiment
relationship network, derived combustion dynamics, transparent model
comparison (HRM vs independent baselines on held-out tests), explainable
fire-safety prioritization, and an evidence-grounded AI assistant whose
empirical statements must cite retrieved sources.

## Data

- **Bundled measured dataset:** FLEX (Flame Extinguishment Experiment),
  Table IX of Dietrich et al., *NASA/TP-2015-216046*
  ([NTRS 20150023456](https://ntrs.nasa.gov/citations/20150023456), also
  PSI-69) — 276 ISS droplet tests (methanol, heptane; 2009–2011),
  shipped as `src/data/flex_table_ix.csv` and parsed at runtime by the
  FLEX adapter. Values verified against the primary document during
  ingestion; source blanks remain missing (never zero-filled).
- BASS, ACME, and CFI-G are registered as **metadata-only** campaigns
  (no measurements bundled yet).
- A clearly labeled **synthetic demonstration dataset** (seeded teaching
  model) is available for offline demos and is never merged with
  measured data.

## Install and run

**Prerequisites:** Node.js 20+. Either package manager works
(`package-lock.json` and `bun.lock` are both maintained; the esbuild
pin was fixed to `^0.28.0` on 2026-11-02 — see the resolution note in
`BASELINE-2026-11-02.md` in this repo).

```bash
npm install        # or: bun install
npm run dev        # Express + Vite server on http://localhost:3000
```

Optional: set `GEMINI_API_KEY` in the server environment to enable
Gemini phrasing of assistant answers (server-side only; the assistant
works fully offline without it). Set `TELEMETRY_API_KEY` to require
authentication on telemetry ingestion endpoints.

## Verify

```bash
./node_modules/.bin/tsc --noEmit   # typecheck
./node_modules/.bin/vitest run     # 45 tests: 25 planetary regression + 20 combustion
./node_modules/.bin/vite build     # production build
```

Benchmark snapshot on the real FLEX data: `docs/flex-benchmark-baseline.json`
(held-out, seed 42 — OLS regression currently beats the HRM graph model;
the app reports results as computed).

## Layout

- `src/components/FlameScopeApp.tsx` — the FlameScope application (six research areas + presentation mode)
- `src/PlanetaryApp.tsx` + `src/engine/*` (original files) — the preserved planetary application
- `src/types/combustion.ts`, `docs/DATA_MODEL.md` — the combustion data model
- `src/engine/combustionData.ts` — units, validation, FLEX + upload adapters
- `src/engine/combustionModel.ts` — state X = [Φ, G, T, M, C, H, B], model comparison, ledger, ranking
- `src/engine/assistant.ts` — evidence retrieval, grounded answers, citation validation
- `server.ts` — Express server (telemetry, benchmarks, `/api/assistant/ask`)
- `docs/ADAPTATION.md` — what was reused, extended, or isolated from the original app

## Demonstration workflow

1. Open the app (FlameScope mode is default). The FLEX dataset loads with its source banner.
2. **Experiment Network** — filter by fuel, click a node to select a test.
3. **Combustion Dynamics** — inspect the selected test and its derived d²-law trajectory.
4. **Model Performance Lab** — run/read the held-out comparison; inspect the largest HRM residuals.
5. **Fire Safety Dashboard** — adjust ranking weights and watch priorities recalculate with explanations.
6. **Research Assistant** — ask a preset question; check the evidence panel citations. Ask the gravity question to see an honest *inconclusive*.
7. **Presentation** tab — the hackathon narrative, including limitations.

Exports: dataset CSV, benchmark JSON, and a reproducible Python script
(dataset statistics + the exact split rule) from the header / Model Lab.
