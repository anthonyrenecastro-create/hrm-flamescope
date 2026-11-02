# FlameScope combustion data model

Types live in `src/types/combustion.ts`; adapters in
`src/engine/combustionData.ts`.

## Core record: `CombustionExperiment`

One experimental run. Every measurement field is optional; an
unreported measurement is `null` and is also listed by name in
`missingFields`. Missing is never encoded as 0.

| Field | Unit (canonical) | Notes |
|---|---|---|
| `fuel` | — | Source's own fuel name |
| `oxidizer.o2 / n2 / co2 / he` | mole fraction 0–1 | Null per-species when unreported |
| `pressureKPa` | kPa | FLEX source reports mmHg; converted at ingestion (×0.133322) |
| `initialDiameterMm` | mm | Droplet D0 (or characteristic length) |
| `extinctionDiameterMm` | mm | Null when extinction did not occur or was unreported — the source uses "-" for "did not occur", which the adapter preserves as missing and the outcome field disambiguates where the source states it |
| `burningRateMm2PerS` | mm²/s | d²-law constant K as reported |
| `burnTimeS` | s | |
| `flameTemperatureK` | K | Supported by the model; **not reported** in the FLEX Table IX extract, so null throughout that dataset |
| `outcome` | — | Extinction / Disruption / Completion / Unknown, in the source's categories |
| `gravity` | — | microgravity / normal-gravity / partial-gravity / unknown |
| `provenance` | — | kind (measured / derived / simulated / synthetic-demo), institution, source title, source URL, dataset id, ingestion note |

## Validation

`validateFieldValue` rejects non-finite values and values outside the
plausibility bounds in `FIELD_BOUNDS` (pressure 1–1000 kPa, D0
0.05–50 mm, K 0.001–10 mm²/s, temperature 200–4000 K, O2 0–1). Bounds
are sanity gates, not physical laws; rejections are reported as
`ValidationIssue`s, never silently clamped.

## Adapters

- **FLEX adapter** (`adaptFlexCsv`) — parses the Table IX layout;
  attaches the NASA/TP-2015-216046 provenance to every record.
- **Generic upload adapter** (`adaptGenericCsv`) — accepts the FLEX
  layout or a canonical layout (`fuel, o2_fraction, pressure_kpa,
  d0_mm, burning_rate_mm2s, burn_time_s, ...`). 2 MB hard limit.
  Uploaded data keeps the uploader's declared provenance; the adapter
  never relabels uploads as NASA data.
- **Synthetic generator** (`generateSyntheticDataset`) — seeded
  teaching model; every record tagged `synthetic-demo`; datasets are
  switched wholesale in the UI, never merged with measured data.

## Derived data

- Dataset statistics (`computeDatasetStats`) are computed from the
  records at runtime and labeled derived.
- Droplet trajectories (`derivedDiameterTrajectory`) reconstruct the
  d²-law curve implied by a test's own reported D0 and K — the same
  linear d²-vs-time relation the source report used to define K.
  Labeled derived wherever displayed.

## Provenance of the bundled FLEX table

Values were transcribed from Table IX of Dietrich et al.,
*NASA/TP-2015-216046* (NTRS 20150023456; also PSI-69). During
ingestion, all 276 test identifiers were verified present in the
primary NTRS document text and sample rows were cross-checked
value-for-value against the printed table (e.g., FLEX-001 / 20CAL08:
methanol, 757.7 mmHg, D0 1.69 mm, extinction diameter 0.89 mm,
K 0.52 mm²/s).
