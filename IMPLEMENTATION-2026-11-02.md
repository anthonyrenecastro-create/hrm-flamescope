# HRM FlameScope — Implementation Report (2026-11-02)

Implements the "Gemini AI Studio — Application Adaptation Prompt"
(HRM FlameScope, NASA Space Apps Challenge 2026, Flame in Freefall)
on top of the baseline established the same day. All work was built in `extracted/` and then, at Zebulon's direction on
2026-11-02, moved to the repository root, committed, pushed, and
deployed to Vercel (project `transcendental-gateways/hrm-flamescope`).

## What was built

- **Real NASA data, verified**: FLEX Table IX from NASA/TP-2015-216046
  (NTRS 20150023456) — 276 tests, bundled as `src/data/flex_table_ix.csv`,
  parsed at runtime by the FLEX adapter. All 276 test identifiers were
  verified present in the primary NTRS document; sample rows matched
  the printed table value-for-value; source blanks stay missing
  (extinction diameter 78, D0 12, burning rate 16, pressure 1 — never
  zero-filled). BASS/ACME/CFI-G are metadata-only registry entries.
  A seeded synthetic demo dataset exists separately, labeled everywhere.
- **Combustion domain layer** (~1,900 new LOC + UI): typed model with
  provenance and plausibility validation; combustion state
  X = [Φ, G, T, M, C, H, B]; relationship graph (similarity relations,
  explicitly not physical transport); HRM graph forecast model with an
  exact ledger decomposition (planetary ledger terms dropped, not
  relabeled); three independent baselines (global mean, per-fuel mean,
  OLS); transparent weighted fire-safety ranking with live weights;
  derived d²-law trajectories; evidence-grounded assistant with
  citation validation and explicit insufficient-evidence answers;
  server-side Gemini route (`/api/assistant/ask`) that only rephrases
  retrieved evidence and degrades gracefully to offline mode.
- **UI**: FlameScope default app with the six required areas
  (Experiment Network, Combustion Dynamics, Gravity Comparison,
  HRM Manifold Explorer, Fire Safety Dashboard, Model Performance Lab)
  plus Research Assistant and Presentation mode. The original planetary
  app is preserved intact behind a mode switch (`src/PlanetaryApp.tsx`).
- **Docs**: README (rewritten), `LIMITATIONS.md`, `docs/DATA_MODEL.md`,
  `docs/ADAPTATION.md` (reuse/extend/isolate inventory),
  `docs/flex-benchmark-baseline.json`.

## Headline result (reported as computed)

Held-out FLEX comparison (seed 42, 182 train / 78 test, predict K):

| Model | MAE (mm²/s) | RMSE |
|---|---|---|
| Linear regression (OLS) | **0.0502** | 0.0697 |
| HRM graph-coupled | 0.0866 | 0.1067 |
| Per-fuel mean | 0.0968 | 0.1192 |
| Global mean | 0.0982 | 0.1205 |

HRM beats the mean baselines, **loses to OLS**. Ledger identity held
for 100% of HRM predictions; observed = prediction + residual exact.
Gravity comparison is INCONCLUSIVE by design (no bundled 1-g set).

## Verification (final run, 2026-11-02)

- `tsc --noEmit`: clean
- `vitest run`: **45/45 passed, 10 files** (25 original planetary
  regression tests + 20 new combustion tests covering data integrity,
  unit conversion, upload limits, deterministic split, leakage,
  ledger identity, ranking transparency, synthetic labeling, and
  assistant citation behavior)
- `vite build`: passes (JS 464 kB / 137 kB gzip)
- Server smoke (no GEMINI_API_KEY): `/` 200, `/api/health` healthy,
  `/api/assistant/ask` returns offline mode with evidence and 400
  `EVIDENCE_REQUIRED` without it
- Known unchanged baseline defect: plain `npm install` still fails on
  the esbuild pin (bun install is the documented route); held for
  Zebulon's word, as is any push/deploy.

## Open items for Zebulon

1. Push/deploy decision for the extracted + adapted codebase.
2. ~~esbuild pin fix~~ — DONE 2026-11-02 at Zebulon's direction:
   `^0.25.0` → `^0.28.0`; clean `npm install` verified (198 pkgs),
   bun route re-verified, 45/45 tests + build green on the npm tree.
   See the resolution addendum in `BASELINE-2026-11-02.md`.
3. A `GEMINI_API_KEY` on the server would enable the Gemini phrasing
   path live (code-verified, never exercised with a real key here).
4. Future data work: BASS/ACME/CFI-G machine-readable ingestion from
   PSI, and a matched normal-gravity set to un-block §6C comparisons.

## Deployment record (2026-11-02)

- GitHub: pushed to `anthonyrenecastro-create/hrm-flamescope` main @
  `90322ece18ad6541db9caf09a2271f25f2beb9b7` via the GitHub API push
  path (throwaway-branch proof first, deleted after). Remote content
  byte-verified against local for index.html, package.json,
  FlameScopeApp.tsx, and the FLEX CSV; 63 blobs total (61 pushed +
  LICENSE + original ZIP retained).
- Vercel: project `transcendental-gateways/hrm-flamescope` (already
  present in the team and Git-connected; the API create returned 403
  as in prior projects, and a duplicate create was correctly refused).
  Production deployment Ready at commit 90322ec.
- Live URL: **https://hrm-flamescope-seven.vercel.app** — verified
  independently: HTTP 200, text/html, title "HRM FlameScope —
  Microgravity Combustion Intelligence", JS bundle 464,286 bytes
  matching the local build, containing the FLEX dataset markers.
  The bare `hrm-flamescope.vercel.app` subdomain returns 404 (held by
  another account), hence the `-seven` suffix.
- Scope note: Vercel serves the static Vite build. The Express
  `server.ts` APIs (telemetry proxy, Gemini phrasing) do not run
  there; the assistant uses its offline evidence mode on Vercel,
  by design.
