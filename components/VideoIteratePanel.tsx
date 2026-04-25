'use client';

// Iterate Video module — generates SIBLING video scripts from a winning
// reference (pasted script OR analyzed video). Honors the iterate-video SOP:
// 10-axis closed catalog, 1-2 axes max per generation, Auto mode if user
// picks none.

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { parseSSE } from '@/lib/streaming';
import type { VideoAnalysis } from '@/lib/gemini-video';

// 10-axis catalog — MUST stay in sync with iterate-video-sop.md
// (the closed-vocabulary list there). Order matters for the UI.
export const ITERATE_VIDEO_AXES = [
  { value: 'Format', desc: 'UGC selfie / talking-head / demo / split-screen reaction…' },
  { value: 'Concept', desc: '"I tried it for 30 days", "stranger asks 5 questions"…' },
  { value: 'Angle', desc: 'scarcity / social proof / transformation / problem-solution / identity…' },
  { value: 'Message', desc: 'core promise the viewer leaves with' },
  { value: 'Hook', desc: 'curiosity gap / contrarian / stat shock / stranger-stop / question…' },
  { value: 'Body', desc: 'testimonial / demo loop / before-after / story arc / listicle…' },
  { value: 'Montage vidéo', desc: 'cut speed + dominant treatment (fast cuts, b-roll heavy…)' },
  { value: 'Awareness', desc: 'Unaware → Problem → Solution → Product → Most Aware' },
  { value: 'Acteur', desc: 'peer user / aspirational / expert / founder / faceless POV…' },
  { value: 'Lieu', desc: 'physical setting (bathroom, kitchen, outdoor, studio…)' },
] as const;

const MAX_AXES = 2;

interface Iteration {
  id: string;
  body: string;
  feedback: string;
  regenerating: boolean;
  regenError?: string;
}

interface ScriptRun {
  id: string;
  axesUsed: string[];
  loading: boolean;
  streamedText: string;
  error: string;
  iterations: Iteration[];
}

interface Props {
  projectId: string;
  /** Original winning script (verbatim VO if reference is a video). */
  originalScript: string;
  /** Optional structured analysis when the source is a video. Adds context. */
  videoAnalysis?: VideoAnalysis | null;
  hideClose?: boolean;
  onClose?: () => void;
}

function splitIntoIterations(text: string): { body: string }[] {
  // Split on "## Sibling N" (SOP) OR legacy "## ITERATION N"
  const parts = text.split(/\n##\s+(?:Sibling|ITERATION)\s+\d+\s*[—\-:]?[^\n]*\n/i);
  return parts.slice(1).map((p) => ({ body: p.trim() }));
}

export default function VideoIteratePanel({
  projectId,
  originalScript,
  videoAnalysis,
  hideClose,
  onClose,
}: Props) {
  const [axes, setAxes] = useState<Set<string>>(new Set());
  const [otherInstructions, setOtherInstructions] = useState('');
  const [count, setCount] = useState('4');

  const [runs, setRuns] = useState<ScriptRun[]>([]);
  const [validationError, setValidationError] = useState('');

  const toggleAxis = (value: string) => {
    setAxes((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else if (next.size < MAX_AXES) {
        next.add(value);
      }
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
    if (!originalScript.trim() && !videoAnalysis) {
      setValidationError('Provide a reference script or upload a video first.');
      return;
    }
    const n = Math.max(1, parseInt(count) || 4);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: ScriptRun = {
      id: runId,
      axesUsed: Array.from(axes),
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
          videoAnalysis,
          axes: Array.from(axes),
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
  const isAutoMode = axes.size === 0;
  const atCap = axes.size >= MAX_AXES;

  return (
    <div className="border border-accent-blue/30 bg-accent-blue/[0.03] rounded-lg p-5 mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary text-sm font-semibold">Iterate on this video script</p>
          <p className="text-text-muted text-xs mt-0.5">
            Generate sibling scripts that keep what works — vary 1-2 axes max.
          </p>
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
          Axes to vary <span className="normal-case">(optional · max {MAX_AXES} · leave empty = Auto mode, Claude proposes the spread)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ITERATE_VIDEO_AXES.map((s) => {
            const active = axes.has(s.value);
            const disabled = !active && atCap;
            return (
              <button
                key={s.value}
                onClick={() => toggleAxis(s.value)}
                title={s.desc}
                disabled={disabled}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  active
                    ? 'bg-accent-blue/20 border-accent-blue/60 text-accent-blue'
                    : disabled
                    ? 'border-bg-border/50 text-text-muted/40 cursor-not-allowed'
                    : 'border-bg-border text-text-secondary hover:border-text-muted'
                }`}
              >
                {s.value}
              </button>
            );
          })}
        </div>
        <p className="text-text-muted text-[10px] mt-2">
          {isAutoMode
            ? '● Auto mode — Claude will pick the most useful axes to vary across siblings.'
            : `● User-directed mode — every sibling will vary only: ${Array.from(axes).join(' + ')}.`}
        </p>
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
          Other / custom instructions <span className="normal-case">(optional)</span>
        </label>
        <textarea
          className="input-field resize-none text-xs"
          rows={3}
          placeholder='e.g. "push urgency further" / "test versions targeting men 40+" / "we can mention the 30-day refund [NEW CLAIM]"'
          value={otherInstructions}
          onChange={(e) => setOtherInstructions(e.target.value)}
        />
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
          Number of siblings
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
          : `Generate ${parseInt(count) || 4} sibling${parseInt(count) === 1 ? '' : 's'}`}
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
              <span className="ml-2 text-text-muted normal-case">
                ({run.axesUsed.length === 0 ? 'auto mode' : `varying ${run.axesUsed.join(' + ')}`})
              </span>
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
                {run.iterations.length} sibling{run.iterations.length === 1 ? '' : 's'} generated
              </p>
              {run.iterations.map((it, idx) => (
                <div key={it.id} className="border border-bg-border rounded-lg overflow-hidden group/iter">
                  <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated">
                    <span className="text-text-primary text-xs font-semibold">Sibling {idx + 1}</span>
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
