import React, { useState } from 'react';
import { X, Radio, CheckCircle2, AlertCircle, RefreshCw, Key, Globe, Layers, ArrowRight } from 'lucide-react';
import { TelemetryIngestionConfig, TelemetrySourceMode, ExecutionMode, HubNode, FieldChannels } from '../types/hrm';
import { fetchLiveTelemetry } from '../engine/telemetryAdapter';

interface TelemetryIngestionModalProps {
  config: TelemetryIngestionConfig;
  onUpdateConfig: (newConfig: TelemetryIngestionConfig) => void;
  nodes: HubNode[];
  onClose: () => void;
}

export const TelemetryIngestionModal: React.FC<TelemetryIngestionModalProps> = ({
  config,
  onUpdateConfig,
  nodes,
  onClose,
}) => {
  const [sourceMode, setSourceMode] = useState<TelemetrySourceMode>(config.sourceMode);
  const [executionMode, setExecutionMode] = useState<ExecutionMode>(config.executionMode || (config.sourceMode === 'simulated' ? 'SIMULATED' : 'LIVE'));
  const [endpoint, setEndpoint] = useState<string>(config.endpoint || '/api/telemetry/sample/prometheus');
  const [bearerToken, setBearerToken] = useState<string>(config.bearerToken || '');
  const [isTesting, setIsTesting] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    parsedData?: Map<string, FieldChannels>;
  } | null>(null);

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);

    const testConfig: TelemetryIngestionConfig = {
      ...config,
      sourceMode,
      executionMode,
      endpoint,
      bearerToken,
    };

    const res = await fetchLiveTelemetry(testConfig, nodes);
    setIsTesting(false);

    if (res.success) {
      setTestResult({
        success: true,
        message:
          sourceMode === 'simulated'
            ? 'Simulated plant state active. Synthetic physical ground-truth generator operational.'
            : `Successfully parsed metrics for ${res.data?.size || 0} planetary datacenter hubs.`,
        parsedData: res.data,
      });
    } else {
      setTestResult({
        success: false,
        message: res.error || 'Failed to connect to endpoint',
      });
    }
  };

  const handleSave = () => {
    const updated: TelemetryIngestionConfig = {
      ...config,
      sourceMode,
      executionMode,
      endpoint,
      bearerToken,
      status: testResult?.success ? 'connected' : config.status,
      lastSyncTimeMs: Date.now(),
    };
    onUpdateConfig(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">
                Live Telemetry Ingestion Bridge
              </h2>
              <p className="text-xs text-slate-400 font-mono">
                OpenTelemetry (OTLP) & Prometheus HTTP API Ground-Truth Integration
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
          {/* Real vs Simulated Disclaimer */}
          <div className="p-3 bg-amber-950/20 border border-amber-500/30 rounded-xl text-amber-200/90 leading-relaxed">
            <div className="flex items-center gap-2 font-semibold text-amber-300 mb-1">
              <Globe className="w-4 h-4" />
              <span>Real-World vs. Simulated Plant Horizon</span>
            </div>
            In Simulated Mode, Model A generates a 1-millisecond physical plant state with diurnal solar curves and geodesic fiber delays.
            Connecting live Prometheus or OTLP streams replaces simulated plant channels with real-world datacenter telemetry.
          </div>

          {/* Source Mode Selector */}
          <div>
            <label className="block text-slate-400 font-semibold mb-2 font-mono uppercase text-[11px]">
              Ingestion Source Mode
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSourceMode('simulated');
                  setEndpoint('/api/telemetry/sample/prometheus');
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  sourceMode === 'simulated'
                    ? 'bg-slate-800 border-cyan-500 text-white ring-1 ring-cyan-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-slate-200">Simulated Plant</div>
                <div className="text-[10px] text-slate-500 mt-1">1ms physical plant twin with speed-of-light delays</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSourceMode('prometheus');
                  setEndpoint('/api/telemetry/sample/prometheus');
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  sourceMode === 'prometheus'
                    ? 'bg-slate-800 border-cyan-500 text-white ring-1 ring-cyan-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-slate-200">Prometheus API</div>
                <div className="text-[10px] text-slate-500 mt-1">/api/v1/query_range HTTP PromQL adapter</div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setSourceMode('opentelemetry');
                  setEndpoint('/api/telemetry/sample/prometheus');
                }}
                className={`p-3 rounded-xl border text-left transition-all ${
                  sourceMode === 'opentelemetry'
                    ? 'bg-slate-800 border-cyan-500 text-white ring-1 ring-cyan-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-slate-200">OpenTelemetry</div>
                <div className="text-[10px] text-slate-500 mt-1">OTLP JSON/HTTP ResourceMetrics format</div>
              </button>
            </div>
          </div>

          {/* Execution Mode Selector: SIMULATED | LIVE | HYBRID */}
          <div>
            <label className="block text-slate-400 font-semibold mb-2 font-mono uppercase text-[11px] flex items-center justify-between">
              <span>Execution & Provenance Mode</span>
              <span className="text-cyan-400 font-normal">Strict Invariant Enforced</span>
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setExecutionMode('SIMULATED')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  executionMode === 'SIMULATED'
                    ? 'bg-slate-800 border-cyan-500 text-white ring-1 ring-cyan-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-slate-200">SIMULATED</div>
                <div className="text-[10px] text-slate-500 mt-1">Ground truth plant packet transmissions only</div>
              </button>

              <button
                type="button"
                onClick={() => setExecutionMode('LIVE')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  executionMode === 'LIVE'
                    ? 'bg-slate-800 border-emerald-500 text-white ring-1 ring-emerald-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-emerald-400">LIVE</div>
                <div className="text-[10px] text-slate-500 mt-1">Simulated packets disabled; real external streams only</div>
              </button>

              <button
                type="button"
                onClick={() => setExecutionMode('HYBRID')}
                className={`p-3 rounded-xl border text-left transition-all ${
                  executionMode === 'HYBRID'
                    ? 'bg-slate-800 border-indigo-500 text-white ring-1 ring-indigo-500/20'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-slate-300'
                }`}
              >
                <div className="font-semibold text-indigo-400">HYBRID</div>
                <div className="text-[10px] text-slate-500 mt-1">Explicit provenance: live overrides simulated where fresh</div>
              </button>
            </div>
          </div>

          {/* Endpoint Configuration */}
          {sourceMode !== 'simulated' && (
            <div className="space-y-4 pt-2">
              <div>
                <label className="block text-slate-400 font-semibold mb-1 font-mono uppercase text-[11px]">
                  Collector Endpoint URL
                </label>
                <input
                  type="text"
                  value={endpoint}
                  onChange={e => setEndpoint(e.target.value)}
                  placeholder="https://prometheus.internal.corp/api/v1/query_range"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Tip: Use default <code className="text-cyan-400">/api/telemetry/sample/prometheus</code> to test sample real-world payloads.
                </span>
              </div>

              <div>
                <label className="block text-slate-400 font-semibold mb-1 font-mono uppercase text-[11px] flex items-center gap-1">
                  <Key className="w-3 h-3" />
                  <span>Bearer Token / API Key (Optional)</span>
                </label>
                <input
                  type="password"
                  value={bearerToken}
                  onChange={e => setBearerToken(e.target.value)}
                  placeholder="Bearer eyJhbGciOi..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-200 font-mono text-xs focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          )}

          {/* Test Connection Button & Result */}
          <div className="pt-2">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-xs transition-all ${
                isTesting
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-cyan-500/30'
              }`}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin' : ''}`} />
              <span>{isTesting ? 'Validating Collector Stream...' : 'Test Collector Connection'}</span>
            </button>

            {testResult && (
              <div
                className={`mt-3 p-3 rounded-lg border text-xs font-mono flex items-start gap-2 ${
                  testResult.success
                    ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300'
                    : 'bg-rose-950/30 border-rose-500/40 text-rose-300'
                }`}
              >
                {testResult.success ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-semibold">{testResult.message}</div>
                  {testResult.parsedData && (
                    <div className="mt-2 text-[11px] text-slate-300">
                      Mapped nodes: {Array.from(testResult.parsedData.keys()).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="text-[11px] text-slate-500 font-mono">
            Mode: <b className="text-slate-300 uppercase">{sourceMode}</b>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold shadow-lg shadow-cyan-500/20"
            >
              Apply Ingestion Mode
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
