# UNIFIED.md — HRM FlameScope as one application

## The fusion

Per Zebulon's unified-application directive (2026-11-02), FlameScope
is **not** two applications. The first adaptation kept the original
planetary app behind a mode switch next to the FlameScope dashboard;
that shell is gone. There is now one entry (`src/App.tsx` → 
`src/components/FlameScopeApp.tsx`), one central visualization, and
one shared state.

**What the planetary manifold provided (the body):**

- The canvas rendering architecture of `PlanetaryCanvas.tsx`:
  canvas 2D, 60 fps rAF loop, props-in-refs decoupling, starfield
  backdrop, projected-sphere globe with drag rotation and
  auto-rotation, glowing nodes, packet pulses traveling along links,
  click-to-select hit testing, top overlay control bar and bottom
  legend bar in the original visual language.
- The HRM engine (`hrmMath`, `dualWorldmodel`, `forecast`,
  `benchmarks`, `observer`, `telemetryAdapter`, `planetaryCarrier`,
  `pythonExport`) and its test suites — untouched, still exercised.
- The X = [Φ, G, T, M, C, H, B] state decomposition and the
  Conservation-of-Explanation ledger discipline.

**What FlameScope provides (the mission):** the combustion data
model and NASA FLEX ingestion, the combustion HRM model with
leakage-safe benchmarking against OLS and means, the transparent
fire-safety prioritization, and the evidence-grounded assistant —
now all bound to the manifold instead of a separate tab dashboard.

## The Combustion Research Manifold (`CombustionCanvas.tsx`)

Rendering mirrors `PlanetaryCanvas` deliberately; the semantics are
combustion:

- **Nodes** = experiments (up to 110 visible; the browser panel can
  hold more, and the cap is disclosed in the UI). Distinct visual
  channels, all unit-tested pure functions of the data
  (`src/engine/visualEncoding.ts`):
  - color = switchable encoding: outcome / O2 / fuel / HRM held-out
    residual (experiments outside the held-out set render in a
    distinct "not scored" color — never interpolated);
  - radius = initial diameter D0 (√ scale; missing D0 → mid default);
  - opacity = measurement completeness;
  - position = deterministic Fibonacci-sphere layout. **Position is
    schematic and carries no physical meaning** — the legend says so.
- **Edges** = the declared similarity relationships from
  `buildRelationshipGraph` (same fuel / O2 proximity / shared
  diluents / outcome class), with weights. They are computational
  coupling, explicitly **not** physical transport; pulses traveling
  along them inherit the original canvas's packet animation.
- **Interaction**: drag to rotate, wheel to zoom, hover for a data
  tooltip (id, fuel, O2, pressure, D0, K, outcome, gravity,
  provenance), click to select. Selecting updates every panel.
- **Flame glyph**: on the selected node only, a procedural teardrop
  whose height follows the node's derived droplet diameter at the
  playback time. It is labeled in the legend as a *data-driven
  visualization* — not measured imagery, and no flame shape is
  inferred from temperature (FLEX's table carries no temperature).

## Unified state and layout (spec §10, §12)

One state object in `FlameScopeApp`: dataset, filters, selection,
encoding, playback (`timeNorm`, playing, speed), model results
(comparison, residuals, ranking), assistant context/answer, overlay.

- **Left sidebar**: dataset controls, search, fuel/outcome filters,
  experiment browser (dots colored by the active encoding),
  campaign registry.
- **Center**: the manifold, continuously visible; below it the
  **bottom timeline**: play/pause, scrub, speed, reset, live readout
  of t and derived diameter D(t). Playback advances only along the
  selected record's *derived* d²-law trajectory; records without
  D0/K show a static-observation note instead of invented motion.
- **Right sidebar**: Panel A telemetry (the selected record with
  provenance and explicit "missing" fields), Panel B HRM field state
  (leave-one-out context prediction with its exact ledger
  decomposition — labeled as context, not the benchmark), Panel C
  dynamics chart with playback cursor, Panel F fire-safety (the
  selected experiment's transparent score + top-5), Panel D research
  intelligence (context questions about the selected node; Gemini
  path unchanged — server-side, evidence-gated, citation-validated).
- **Overlays** (the original app's modal-tool pattern): Model
  Comparison (Panel E, dual worldmodel HRM vs baselines), Ledger
  (all held-out HRM predictions with JSON/CSV export), Fire Safety
  (weights + full ranking), Gravity (inconclusive by design),
  Assistant evidence, Presentation.

## What happened to the planetary standalone app

`src/PlanetaryApp.tsx` is retained verbatim with a provenance
header, no longer routed. Rationale: the directive is fusion, not
deletion — the file is the reference implementation of the original
interface, while the engine modules and planetary tests remain live
code. The planetary carrier simulation (dual-worldmodel hub
simulation, live telemetry ingestion to planetary hubs) is not part
of the unified combustion workflow; the dual-worldmodel *concept*
is realized in the manifold context as HRM-vs-baseline comparison
on held-out combustion data (Panel E).

## Validation added by the fusion

`src/test/combustion_unified.test.ts` (11 tests): encodings are pure
functions of the data (outcome/O2/residual colors, radius vs D0,
opacity vs completeness, legend coverage, deterministic unit-sphere
layout); comparison reports carry ledgered HRM predictions;
leave-one-out context prediction provably ignores the target's own
K (mutation test); selected-node assistant answers cite [D3] and
list exactly the record's missing fields. Full suite: 56/56 tests,
tsc clean, production build verified.
