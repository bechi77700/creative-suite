'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseSSE } from '@/lib/streaming';

export const VIDEO_ITERATION_STRATEGIES = [
  { value: 'hook', label: 'Hook variation', desc: 'Same body & CTA, new opening hooks' },
  { value: 'angle', label: 'Angle pivot', desc: 'Same structure, new psychological angle' },
  { value: 'pain-promise', label: 'Pain/Promise intensification', desc: 'Push the lever harder' },
  { value: 'demographic', label: 'Demographic pivot', desc: 'Adapt to a different sub-segment' },
  { value: 'cta', label: 'CTA / Urgency variation', desc: 'New call-to-action or urgency mechanic' },
  { value: 'length', label: 'Length adjustment', desc: 'Tighter or longer version' },
  { value: 'tone', label: 'Tone shift', desc: 'Educational ↔ confrontational ↔ peer ↔ urgent' },
  { value: 'format', label: 'Format swap', desc: 'Talking-head ↔ POV ↔ before/after ↔ story' },
];

interface Iteration {
  id: string;
  body: string;
  feedback: string;
  regenerating: boolean;
  regenError?: string;
}

interface ScriptRun {
  id: string;
  strategiesUsed: string[];
  loading: boolean;
  streamedText: string;
  error: string;
  iterations: Iteration[];
}

interface Props {
  projectId: string;
  originalScript: string;
  hideClose?: boolean;
  onClose?: () => void;
}

function splitIntoIterations(text: string): { body: string }[] {
  const parts = text.split(/\n##\s+ITERATION\s+\d+\s*\n/i);
  return parts.slice(1).map((p) => ({ body: p.trim() }));
}

export default function VideoIteratePanel({
  projectId,
  originalScript,
  hideClose,
  onClose,
}: Props) {
  const [strategies, setStrategies] = useState<Set<string>>(new Set());
  const [otherInstructions, setOtherInstructions] = useState('');
  const [count, setCount] = useState('3');

  const [runs, setRuns] = useState<ScriptRun[]>([]);
  const [validationError, setValidationError] = useState('');

  const toggleStrategy = (value: string) => {
    setStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const updateRun = (runId: string, patch: Partial<ScriptRun> | ((r: ScriptRun) => Partial<ScriptRun>)) => {
    setRuns((prev) =>
      prev.map((r) => {
        if (r.id !== runId) return r;
        const p = typeof patch === 'function' ? patch(r) : patch;
        return { ...r, ...p };
      }),
    );
  };

  const handleGenerate = async () => {
    setValidationError('');
    if (strategies.size === 0 && !otherInstructions.trim()) {
      setValidationError('Pick at least one strategy or write custom instructions.');
      return;
    }
    if (!originalScript.trim()) {
      setValidationError('Paste an original script first.');
      return;
    }
    const n = Math.max(1, parseInt(count) || 3);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: ScriptRun = {
      id: runId,
      strategiesUsed: Array.from(strategies),
      loading: true,
      streamedText: '',
      error: '',
      iterations: [],
    };
    setRuns((prev) => [newRun, ...prev]);

    try {
      const res = await fetch('/api/generate/iterate-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          originalScript,
          strategies: Array.from(strategies),
          otherInstructions,
          count: n,
        }),
      });

      if (!res.ok || !res.body) {
        let errMsg = `Server error ${res.status}`;
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch { /* noop */ }
        updateRun(runId, { error: errMsg, loading: false });
        return;
      }

      let accumulated = '';
      for await (const evt of parseSSE(res.body)) {
        if (evt.event === 'text') {
          const chunk = (evt.data as { text: string }).text;
          accumulated += chunk;
          updateRun(runId, { streamedText: accumulated });
        } else if (evt.event === 'error') {
          updateRun(runId, { error: (evt.data as { error: string }).error });
        }
      }

      const parts = splitIntoIterations(accumulated);
      updateRun(runId, {
        iterations: parts.map((p, i) => ({
          id: `${runId}-iter-${i}`,
          body: p.body,
          feedback: '',
          regenerating: false,
        })),
        loading: false,
      });
    } catch (e) {
      updateRun(runId, {
        error: e instanceof Error ? e.message : 'Unexpected error',
        loading: false,
      });
    }
  };

  const updateIteration = (runId: string, iterId: string, patch: Partial<Iteration>) => {
    updateRun(runId, (r) => ({
      iterations: r.iterations.map((it) => (it.id === iterId ? { ...it, ...patch } : it)),
    }));
  };

  const regenerateOne = async (runId: string, it: Iteration) => {
    updateIteration(runId, it.id, { regenerating: true, regenError: undefined });
    try {
      const res = await fetch('/api/generate/iterate-video/regenerate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          originalScript,
          currentIteration: it.body,
          feedback: it.feedback,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        updateIteration(runId, it.id, { regenerating: false, regenError: err.error || `Error ${res.status}` });
        return;
      }
      const data = await res.json();
      updateIteration(runId, it.id, {
        body: (data.output as string).trim(),
        regenerating: false,
        feedback: '',
      });
    } catch (e) {
      updateIteration(runId, it.id, {
        regenerating: false,
        regenError: e instanceof Error ? e.message : 'Unexpected error',
      });
    }
  };

  const deleteRun = (runId: string) => {
    if (!confirm('Delete this script set?')) return;
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const deleteIteration = (runId: string, iterId: string) => {
    if (!confirm('Delete this script?')) return;
    updateRun(runId, (r) => ({
      iterations: r.iterations.filter((it) => it.id !== iterId),
    }));
  };

  const clearAll = () => {
    if (runs.length === 0) return;
    if (!confirm(`Clear all ${runs.length} script set${runs.length !== 1 ? 's' : ''}?`)) return;
    setRuns([]);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const anyLoading = runs.some((r) => r.loading);

  return (
    <div className="border border-accent-blue/30 bg-accent-blue/[0.03] rounded-lg p-5 mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary text-sm font-semibold">Iterate on this video script</p>
          <p className="text-text-muted text-xs mt-0.5">Generate sibling scripts that keep what works.</p>
        </div>
        <div className="flex items-center gap-3">
          {runs.length > 0 && (
            <button
              onClick={clearAll}
              className="text-text-muted hover:text-accent-red text-[10px] uppercase tracking-widest transition-colors"
            >
              Clear all ({runs.length})
            </button>
          )}
          {!hideClose && onClose && (
            <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">
              ✕ Close
            </button>
          )}
        </div>
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-2">
          Iteration strategies <span className="normal-case">(pick one or more)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {VIDEO_ITERATION_STRATEGIES.map((s) => {
            const active = strategies.has(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleStrategy(s.value)}
                title={s.desc}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  active
                    ? 'bg-accent-blue/20 border-accent-blue/60 text-accent-blue'
                    : 'border-bg-border text-text-secondary hover:border-text-muted'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
          Other / custom instructions <span className="normal-case">(optional)</span>
        </label>
        <textarea
          className="input-field resize-none text-xs"
          rows={3}
          placeholder='e.g. "what worked is the opening callout — push urgency further" / "test versions targeting men 40+"'
          value={otherInstructions}
          onChange={(e) => setOtherInstructions(e.target.value)}
        />
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
          Number of scripts
        </label>
        <input
          className="input-field text-xs"
          type="number"
          min="1"
          max="20"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>

      <button
        onClick={handleGenerate}
        className="btn-primary w-full text-xs"
        disabled={anyLoading}
      >
        {anyLoading
          ? `Generating…`
          : `Generate ${parseInt(count) || 3} script${parseInt(count) === 1 ? '' : 's'}`}
      </button>

      {validationError && (
        <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red">
          {validationError}
        </div>
      )}

      {/* Stack of script runs */}
      {runs.map((run, runIdx) => (
        <div key={run.id} className="border-t border-bg-border pt-4 group/run">
          <div className="flex items-center justify-between mb-3">
            <p className="text-text-secondary text-xs uppercase tracking-widest">
              Run {runs.length - runIdx}
              {run.loading && <span className="ml-2 text-accent-blue animate-pulse">● streaming…</span>}
              {run.strategiesUsed.length > 0 && (
                <span className="ml-2 text-text-muted normal-case">
                  ({run.strategiesUsed.join(', ')})
                </span>
              )}
            </p>
            <button
              onClick={() => deleteRun(run.id)}
              title="Delete this script set"
              className="text-text-muted/40 hover:text-accent-red text-sm w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover/run:opacity-100"
            >
              ✕
            </button>
          </div>

          {run.error && (
            <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red mb-3">
              {run.error}
            </div>
          )}

          {run.loading && run.streamedText && (
            <div className="result-content max-h-80 overflow-y-auto bg-bg-base/30 rounded-md p-3 mb-3">
              <ReactMarkdown>{run.streamedText}</ReactMarkdown>
            </div>
          )}
          {run.loading && !run.streamedText && (
            <div className="flex items-center gap-3 text-text-muted text-xs mb-3">
              <div className="w-4 h-4 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
              Waiting for first tokens…
            </div>
          )}

          {!run.loading && run.iterations.length > 0 && (
            <div className="space-y-4">
              <p className="text-text-secondary text-xs uppercase tracking-widest">
                {run.iterations.length} script{run.iterations.length === 1 ? '' : 's'} generated
              </p>
              {run.iterations.map((it, idx) => (
                <div key={it.id} className="border border-bg-border rounded-lg overflow-hidden group/iter">
                  <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated">
                    <span className="text-text-primary text-xs font-semibold">Iteration {idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyText(it.body)}
                        className="btn-secondary text-xs px-2.5 py-1"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => deleteIteration(run.id, it.id)}
                        title="Delete this script"
                        className="text-text-muted/40 hover:text-accent-red text-sm w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover/iter:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  <div className="p-4 result-content text-sm">
                    <ReactMarkdown>{it.body}</ReactMarkdown>
                  </div>

                  <div className="border-t border-bg-border bg-bg-base/40 p-3 space-y-2">
                    <label className="text-text-muted text-[10px] uppercase tracking-widest block">
                      Feedback for regeneration <span className="normal-case">(optional)</span>
                    </label>
                    <textarea
                      className="input-field resize-none text-xs"
                      rows={2}
                      placeholder="e.g. hook is too soft, CTA needs more urgency, cut 20% of length…"
                      value={it.feedback}
                      onChange={(e) => updateIteration(run.id, it.id, { feedback: e.target.value })}
                      disabled={it.regenerating}
                    />
                    {it.regenError && (
                      <div className="border border-accent-red/40 bg-accent-red/5 rounded px-2 py-1.5 text-xs text-accent-red">
                        {it.regenError}
                      </div>
                    )}
                    <button
                      onClick={() => regenerateOne(run.id, it)}
                      disabled={it.regenerating}
                      className="btn-secondary w-full text-xs"
                    >
                      {it.regenerating
                        ? 'Regenerating…'
                        : it.feedback.trim()
                        ? '↻ Regenerate with feedback'
                        : '↻ Regenerate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
