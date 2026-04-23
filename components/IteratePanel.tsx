'use client';

import { useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import PromptImageGenerator, { IMAGE_MODELS } from './PromptImageGenerator';
import { parseSSE, extractClosedCodeBlocks } from '@/lib/streaming';

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

interface Props {
  projectId: string;
  originalPrompt: string;
  /** Pre-loaded ref image (forwarded from parent) — used for image gen of iterations */
  initialImage?: { base64: string; mimeType: string; previewDataUri: string };
  /** Default image model */
  initialImageModel?: string;
  /** Optional callback when the panel is closed/dismissed */
  onClose?: () => void;
  /** Hide the close button (when used standalone on its own page) */
  hideClose?: boolean;
}

export default function IteratePanel({
  projectId,
  originalPrompt,
  initialImage,
  initialImageModel = 'nano-banana-2',
  onClose,
  hideClose,
}: Props) {
  const [strategies, setStrategies] = useState<Set<string>>(new Set());
  const [otherInstructions, setOtherInstructions] = useState('');
  const [count, setCount] = useState('3');
  const [imageModel, setImageModel] = useState(initialImageModel);
  const [autoImagesEnabled, setAutoImagesEnabled] = useState(true);

  const [loading, setLoading] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [error, setError] = useState('');
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});

  const firedImagePromptsRef = useRef<Set<string>>(new Set());

  const toggleStrategy = (value: string) => {
    setStrategies((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const fireImageGen = async (promptText: string) => {
    setImageStates((prev) => ({ ...prev, [promptText]: { status: 'generating' } }));

    let referenceImageBase64: string | undefined;
    let referenceMimeType: string | undefined;
    const currentImageModelConfig = IMAGE_MODELS.find((m) => m.value === imageModel);
    if (currentImageModelConfig?.allowsRef && initialImage) {
      referenceImageBase64 = initialImage.base64;
      referenceMimeType = initialImage.mimeType;
    }

    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: promptText,
          model: imageModel,
          referenceImageBase64,
          referenceMimeType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        setImageStates((prev) => ({
          ...prev,
          [promptText]: { status: 'error', error: err.error || `Error ${res.status}` },
        }));
        return;
      }

      const data = await res.json();
      setImageStates((prev) => ({
        ...prev,
        [promptText]: { status: 'done', url: data.imageUrl },
      }));
    } catch (e) {
      setImageStates((prev) => ({
        ...prev,
        [promptText]: { status: 'error', error: e instanceof Error ? e.message : 'Unexpected error' },
      }));
    }
  };

  const handleGenerate = async () => {
    if (strategies.size === 0 && !otherInstructions.trim()) {
      setError('Pick at least one strategy or write custom instructions.');
      return;
    }
    const n = Math.max(1, parseInt(count) || 3);

    setLoading(true);
    setStreamedText('');
    setError('');
    setImageStates({});
    firedImagePromptsRef.current = new Set();

    try {
      const res = await fetch('/api/generate/iterate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          originalPrompt,
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

          if (autoImagesEnabled) {
            const blocks = extractClosedCodeBlocks(accumulated);
            for (const block of blocks) {
              if (!firedImagePromptsRef.current.has(block)) {
                firedImagePromptsRef.current.add(block);
                fireImageGen(block);
              }
            }
          }
        } else if (evt.event === 'error') {
          setError((evt.data as { error: string }).error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error');
    }

    setLoading(false);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="border border-accent-gold/30 bg-accent-gold/[0.03] rounded-lg p-5 mt-3 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-text-primary text-sm font-semibold">Iterate on this prompt</p>
          <p className="text-text-muted text-xs mt-0.5">Generate sibling variations that keep what works.</p>
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

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">Count</label>
          <input
            className="input-field text-xs"
            type="number"
            min="1"
            max="20"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
        <div className="flex-[2]">
          <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">Image model</label>
          <select
            className="input-field text-xs"
            value={imageModel}
            onChange={(e) => setImageModel(e.target.value)}
          >
            {IMAGE_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
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
        disabled={loading}
      >
        {loading
          ? `Generating ${parseInt(count) || 3} iteration${parseInt(count) === 1 ? '' : 's'}…`
          : `Generate ${parseInt(count) || 3} iteration${parseInt(count) === 1 ? '' : 's'}`}
      </button>

      {error && (
        <div className="border border-accent-red/40 bg-accent-red/5 rounded px-3 py-2 text-xs text-accent-red">
          {error}
        </div>
      )}

      {/* Streaming output */}
      {(streamedText || (loading && !error)) && (
        <div className="border-t border-bg-border pt-4">
          <p className="text-text-secondary text-xs uppercase tracking-widest mb-3">
            Iterations
            {loading && <span className="ml-2 text-accent-gold animate-pulse">● streaming…</span>}
          </p>
          <div className="result-content">
            {!streamedText && loading ? (
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
                      const imgState = imageStates[promptText];
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
                              initialImage={initialImage}
                              initialModel={imageModel}
                              autoGenerateImageUrl={imgState.url}
                            />
                          )}
                          {!imgState && !loading && (
                            <PromptImageGenerator
                              key={`${promptText}-manual`}
                              prompt={promptText}
                              initialImage={initialImage}
                              initialModel={imageModel}
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
                {streamedText}
              </ReactMarkdown>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
