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
  id: string;          // stable key (i + content hash-ish)
  body: string;        // markdown content of the iteration (without "## ITERATION N" heading)
  feedback: string;
  regenerating: boolean;
  regenError?: string;
}

interface Props {
  projectId: string;
  originalScript: string;
  /** Hide the close button (when used standalone on its own page) */
  hideClose?: boolean;
  onClose?: () => void;
}

// Split the streamed markdown into individual iteration blocks based on `## ITERATION N` headings.
function splitIntoIterations(text: string): { body: string }[] {
  const parts = text.split(/\n##\s+ITERATION\s+\d+\s*\n/i);
  // First chunk before the first heading is preamble — drop it
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

  const [loading, setLoading] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [error, setError] = useState('');
  const [iterations, setIterations] = useState<Iteration[]>([]);

  const toggleStrategy = (value: string) => {
    setStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const handleGenerate = async () => {
    if (strategies.size === 0 && !otherInstructions.trim()) {
      setError('Pick at least one strategy or write custom instructions.');
      return;
    }
    if (!originalScript.trim()) {
      setError('Paste an original script first.');
      return;
    }
    const n = Math.max(1, parseInt(count) || 3);

    setLoading(true);
    setStreamedText('');
    setError('');
    setIterations([]);

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
        setError(errMsg);
        setLoading(false);
        return;
      }

      let accumulated = '';
      for await (const evt of parseSSE(res.body)) {
        if (evt.event === 'text') {
          const chunk = (evt.data as { text: string }).text;
          accumulated += chunk;
          setStreamedText(accumulated);
        } else if (evt.event === 'error') {
          setError((evt.data as { error: string }).error);
        }
      }

      // Stream finished — split into editable iterations
      const parts = splitIntoIterations(accumulated);
      setIterations(
        parts.map((p, i) => ({
          id: `iter-${Date.now()}-${i}`,
          body: p.body,
          feedback: '',
          regenerating: false,
        })),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    }

    setLoading(false);
  };

  const updateIteration = (id: string, patch: Partial<Iteration>) => {
    setIterations((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  };

  const regenerateOne = async (it: Iteration) => {
    updateIteration(it.id, { regenerating: true, regenError: undefined });
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
        updateIteration(it.id, { regenerating: false, regenError: err.error || `Error ${res.status}` });
        return;
      }
      const data = await res.json();
      updateIteration(it.id, { body: (data.output as string).trim(), regenerating: false, feedback: '' });
    } catch (e) {
      updateIteration(it.id, {
        regenerating: false,
        regenError: e instanceof Error ? e.message : 'Unexpected error',
      });
    }
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="border border-accent-blue/30 bg-accent-blue/[0.03] rounded-lg p-5 mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary text-sm font-semibold">Iterate on this video script</p>
          <p className="text-text-muted text-xs mt-0.5">Generate sibling scripts that keep what works.</p>
        </div>
        {!hideClose && onClose && (
          <button onClick={onClose} className="text-text-muted hover:text-text-primary text-xs">
            ✕ Close
          </button>
        )}
      </div>

      {/* Strategy pills */}
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

      {/* Other instructions */}
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
        disabled={loading}
      >
        {loading
          ? `Generating ${parseInt(count) || 3} script${parseInt(count) === 1 ? '' : 's'}…`
          : `Generate ${parseInt(count) || 3} script${parseInt(count) === 1 ? '' : 's'}`}
      </button>

      {error && (
        <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red">
          {error}
        </div>
      )}

      {/* Live streaming preview (until stream ends and we split) */}
      {loading && streamedText && (
        <div className="border-t border-bg-border pt-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest mb-3">
            Streaming…
            <span className="ml-2 text-accent-blue animate-pulse">●</span>
          </p>
          <div className="result-content max-h-80 overflow-y-auto bg-bg-base/30 rounded-md p-3">
            <ReactMarkdown>{streamedText}</ReactMarkdown>
          </div>
        </div>
      )}
      {loading && !streamedText && (
        <div className="border-t border-bg-border pt-4 flex items-center gap-3 text-text-muted text-xs">
          <div className="w-4 h-4 border-2 border-accent-blue/30 border-t-accent-blue rounded-full animate-spin" />
          Waiting for first tokens…
        </div>
      )}

      {/* Editable iterations after stream completes */}
      {!loading && iterations.length > 0 && (
        <div className="border-t border-bg-border pt-4 space-y-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest">
            {iterations.length} script{iterations.length === 1 ? '' : 's'} generated
          </p>
          {iterations.map((it, idx) => (
            <div key={it.id} className="border border-bg-border rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated">
                <span className="text-text-primary text-xs font-semibold">Iteration {idx + 1}</span>
                <button
                  onClick={() => copyText(it.body)}
                  className="btn-secondary text-xs px-2.5 py-1"
                >
                  Copy
                </button>
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
                  onChange={(e) => updateIteration(it.id, { feedback: e.target.value })}
                  disabled={it.regenerating}
                />
                {it.regenError && (
                  <div className="border border-accent-red/40 bg-accent-red/5 rounded px-2 py-1.5 text-xs text-accent-red">
                    {it.regenError}
                  </div>
                )}
                <button
                  onClick={() => regenerateOne(it)}
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
  );
}
