import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Flame, Search, Upload, Download, Play, Pause, RotateCcw, X,
  Beaker, BookOpen, MessageSquareQuote, Presentation, Gauge, ShieldAlert, FileJson,
} from 'lucide-react';
import flexCsvText from '../data/flex_table_ix.csv?raw';
import { CombustionDataset, CombustionExperiment } from '../types/combustion';
import { adaptFlexCsv, adaptGenericCsv, computeDatasetStats, MAX_UPLOAD_BYTES } from '../engine/combustionData';
import { generateSyntheticDataset } from '../engine/syntheticCombustion';
import {
  buildRelationshipGraph, contextPrediction, derivedDiameterTrajectory, rankExperiments,
  runCombustionComparison, DEFAULT_RANKING_WEIGHTS, RankingWeights,
} from '../engine/combustionModel';
import { answerQuestion, answerExperimentQuestion, retrieveEvidence, validateCitations, AssistantAnswer } from '../engine/assistant';
import { NodeEncoding, nodeColor } from '../engine/visualEncoding';
import { CombustionCanvas } from './CombustionCanvas';
import { CAMPAIGNS, CHALLENGE_URL } from '../data/campaigns';

/**
 * HRM FlameScope — ONE unified application.
 *
 * The original Planetary Manifold application provides the body: a
 * central animated canvas manifold with overlay controls, side
 * telemetry/inspection panels, and modal analysis tools. FlameScope
 * provides the mission: every node is a real combustion experiment,
 * every panel reads the same shared state (dataset, selection,
 * encoding, playback time, model results), and selecting a node
 * updates the telemetry, field-state, dynamics, ranking, and AI
 * context simultaneously. There is no second dashboard.
 */

type Overlay = null | 'lab' | 'ledger' | 'assistant' | 'present' | 'gravity' | 'safety';

const FLEX = adaptFlexCsv(flexCsvText).dataset;
const SYNTH = generateSyntheticDataset();
const MAX_CANVAS_NODES = 110;

function download(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function datasetToCsv(ds: CombustionDataset): string {
  const head = 'id,source_identifier,campaign,date,fuel,o2,n2,co2,he,pressure_kpa,d0_mm,extinction_diameter_mm,burning_rate_mm2s,burn_time_s,outcome,data_kind,source_url';
  const rows = ds.experiments.map((e) => [
    e.id, e.sourceIdentifier, e.campaign, e.dateISO ?? '', e.fuel,
    e.oxidizer.o2 ?? '', e.oxidizer.n2 ?? '', e.oxidizer.co2 ?? '', e.oxidizer.he ?? '',
    e.pressureKPa ?? '', e.initialDiameterMm ?? '', e.extinctionDiameterMm ?? '',
    e.burningRateMm2PerS ?? '', e.burnTimeS ?? '', e.outcome, e.provenance.kind, e.provenance.sourceUrl,
  ].join(','));
  return [head, ...rows].join('\n');
}

const CONTEXT_QUESTIONS = [
  'What happened during this experimental run?',
  'What information is missing?',
  'How accurately did HRM predict the measured behavior?',
  'What factors appear associated with flame extinction?',
];

export default function FlameScopeApp() {
  /* ---- Unified application state (single source of truth) ---- */
  const [datasetId, setDatasetId] = useState<'flex' | 'synthetic' | 'upload'>('flex');
  const [uploaded, setUploaded] = useState<CombustionDataset | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [query, setQuery] = useState('');
  const [fuelFilter, setFuelFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [selectedId, setSelectedId] = useState('FLEX-001');
  const [encoding, setEncoding] = useState<NodeEncoding>('outcome');
  const [timeNorm, setTimeNorm] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [weights, setWeights] = useState<RankingWeights>({ ...DEFAULT_RANKING_WEIGHTS });
  const [question, setQuestion] = useState(CONTEXT_QUESTIONS[0]);
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [answerMode, setAnswerMode] = useState('offline extractive');
  const fileRef = useRef<HTMLInputElement>(null);

  const ds: CombustionDataset = datasetId === 'flex' ? FLEX : datasetId === 'synthetic' ? SYNTH : (uploaded ?? FLEX);
  const stats = useMemo(() => computeDatasetStats(ds), [ds]);
  const filtered = useMemo(
    () => ds.experiments.filter((e) =>
      (fuelFilter === 'all' || e.fuel === fuelFilter) &&
      (outcomeFilter === 'all' || e.outcome === outcomeFilter) &&
      (query === '' || `${e.id} ${e.sourceIdentifier} ${e.fuel}`.toLowerCase().includes(query.toLowerCase()))),
    [ds, fuelFilter, outcomeFilter, query],
  );
  const visible = useMemo(() => filtered.slice(0, MAX_CANVAS_NODES), [filtered]);
  const graph = useMemo(() => buildRelationshipGraph(visible), [visible]);
  const selected: CombustionExperiment = ds.experiments.find((e) => e.id === selectedId) ?? ds.experiments[0];
  const comparison = useMemo(() => (ds.experiments.length >= 12 ? runCombustionComparison(ds) : null), [ds]);
  const residualMap = useMemo(
    () => new Map((comparison?.scores[0].residuals ?? []).map((r) => [r.experimentId, r.residual])),
    [comparison],
  );
  const ranked = useMemo(() => rankExperiments(ds, weights), [ds, weights]);
  const selectedRank = useMemo(() => ranked.find((r) => r.experiment.id === selected.id), [ranked, selected]);
  const ctx = useMemo(() => contextPrediction(ds, selected), [ds, selected]);
  const trajectory = useMemo(() => derivedDiameterTrajectory(selected), [selected]);
  const fuels = useMemo(() => [...new Set(ds.experiments.map((e) => e.fuel))], [ds]);

  const currentDiameter = useMemo(() => {
    if (!trajectory) return null;
    const idx = timeNorm * (trajectory.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(trajectory.length - 1, lo + 1);
    const frac = idx - lo;
    return trajectory[lo].diameterMm + (trajectory[hi].diameterMm - trajectory[lo].diameterMm) * frac;
  }, [trajectory, timeNorm]);
  const currentTimeS = trajectory ? timeNorm * trajectory[trajectory.length - 1].tS : 0;

  /* Playback follows the selected record's DERIVED trajectory only.
     Records without one stay static — no invented transitions. */
  useEffect(() => {
    if (!isPlaying || !trajectory) return;
    const iv = setInterval(() => {
      setTimeNorm((t) => {
        const next = t + 0.012 * speed;
        if (next >= 1) { setIsPlaying(false); return 1; }
        return next;
      });
    }, 50);
    return () => clearInterval(iv);
  }, [isPlaying, speed, trajectory]);

  useEffect(() => { setTimeNorm(0); setIsPlaying(false); }, [selectedId, datasetId]);

  const selectExperiment = (id: string) => setSelectedId(id);

  const onUpload = async (file: File) => {
    setUploadError('');
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`File exceeds the ${MAX_UPLOAD_BYTES} byte limit.`);
      const text = await file.text();
      const result = adaptGenericCsv(text, {
        kind: 'measured', institution: 'User-supplied (unverified by FlameScope)',
        sourceTitle: file.name, sourceUrl: '', datasetId: 'USER-UPLOAD',
        ingestionNote: 'Uploaded by the user in this session. Provenance is as declared by the uploader; FlameScope has not verified it against a primary source.',
      }, `User upload — ${file.name}`);
      if (!result) { setUploadError('Unrecognized CSV layout. Use the FLEX layout or the canonical FlameScope layout (with a fuel column).'); return; }
      setUploaded(result.dataset);
      setDatasetId('upload');
      setSelectedId(result.dataset.experiments[0]?.id ?? '');
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    }
  };

  const ask = async (q: string) => {
    const aboutSelected = CONTEXT_QUESTIONS.includes(q) || q.toLowerCase().includes('this');
    const offline = aboutSelected ? answerExperimentQuestion(q, selected, ds) : answerQuestion(q, ds);
    setAnswer(offline);
    setAnswerMode('offline extractive');
    try {
      const ev = offline.evidence.length ? offline.evidence : retrieveEvidence(q, ds);
      if (ev.length > 0) {
        const res = await fetch('/api/assistant/ask', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q, evidence: ev }),
        });
        const data = await res.json();
        if (data.mode === 'gemini' && typeof data.text === 'string') {
          const check = validateCitations(data.text, ev);
          if (check.ok) {
            setAnswer({ answer: data.text, evidence: ev, citedIds: check.citedIds, insufficientEvidence: false, gaps: offline.gaps });
            setAnswerMode('Gemini (server-side, evidence-grounded, citations validated)');
          } else {
            setAnswerMode(`offline extractive (Gemini reply rejected: citations ${check.unknownIds.length ? 'referenced unknown evidence' : 'missing'})`);
          }
        }
      }
    } catch { /* offline is the designed fallback */ }
  };

  const overlayBtn = (o: Overlay, label: string, icon: React.ReactNode) => (
    <button onClick={() => setOverlay(o)} className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5 hover:border-orange-500/50">
      {icon}{label}
    </button>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <header className="border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <Flame className="text-orange-400" />
          <div>
            <h1 className="font-semibold leading-tight">HRM FlameScope</h1>
            <p className="text-[11px] text-slate-400 leading-tight">Combustion Research Manifold · Axiom Zeta Innovations LLC · NASA Space Apps 2026 — Flame in Freefall</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs">
          <select value={datasetId} onChange={(e) => setDatasetId(e.target.value as typeof datasetId)} className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5">
            <option value="flex">NASA FLEX measured (276 tests)</option>
            <option value="synthetic">SYNTHETIC demo (not measured)</option>
            <option value="upload" disabled={!uploaded}>User upload{uploaded ? ` (${uploaded.experiments.length})` : ''}</option>
          </select>
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5"><Upload size={13} /> Import CSV</button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          {overlayBtn('lab', 'Model Comparison', <Beaker size={13} />)}
          {overlayBtn('ledger', 'Ledger', <BookOpen size={13} />)}
          {overlayBtn('safety', 'Fire Safety', <ShieldAlert size={13} />)}
          {overlayBtn('gravity', 'Gravity', <Gauge size={13} />)}
          {overlayBtn('assistant', 'Assistant', <MessageSquareQuote size={13} />)}
          {overlayBtn('present', 'Presentation', <Presentation size={13} />)}
          <button onClick={() => download('flamescope_dataset.csv', datasetToCsv(ds), 'text/csv')} className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5"><Download size={13} /> CSV</button>
          <button onClick={() => comparison && download('flamescope_benchmark.json', JSON.stringify(comparison, null, 2))} className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded px-2 py-1.5"><FileJson size={13} /> Benchmark</button>
        </div>
      </header>

      {ds.kind === 'synthetic-demo' && (
        <div className="bg-amber-500/15 border-b border-amber-500/40 text-amber-200 px-4 py-1.5 text-xs flex items-center gap-2">
          <ShieldAlert size={14} /> SYNTHETIC DEMONSTRATION DATA — seeded teaching model. Not NASA measurements.
        </div>
      )}
      {ds.kind === 'measured' && datasetId === 'flex' && (
        <div className="bg-slate-900/60 border-b border-slate-800 px-4 py-1.5 text-[11px] text-slate-300">
          Measured data: <b>{ds.title}</b> · source: <a className="text-orange-300 underline" href={ds.sourceUrl} target="_blank" rel="noreferrer">{ds.sourceUrl}</a> · blanks in the source remain missing here · pipeline: NASA dataset → validation → combustion state → HRM engine → manifold → AI interpretation → benchmark/export
        </div>
      )}
      {uploadError && <div className="bg-red-500/15 text-red-200 px-4 py-2 text-sm">{uploadError}</div>}

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[290px_minmax(0,1fr)_330px] gap-3 p-3">
        {/* LEFT SIDEBAR — experiment selection & dataset controls */}
        <aside className="space-y-3 order-2 lg:order-1">
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">Experiments</h2>
            <div className="flex items-center gap-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 mb-2">
              <Search size={13} className="text-slate-400" />
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search id / identifier / fuel" className="bg-transparent outline-none text-xs w-full" />
            </div>
            <div className="flex gap-1.5 mb-2">
              <select value={fuelFilter} onChange={(e) => setFuelFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-xs flex-1">
                <option value="all">All fuels</option>
                {fuels.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value)} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-xs flex-1">
                <option value="all">All outcomes</option>
                <option>Extinction</option><option>Disruption</option><option>Completion</option><option>Unknown</option>
              </select>
            </div>
            <p className="text-[11px] text-slate-500 mb-1.5">{filtered.length} of {stats.total} experiments{filtered.length > MAX_CANVAS_NODES ? ` · manifold shows first ${MAX_CANVAS_NODES}` : ''} · {Object.entries(stats.byOutcome).map(([k, v]) => `${k} ${v}`).join(' · ')}</p>
            <div className="max-h-[380px] overflow-y-auto space-y-0.5 pr-0.5">
              {filtered.map((e) => (
                <button key={e.id} onClick={() => selectExperiment(e.id)}
                  className={`w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded ${e.id === selected.id ? 'bg-orange-500/15 border border-orange-500/40' : 'border border-transparent hover:bg-slate-800'}`}>
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: nodeColor(e, encoding, residualMap), boxShadow: `0 0 6px ${nodeColor(e, encoding, residualMap)}` }} />
                  <span className="font-mono">{e.id}</span>
                  <span className="text-slate-400 truncate">{e.fuel} · O2 {e.oxidizer.o2 ?? '—'}</span>
                  <span className="ml-auto text-slate-500">{e.outcome.slice(0, 4)}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
            <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-1.5">Campaigns</h2>
            {CAMPAIGNS.map((c) => (
              <p key={c.id} className="text-[11px] text-slate-400 mb-1">
                <b className="text-slate-200">{c.name}</b> — {c.status === 'ingested' ? 'measurements ingested' : 'metadata only'} ·{' '}
                <a className="text-orange-300 underline" href={c.sourceUrl} target="_blank" rel="noreferrer">source</a>
              </p>
            ))}
          </div>
        </aside>

        {/* CENTER — the manifold + bottom timeline */}
        <section className="order-1 lg:order-2 flex flex-col gap-2 min-w-0">
          <div className="flex-1 min-h-[520px]">
            <CombustionCanvas
              experiments={visible}
              graph={graph}
              selectedId={selected.id}
              onSelect={selectExperiment}
              encoding={encoding}
              onEncodingChange={setEncoding}
              residuals={residualMap}
              timeNorm={timeNorm}
              selectedDiameterMm={currentDiameter}
              isPlaying={isPlaying}
            />
          </div>
          <div className="bg-slate-900/70 border border-slate-800 rounded-lg px-3 py-2">
            {trajectory ? (
              <div className="flex flex-wrap items-center gap-3">
                <button onClick={() => { if (timeNorm >= 1) setTimeNorm(0); setIsPlaying(!isPlaying); }} className="flex items-center gap-1 bg-orange-500/80 hover:bg-orange-500 text-white rounded px-2.5 py-1.5 text-xs">
                  {isPlaying ? <Pause size={13} /> : <Play size={13} />} {isPlaying ? 'Pause' : 'Play'}
                </button>
                <button onClick={() => { setTimeNorm(0); setIsPlaying(false); }} className="p-1.5 text-slate-300 hover:text-white" title="Reset timeline"><RotateCcw size={14} /></button>
                <input type="range" min={0} max={1000} value={Math.round(timeNorm * 1000)}
                  onChange={(e) => { setTimeNorm(Number(e.target.value) / 1000); setIsPlaying(false); }}
                  className="flex-1 min-w-[140px]" />
                <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="bg-slate-950 border border-slate-700 rounded px-1.5 py-1 text-xs">
                  <option value={0.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
                </select>
                <span className="text-xs font-mono text-slate-300">
                  {selected.id} · t = {currentTimeS.toFixed(2)} s · D = {currentDiameter !== null ? currentDiameter.toFixed(2) : '—'} mm
                </span>
                <span className="text-[10px] text-slate-500">Playback follows the DERIVED d²-law trajectory implied by this record's reported D0 and K — not measured video.</span>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Timeline unavailable for {selected.id}: D0 or burning rate is unreported, so no trajectory can be derived. The observation stays static rather than inventing motion.</p>
            )}
          </div>
        </section>

        {/* RIGHT SIDEBAR — telemetry, field state, dynamics, safety, AI */}
        <aside className="space-y-3 order-3">
          <Panel title="Experimental Telemetry — Panel A">
            <TelemetryRows e={selected} />
          </Panel>
          <Panel title="HRM Field State — Panel B">
            {ctx.observed !== null && ctx.prediction.ledger ? (
              <div className="text-xs space-y-1">
                <Row k="Context pool" v={`${ctx.poolSize} other tests`} />
                <Row k="Global mean term" v={`${ctx.prediction.ledger.globalMean.toFixed(4)} mm²/s`} />
                <Row k="Graph coupling" v={`${ctx.prediction.ledger.graphCoupling >= 0 ? '+' : ''}${ctx.prediction.ledger.graphCoupling.toFixed(4)}`} />
                <Row k="Stabilization correction" v={`${ctx.prediction.ledger.stabilizationCorrection.toFixed(4)}`} />
                <Row k="HRM prediction (LOO)" v={`${ctx.prediction.predicted.toFixed(4)} mm²/s`} />
                <Row k="Observed" v={`${ctx.observed.toFixed(4)} mm²/s`} />
                <Row k="Residual" v={`${ctx.residual!.toFixed(4)} mm²/s`} />
                <Row k="Ledger identity" v={ctx.prediction.ledger.identityHolds ? 'holds exactly' : 'VIOLATED'} />
                <p className="text-[10px] text-slate-500 pt-1">Leave-one-out context estimate for inspection — the validated numbers live in Model Comparison. Full entries: Ledger overlay.</p>
              </div>
            ) : (
              <p className="text-xs text-slate-400">No observed K for this record; the HRM context prediction is {ctx.prediction.predicted.toFixed(4)} mm²/s but cannot be scored against an observation.</p>
            )}
          </Panel>
          <Panel title="Combustion Dynamics — Panel C">
            {trajectory ? <TrajectoryChart traj={trajectory} extD={selected.extinctionDiameterMm} timeNorm={timeNorm} /> : <p className="text-xs text-slate-400">No derived trajectory (missing D0 or K).</p>}
            <p className="text-[10px] text-slate-500 mt-1">Derived from reported D0 and K under the d²-law the source report used to define K. Cursor = playback time.</p>
          </Panel>
          <Panel title="Fire Safety — Panel F">
            {selectedRank && (
              <div className="text-xs space-y-1">
                <Row k={`${selected.id} priority score`} v={`${selectedRank.total.toFixed(1)} / 100`} />
                <p className="text-slate-400">{selectedRank.explanation.join(' ')}</p>
                <p className="text-[10px] text-slate-500">Prioritization aid only — not a fire-risk probability. Weights & full ranking: Fire Safety overlay.</p>
              </div>
            )}
            <div className="mt-2 space-y-0.5">
              {ranked.slice(0, 5).map((r, i) => (
                <button key={r.experiment.id} onClick={() => selectExperiment(r.experiment.id)} className="w-full text-left text-[11px] px-1.5 py-1 rounded hover:bg-slate-800 flex justify-between">
                  <span>{i + 1}. {r.experiment.id} · {r.experiment.fuel}</span><span className="text-orange-300">{r.total.toFixed(1)}</span>
                </button>
              ))}
            </div>
          </Panel>
          <Panel title="Research Intelligence — Panel D">
            <div className="flex flex-wrap gap-1 mb-2">
              {CONTEXT_QUESTIONS.map((q) => (
                <button key={q} onClick={() => { setQuestion(q); ask(q); }} className="text-[10px] bg-slate-800 hover:bg-slate-700 rounded px-1.5 py-1 text-left">{q}</button>
              ))}
            </div>
            <div className="flex gap-1">
              <input value={question} onChange={(e) => setQuestion(e.target.value)} className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs" />
              <button onClick={() => ask(question)} className="bg-orange-500/80 hover:bg-orange-500 text-white rounded px-2.5 text-xs">Ask</button>
            </div>
            {answer && (
              <div className="mt-2 text-xs">
                <p className="text-[10px] text-slate-500 mb-1">{answerMode}{answer.insufficientEvidence ? ' · insufficient evidence' : ''}</p>
                <p className="text-slate-200 whitespace-pre-wrap">{answer.answer}</p>
                {answer.gaps.length > 0 && <p className="text-amber-200 mt-1">Gaps: {answer.gaps.join(' ')}</p>}
              </div>
            )}
          </Panel>
        </aside>
      </div>

      <footer className="border-t border-slate-800 px-4 py-2 text-[11px] text-slate-500 flex flex-wrap gap-x-3">
        <span>HRM FlameScope — one unified instrument: manifold, panels, timeline, forecasting, ledger, and AI share a single state.</span>
        <span>Independent Space Apps project by Axiom Zeta Innovations LLC. Not endorsed by NASA. HRM is unvalidated; see LIMITATIONS.md.</span>
      </footer>

      {overlay && (
        <OverlayShell title={
          overlay === 'lab' ? 'Model Comparison — Dual Worldmodel (Panel E)' :
          overlay === 'ledger' ? 'Attribution Ledger — HRM held-out predictions' :
          overlay === 'safety' ? 'Fire Safety Insights — transparent ranking (Panel F)' :
          overlay === 'gravity' ? 'Gravity Comparison' :
          overlay === 'assistant' ? 'Research Assistant — evidence & sources' :
          'Presentation — NASA Space Apps Challenge 2026'
        } onClose={() => setOverlay(null)}>
          {overlay === 'lab' && <LabPanel ds={ds} comparison={comparison} onSelect={selectExperiment} />}
          {overlay === 'ledger' && <LedgerPanel comparison={comparison} />}
          {overlay === 'safety' && <SafetyPanel ranked={ranked} weights={weights} setWeights={setWeights} onSelect={(id) => { selectExperiment(id); setOverlay(null); }} />}
          {overlay === 'gravity' && <GravityPanel ds={ds} />}
          {overlay === 'assistant' && <AssistantPanel answer={answer} />}
          {overlay === 'present' && <PresentationPanel ds={ds} comparison={comparison} />}
        </OverlayShell>
      )}
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-lg p-3">
      <h2 className="text-xs font-semibold text-slate-300 uppercase tracking-wide mb-2">{title}</h2>
      {children}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2 border-b border-slate-800/50 py-0.5">
      <span className="text-slate-400">{k}</span><span className="text-right font-mono text-[11px]">{v}</span>
    </div>
  );
}

function TelemetryRows({ e }: { e: CombustionExperiment }) {
  const fmt = (v: number | null, unit: string, d = 2) => (v === null ? 'missing (not zero)' : `${v.toFixed(d)} ${unit}`);
  return (
    <div className="text-xs space-y-0.5">
      <Row k="Experiment" v={`${e.id} · CIR ${e.sourceIdentifier || '—'}`} />
      <Row k="Campaign / date" v={`${e.campaign} · ${e.dateISO ?? 'not reported'}`} />
      <Row k="Fuel" v={e.fuel} />
      <Row k="Gravity" v={e.gravity} />
      <Row k="O2 mole fraction" v={e.oxidizer.o2 === null ? 'missing' : e.oxidizer.o2.toFixed(2)} />
      <Row k="Diluents" v={`CO2 ${e.oxidizer.co2 ?? '—'} · He ${e.oxidizer.he ?? '—'} · N2 ${e.oxidizer.n2 ?? '—'}`} />
      <Row k="Pressure" v={fmt(e.pressureKPa, 'kPa', 1)} />
      <Row k="Flame temp." v={fmt(e.flameTemperatureK, 'K', 0)} />
      <Row k="Initial diameter D0" v={fmt(e.initialDiameterMm, 'mm')} />
      <Row k="Extinction diameter" v={fmt(e.extinctionDiameterMm, 'mm')} />
      <Row k="Burning rate K" v={fmt(e.burningRateMm2PerS, 'mm²/s', 3)} />
      <Row k="Burn time" v={fmt(e.burnTimeS, 's', 1)} />
      <Row k="Outcome" v={e.outcome} />
      <p className="text-[10px] text-slate-500 pt-1.5">
        Provenance: {e.provenance.kind} · {e.provenance.institution} ·{' '}
        <a className="text-orange-300 underline" href={e.provenance.sourceUrl} target="_blank" rel="noreferrer">{e.provenance.datasetId}</a>
        {e.missingFields.length > 0 && <><br />Missing: {e.missingFields.join(', ')}</>}
      </p>
    </div>
  );
}

function TrajectoryChart({ traj, extD, timeNorm }: { traj: Array<{ tS: number; diameterMm: number }>; extD: number | null; timeNorm: number }) {
  const W = 300, H = 130, P = 22;
  const tMax = traj[traj.length - 1].tS;
  const dMax = traj[0].diameterMm * 1.08;
  const x = (t: number) => P + (t / tMax) * (W - 2 * P);
  const y = (d: number) => H - P - (d / dMax) * (H - 2 * P);
  const path = traj.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.tS).toFixed(1)},${y(p.diameterMm).toFixed(1)}`).join(' ');
  const cursorT = timeNorm * tMax;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      <rect x={P} y={P} width={W - 2 * P} height={H - 2 * P} fill="#0b1220" stroke="#1e293b" />
      <path d={path} fill="none" stroke="#fb923c" strokeWidth={1.8} />
      <line x1={x(cursorT)} y1={P} x2={x(cursorT)} y2={H - P} stroke="#38bdf8" strokeWidth={1} strokeDasharray="3 2" />
      {extD !== null && <circle cx={x(tMax)} cy={y(extD)} r={3.5} fill="#f87171" />}
      <text x={P} y={H - 6} fill="#94a3b8" fontSize={9}>time (s) → {tMax.toFixed(1)}</text>
      <text x={2} y={P - 6} fill="#94a3b8" fontSize={9}>diameter (mm)</text>
    </svg>
  );
}

function OverlayShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 bg-slate-950/85 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-4" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-4xl w-full my-6 p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-orange-200">{title}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ---------------- overlays ---------------- */

function LabPanel({ ds, comparison, onSelect }: { ds: CombustionDataset; comparison: ReturnType<typeof runCombustionComparison> | null; onSelect: (id: string) => void }) {
  if (!comparison) return <p className="text-sm text-slate-400">Dataset too small for a leakage-safe held-out comparison.</p>;
  return (
    <div className="text-sm">
      <p className="text-slate-300 mb-1">{comparison.task}</p>
      <p className="mb-3">Train {comparison.trainCount} / held-out {comparison.testCount} · seed {comparison.seed} · dataset kind <b>{comparison.datasetKind}</b> · Best MAE: <b className="text-orange-300">{comparison.winner}</b> — reported as computed; the baseline wins when it wins.</p>
      <table className="w-full mb-4">
        <thead><tr className="text-left text-slate-400 border-b border-slate-700"><th className="py-1">Model</th><th>MAE (mm²/s)</th><th>RMSE</th><th>Runtime (ms)</th><th>Per-fuel MAE</th></tr></thead>
        <tbody>
          {comparison.scores.map((s) => (
            <tr key={s.model} className="border-b border-slate-800">
              <td className="py-1">{s.model}</td><td>{s.mae.toFixed(4)}</td><td>{s.rmse.toFixed(4)}</td><td>{s.runtimeMs.toFixed(1)}</td>
              <td className="text-xs text-slate-400">{Object.entries(s.perFuel).map(([f, v]) => `${f}: ${v.mae.toFixed(4)} (n=${v.n})`).join(' · ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-slate-300 mb-1">Ledger check: decomposition identity held for {(comparison.hrmLedgerIdentityRate * 100).toFixed(0)}% of HRM predictions; observed = prediction + residual exact: {comparison.hrmScoredResidualCheck ? 'yes' : 'NO'}.</p>
      <p className="text-slate-400 mb-1">Largest HRM disagreements with measured outcomes (click to inspect on the manifold):</p>
      <ul className="list-disc pl-5 text-slate-300">
        {[...comparison.scores[0].residuals].sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual)).slice(0, 6).map((r) => (
          <li key={r.experimentId}>
            <button className="text-orange-300 underline" onClick={() => onSelect(r.experimentId)}>{r.experimentId}</button>
            : observed {r.observed.toFixed(3)}, predicted {r.predicted.toFixed(3)}, residual {r.residual.toFixed(3)} mm²/s
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500 mt-3">{comparison.notes} Dataset: {ds.title}</p>
    </div>
  );
}

function LedgerPanel({ comparison }: { comparison: ReturnType<typeof runCombustionComparison> | null }) {
  if (!comparison) return <p className="text-sm text-slate-400">No scored predictions available.</p>;
  const rows = comparison.hrmPredictions.map((p) => {
    const res = comparison.scores[0].residuals.find((r) => r.experimentId === p.experimentId);
    return { p, res };
  });
  const exportJson = () => download('flamescope_ledger.json', JSON.stringify(rows.map(({ p, res }) => ({
    experimentId: p.experimentId, globalMean: p.ledger?.globalMean, graphCoupling: p.ledger?.graphCoupling,
    stabilizationCorrection: p.ledger?.stabilizationCorrection, predicted: p.predicted,
    observed: res?.observed, residual: res?.residual, identityHolds: p.ledger?.identityHolds,
  })), null, 2));
  const exportCsv = () => download('flamescope_ledger.csv', [
    'experiment_id,global_mean,graph_coupling,stabilization_correction,predicted,observed,residual,identity_holds',
    ...rows.map(({ p, res }) => [p.experimentId, p.ledger?.globalMean, p.ledger?.graphCoupling, p.ledger?.stabilizationCorrection, p.predicted, res?.observed, res?.residual, p.ledger?.identityHolds].join(',')),
  ].join('\n'), 'text/csv');
  return (
    <div className="text-sm">
      <p className="text-slate-300 mb-2">
        Each HRM held-out prediction decomposes exactly as <span className="font-mono">globalMean + graphCoupling + stabilizationCorrection = prediction</span>,
        and <span className="font-mono">observed = prediction + residual</span>. Planetary ledger terms (diurnal drift, cubic reaction, topology events) were dropped, not relabeled — they have no combustion meaning.
      </p>
      <div className="flex gap-2 mb-3">
        <button onClick={exportJson} className="flex items-center gap-1 bg-slate-800 rounded px-2 py-1.5 text-xs"><Download size={13} /> Ledger JSON</button>
        <button onClick={exportCsv} className="flex items-center gap-1 bg-slate-800 rounded px-2 py-1.5 text-xs"><Download size={13} /> Ledger CSV</button>
      </div>
      <div className="max-h-[50vh] overflow-y-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-slate-400 border-b border-slate-700"><th className="py-1">Experiment</th><th>Mean</th><th>Coupling</th><th>Stabil.</th><th>Predicted</th><th>Observed</th><th>Residual</th><th>Identity</th></tr></thead>
          <tbody>
            {rows.map(({ p, res }) => (
              <tr key={p.experimentId} className="border-b border-slate-800 font-mono">
                <td className="py-0.5">{p.experimentId}</td>
                <td>{p.ledger?.globalMean.toFixed(3)}</td><td>{p.ledger?.graphCoupling.toFixed(3)}</td><td>{p.ledger?.stabilizationCorrection.toFixed(3)}</td>
                <td>{p.predicted.toFixed(3)}</td><td>{res?.observed.toFixed(3)}</td><td>{res?.residual.toFixed(3)}</td>
                <td>{p.ledger?.identityHolds ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SafetyPanel({ ranked, weights, setWeights, onSelect }: {
  ranked: ReturnType<typeof rankExperiments>;
  weights: RankingWeights;
  setWeights: (w: RankingWeights) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="text-sm">
      <p className="text-slate-300 mb-3">Transparent prioritization for follow-up investigation — a weighted sum of the components below. <b>Not</b> an officially validated fire-risk probability. Uncertainty is proxied by missing-data fraction because Table IX reports no per-measurement uncertainties.</p>
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
        {(Object.keys(weights) as Array<keyof RankingWeights>).map((k) => (
          <label key={k} className="bg-slate-800/60 border border-slate-700 rounded p-2 text-xs">
            <span className="flex justify-between"><span className="capitalize">{k.replace(/([A-Z])/g, ' $1')}</span><span>{weights[k].toFixed(2)}</span></span>
            <input type="range" min={0} max={0.5} step={0.01} value={weights[k]} className="w-full" onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) })} />
          </label>
        ))}
      </div>
      <div className="max-h-[45vh] overflow-y-auto">
        <table className="w-full">
          <thead><tr className="text-left text-slate-400 border-b border-slate-700"><th className="py-1">#</th><th>Experiment</th><th>Score</th><th>Why</th></tr></thead>
          <tbody>
            {ranked.slice(0, 30).map((r, i) => (
              <tr key={r.experiment.id} className="border-b border-slate-800 hover:bg-slate-800/50 cursor-pointer" onClick={() => onSelect(r.experiment.id)}>
                <td className="py-1 text-slate-500">{i + 1}</td>
                <td>{r.experiment.id} · {r.experiment.fuel} · {r.experiment.outcome}</td>
                <td className="text-orange-300">{r.total.toFixed(1)}</td>
                <td className="text-slate-400 text-xs">{r.explanation.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GravityPanel({ ds }: { ds: CombustionDataset }) {
  const gravities: Record<string, number> = {};
  ds.experiments.forEach((e) => { gravities[e.gravity] = (gravities[e.gravity] ?? 0) + 1; });
  return (
    <div className="text-sm space-y-2">
      <div className="bg-amber-500/10 border border-amber-500/40 rounded-lg p-3">
        <h3 className="font-semibold text-amber-200">Status: INCONCLUSIVE by design</h3>
        <p className="text-slate-200 mt-1">Gravity composition of the loaded dataset: {Object.entries(gravities).map(([g, n]) => `${g}: ${n}`).join(', ')}. No controlled comparison can be computed from it.</p>
      </div>
      <p className="text-slate-300"><b>Established by sources:</b> FLEX mapped flammability limits and suppressant effectiveness under reduced gravity [E1], and revealed cool-flame burning after visible-flame extinction in microgravity [E3].</p>
      <p className="text-slate-300"><b>Confounders:</b> fuel, O2, diluents (CO2/He), pressure, and droplet diameter all vary and all affect extinction and burning rate; any gravity claim must match or control them.</p>
      <p className="text-slate-300"><b>Missing:</b> a bundled, directly comparable normal-gravity dataset on the same condition grid. Until one is ingested with its own provenance, this stays inconclusive — the scientifically correct state.</p>
    </div>
  );
}

function AssistantPanel({ answer }: { answer: AssistantAnswer | null }) {
  if (!answer) return <p className="text-sm text-slate-400">Ask a question in the Research Intelligence panel (right sidebar). The answer and its full evidence list will appear here.</p>;
  return (
    <div className="text-sm">
      <p className="whitespace-pre-wrap text-slate-200 mb-3">{answer.answer}</p>
      {answer.gaps.length > 0 && <p className="text-amber-200 mb-3">Research gaps: {answer.gaps.join(' ')}</p>}
      <h3 className="font-semibold mb-1.5">Evidence</h3>
      {answer.evidence.map((e) => (
        <p key={e.id} className="mb-1.5">
          <span className="text-orange-300 font-mono">[{e.id}]</span>{' '}
          <a className="underline" href={e.sourceUrl} target="_blank" rel="noreferrer">{e.sourceTitle}</a>
          <span className="text-slate-500"> · {e.kind}</span>
        </p>
      ))}
      <p className="text-xs text-slate-500 mt-2">Answers are grounded in retrieved evidence only; Gemini phrasing (when a server key exists) is citation-validated before display, and rejected phrasing falls back to the extractive answer.</p>
    </div>
  );
}

function PresentationPanel({ ds, comparison }: { ds: CombustionDataset; comparison: ReturnType<typeof runCombustionComparison> | null }) {
  const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="bg-slate-800/50 border border-slate-700 rounded-lg p-3">
      <h3 className="font-semibold text-orange-200 mb-1">{title}</h3>
      <div className="text-sm text-slate-200 space-y-1.5">{children}</div>
    </div>
  );
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <Block title="Problem"><p>Microgravity combustion research is distributed across experiments and technical reports, making comparisons and fire-safety interpretation difficult. FLEX alone produced 276 droplet tests whose results live in a PDF table.</p></Block>
      <Block title="Solution"><p>One unified instrument: the original HRM manifold, evolved — every node a real experiment, every panel reading the same state, with transparent forecasting, an exact attribution ledger, and evidence-cited AI.</p></Block>
      <Block title="Technical contribution"><p>Typed combustion state X = [Φ, G, T, M, C, H, B] over the preserved HRM architecture; leakage-safe held-out model comparison; visual encodings unit-tested against the data they represent.</p></Block>
      <Block title="Demonstration (live)">
        <p>Dataset: {ds.title} ({ds.experiments.length} tests, kind: {ds.kind}).</p>
        {comparison && <p>Held-out benchmark — {comparison.scores.map((s) => `${s.model}: MAE ${s.mae.toFixed(4)}`).join(' · ')}. Winner as computed: <b>{comparison.winner}</b>.</p>}
        <p>Select any node: telemetry, HRM field state, dynamics, safety rank, and AI context all update together. Press Play to run its derived trajectory.</p>
      </Block>
      <Block title="Limitations"><p>Only FLEX measurements are ingested; BASS/ACME/CFI-G are metadata-only. No matched 1-g dataset exists here, so gravity comparison is inconclusive. The HRM graph model is unvalidated and does not beat OLS regression on this data. Full list: LIMITATIONS.md.</p></Block>
      <Block title="Future work"><p>Ingest BASS/ACME/CFI-G data from NASA PSI, add a matched normal-gravity set, quantify per-measurement uncertainty, and seek independent scientific evaluation.</p>
        <p>Challenge: <a className="text-orange-300 underline" href={CHALLENGE_URL} target="_blank" rel="noreferrer">NASA Space Apps 2026 — Flame in Freefall</a>. Not endorsed by NASA.</p></Block>
    </div>
  );
}
