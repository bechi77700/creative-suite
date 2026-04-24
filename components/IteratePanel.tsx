'use client';

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import PromptImageGenerator from './PromptImageGenerator';
import { RefImage } from './MultiImageInput';
import { parseSSE, extractClosedCodeBlocks } from '@/lib/streaming';

// Image iterations are always rendered with nano-banana-2 (with the ref
// image forwarded so it's faithful to the source).
const IMAGE_MODEL = 'nano-banana-2';

export const ITERATION_STRATEGIES = [
  { value: 'hook', label: 'Hook variation', desc: 'Same visual, new headlines' },
  { value: 'format', label: 'Format swap', desc: 'Same message, new layout' },
  { value: 'angle', label: 'Angle pivot', desc: 'Same structure, new psychological angle' },
  { value: 'social-proof', label: 'Social proof swap', desc: 'Change credibility element' },
  { value: 'pain-promise', label: 'Pain/Promise intensification', desc: 'Push the lever harder' },
  { value: 'demographic', label: 'Demographic pivot', desc: 'Adapt to a different sub-segment' },
  { value: 'cta', label: 'CTA / Urgency variation', desc: 'New call-to-action or urgency mechanic' },
];

type ImageStatus = 'idle' | 'generating' | 'done' | 'error';
interface ImageState {
  status: ImageStatus;
  url?: string;
  error?: string;
}

interface IterationRun {
  id: string;
  count: number;
  strategiesUsed: string[];
  streamedText: string;
  loading: boolean;
  error: string;
  imageStates: Record<string, ImageState>;
  withImages: boolean;
}

interface Props {
  projectId: string;
  /** Original winning prompt — optional if a reference image is provided */
  originalPrompt?: string;
  /** Single ref image (legacy). Used if initialImages is empty/undefined. */
  initialImage?: { base64: string; mimeType: string; previewDataUri: string };
  /** Multiple ref images (preferred). Forwarded as source AND for image gen. */
  initialImages?: RefImage[];
  /** Optional callback when the panel is closed/dismissed */
  onClose?: () => void;
  /** Hide the close button (when used standalone on its own page) */
  hideClose?: boolean;
}

export default function IteratePanel({
  projectId,
  originalPrompt = '',
  initialImage,
  initialImages,
  onClose,
  hideClose,
}: Props) {
  const refs: RefImage[] =
    initialImages && initialImages.length > 0
      ? initialImages
      : initialImage
      ? [initialImage]
      : [];
  const hasRefs = refs.length > 0;
  const [strategies, setStrategies] = useState<Set<string>>(new Set());
  const [otherInstructions, setOtherInstructions] = useState('');
  const [count, setCount] = useState('3');
  const [autoImagesEnabled, setAutoImagesEnabled] = useState(true);

  const [runs, setRuns] = useState<IterationRun[]>([]);
  const [validationError, setValidationError] = useState('');

  // Per-run fired image-prompt tracking
  const firedImagePromptsRef = useRef<Map<string, Set<string>>>(new Map());

  const toggleStrategy = (value: string) => {
    setStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const updateRun = (runId: string, patch: Partial<IterationRun> | ((r: IterationRun) => Partial<IterationRun>)) => {
    setRuns((prev) =>
      prev.map((r) => {
        if (r.id !== runId) return r;
        const p = typeof patch === 'function' ? patch(r) : patch;
        return { ...r, ...p };
      }),
    );
  };

  const fireImageGen = async (runId: string, promptText: string) => {
    updateRun(runId, (r) => ({
      imageStates: { ...r.imageStates, [promptText]: { status: 'generating' } },
    }));

    const referenceImages = hasRefs
      ? refs.map((r) => ({ base64: r.base64, mimeType: r.mimeType }))
      : undefined;

    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          model: IMAGE_MODEL,
          referenceImages,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        updateRun(runId, (r) => ({
          imageStates: {
            ...r.imageStates,
            [promptText]: { status: 'error', error: err.error || `Error ${res.status}` },
          },
        }));
        return;
      }

      const data = await res.json();
      updateRun(runId, (r) => ({
        imageStates: {
          ...r.imageStates,
          [promptText]: { status: 'done', url: data.imageUrl },
        },
      }));
    } catch (e) {
      updateRun(runId, (r) => ({
        imageStates: {
          ...r.imageStates,
          [promptText]: { status: 'error', error: e instanceof Error ? e.message : 'Unexpected error' },
        },
      }));
    }
  };

  const handleGenerate = async () => {
    setValidationError('');
    if (strategies.size === 0 && !otherInstructions.trim()) {
      setValidationError('Pick at least one strategy or write custom instructions.');
      return;
    }
    if (!originalPrompt.trim() && !hasRefs) {
      setValidationError('Provide a reference image, an original prompt, or both.');
      return;
    }
    const n = Math.max(1, parseInt(count) || 3);
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: IterationRun = {
      id: runId,
      count: n,
      strategiesUsed: Array.from(strategies),
      streamedText: '',
      loading: true,
      error: '',
      imageStates: {},
      withImages: autoImagesEnabled,
    };
    setRuns((prev) => [newRun, ...prev]);
    firedImagePromptsRef.current.set(runId, new Set());

    try {
      const res = await fetch('/api/generate/iterate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          originalPrompt,
          referenceImages: hasRefs
            ? refs.map((r) => ({ base64: r.base64, mimeType: r.mimeType }))
            : undefined,
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

          if (autoImagesEnabled) {
            const blocks = extractClosedCodeBlocks(accumulated);
            const fired = firedImagePromptsRef.current.get(runId)!;
            for (const block of blocks) {
              if (!fired.has(block)) {
                fired.add(block);
                fireImageGen(runId, block);
              }
            }
          }
        } else if (evt.event === 'error') {
          updateRun(runId, { error: (evt.data as { error: string }).error });
        }
      }
    } catch (e) {
      updateRun(runId, { error: e instanceof Error ? e.message : 'Unexpected error' });
    }

    updateRun(runId, { loading: false });
  };

  const deleteRun = (runId: string) => {
    if (!confirm('Delete this iteration set?')) return;
    firedImagePromptsRef.current.delete(runId);
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const clearAll = () => {
    if (runs.length === 0) return;
    if (!confirm(`Clear all ${runs.length} iteration set${runs.length !== 1 ? 's' : ''}?`)) return;
    setRuns([]);
    firedImagePromptsRef.current.clear();
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const anyLoading = runs.some((r) => r.loading);

  return (
    <div className="border border-accent-gold/30 bg-accent-gold/[0.03] rounded-lg p-5 mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary text-sm font-semibold">Iterate on this prompt</p>
          <p className="text-text-muted text-xs mt-0.5">Generate sibling variations that keep what works.</p>
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

      {/* Strategy pills */}
      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-2">
          Iteration strategies <span className="text-text-muted normal-case">(pick one or more)</span>
        </label>
        <div className="flex flex-wrap gap-1.5">
          {ITERATION_STRATEGIES.map((s) => {
            const active = strategies.has(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleStrategy(s.value)}
                title={s.desc}
                className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                  active
                    ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                    : 'border-bg-border text-text-secondary hover:border-text-muted'
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Other / custom instructions */}
      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
          Other / custom instructions <span className="text-text-muted normal-case">(optional)</span>
        </label>
        <textarea
          className="input-field resize-none text-xs"
          rows={3}
          placeholder='e.g. "what worked is the bold headline — push the urgency further" / "test versions targeting menopausal women"'
          value={otherInstructions}
          onChange={(e) => setOtherInstructions(e.target.value)}
        />
      </div>

      <div>
        <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">Count</label>
        <input
          className="input-field text-xs"
          type="number"
          min="1"
          max="20"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
        <p className="text-text-muted text-[10px] mt-1">
          Images render with Nano Banana 2{hasRefs ? ` — your ${refs.length} reference photo${refs.length === 1 ? '' : 's'} will be passed in for every iteration.` : '.'}
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-text-secondary cursor-pointer select-none">
        <input
          type="checkbox"
          checked={autoImagesEnabled}
          onChange={(e) => setAutoImagesEnabled(e.target.checked)}
          className="w-3.5 h-3.5"
        />
        Auto-generate images for each iteration
      </label>

      <button
        onClick={handleGenerate}
        className="btn-primary w-full text-xs"
        disabled={anyLoading}
      >
        {anyLoading
          ? `Generating…`
          : `Generate ${parseInt(count) || 3} iteration${parseInt(count) === 1 ? '' : 's'}`}
      </button>

      {validationError && (
        <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red">
          {validationError}
        </div>
      )}

      {/* Stack of iteration runs */}
      {runs.map((run, idx) => (
        <div key={run.id} className="border-t border-bg-border pt-4 group/run">
          <div className="flex items-center justify-between mb-3">
            <p className="text-text-secondary text-xs uppercase tracking-widest">
              Iterations · run {runs.length - idx}
              {run.loading && <span className="ml-2 text-accent-gold animate-pulse">● streaming…</span>}
              {run.strategiesUsed.length > 0 && (
                <span className="ml-2 text-text-muted normal-case">
                  ({run.strategiesUsed.join(', ')})
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {run.streamedText && !run.loading && (
                <button
                  onClick={() => copyText(run.streamedText)}
                  className="btn-secondary text-xs px-2 py-1"
                >
                  Copy All
                </button>
              )}
              <button
                onClick={() => deleteRun(run.id)}
                title="Delete this iteration set"
                className="text-text-muted/40 hover:text-accent-red text-sm w-6 h-6 flex items-center justify-center rounded transition-colors opacity-0 group-hover/run:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>

          {run.error && (
            <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red mb-3">
              {run.error}
            </div>
          )}

          <div className="result-content">
            {!run.streamedText && run.loading ? (
              <div className="flex items-center gap-3 text-text-muted text-xs">
                <div className="w-4 h-4 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                Waiting for first tokens…
              </div>
            ) : (
              <ReactMarkdown
                components={{
                  code({ children, className }) {
                    const isBlock = className || String(children).includes('\n');
                    const promptText = String(children).trim();
                    if (isBlock) {
                      const imgState = run.imageStates[promptText];
                      return (
                        <div className="my-3">
                          <div className="relative group">
                            <pre className="bg-bg-base border border-accent-gold/25 rounded-lg p-4 text-xs text-text-primary font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                              {children}
                            </pre>
                            <button
                              onClick={() => copyText(promptText)}
                              className="absolute top-2 right-2 btn-secondary text-xs px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                              Copy
                            </button>
                          </div>

                          {imgState?.status === 'generating' && (
                            <div className="border border-bg-border rounded-lg p-5 mt-2 bg-bg-base/50 flex items-center justify-center gap-3">
                              <div className="w-4 h-4 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                              <span className="text-text-muted text-xs">Generating image…</span>
                            </div>
                          )}
                          {imgState?.status === 'error' && (
                            <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg p-3 mt-2">
                              <p className="text-accent-red text-xs font-medium">Image generation failed</p>
                              <p className="text-text-secondary text-xs mt-0.5">{imgState.error}</p>
                            </div>
                          )}
                          {imgState?.status === 'done' && imgState.url && (
                            <PromptImageGenerator
                              key={`${promptText}-done`}
                              prompt={promptText}
                              initialImages={refs}
                              initialModel={IMAGE_MODEL}
                              autoGenerateImageUrl={imgState.url}
                            />
                          )}
                          {!imgState && !run.loading && (
                            <PromptImageGenerator
                              key={`${promptText}-manual`}
                              prompt={promptText}
                              initialImages={refs}
                              initialModel={IMAGE_MODEL}
                            />
                          )}
                        </div>
                      );
                    }
                    return (
                      <code className="bg-bg-base px-1.5 py-0.5 rounded text-xs font-mono text-accent-gold">
                        {children}
                      </code>
                    );
                  },
                }}
              >
                {run.streamedText}
              </ReactMarkdown>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
