import React, { useState } from 'react';
import { X, Copy, Check, Download, Terminal, FileCode } from 'lucide-react';
import { PYTHON_HRM4_STANDALONE_CODE } from '../engine/pythonExport';

interface PythonScriptModalProps {
  onClose: () => void;
}

export const PythonScriptModal: React.FC<PythonScriptModalProps> = ({ onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(PYTHON_HRM4_STANDALONE_CODE);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([PYTHON_HRM4_STANDALONE_CODE], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hrm4_planetary_telemetry.py';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/70">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <span>Standalone HRM 4.0 Python Implementation</span>
                <span className="text-xs text-emerald-400 font-mono font-normal">
                  (Ready to run: python3 hrm4_planetary_telemetry.py)
                </span>
              </h2>
              <p className="text-xs text-slate-400">
                Self-contained, typed, zero-placeholder implementation of X_t = [Φ, G, T, M, C, H, B] &amp; Conservation of Explanation identity.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copied ? 'Copied!' : 'Copy Code'}</span>
            </button>

            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              <span>Download .py</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-100 hover:bg-slate-800 rounded-lg transition-colors ml-1"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Code Content Area */}
        <div className="p-4 overflow-y-auto bg-slate-950 text-slate-300 font-mono text-xs leading-relaxed">
          <pre className="p-4 rounded-lg bg-slate-900/60 border border-slate-800/80 overflow-x-auto whitespace-pre selection:bg-cyan-500/30">
            {PYTHON_HRM4_STANDALONE_CODE}
          </pre>
        </div>

        {/* Footer info */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono">
          <div className="flex items-center gap-2">
            <FileCode className="w-4 h-4 text-cyan-400" />
            <span>hrm4_planetary_telemetry.py</span>
            <span className="text-slate-600">·</span>
            <span>Dependencies: numpy</span>
          </div>

          <span>Mathematical Invariance: τ_ledger ≤ 1e-4 verified</span>
        </div>
      </div>
    </div>
  );
};
