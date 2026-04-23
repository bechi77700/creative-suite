'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import PromptImageGenerator, { IMAGE_MODELS } from '@/components/PromptImageGenerator';
import IteratePanel from '@/components/IteratePanel';
import MultiImageInput, { RefImage } from '@/components/MultiImageInput';
import ReactMarkdown from 'react-markdown';

type Mode = 'clone' | 'scratch';

type ImageStatus = 'idle' | 'generating' | 'done' | 'error';
interface ImageState {
  status: ImageStatus;
  url?: string;
  error?: string;
}

interface Run {
  id: string;
  mode: Mode;
  product: string;
  count: number;
  withImages: boolean;
  streamedText: string;
  generationId: string | null;
  isWinner: boolean;
  imageStates: Record<string, ImageState>;
  iteratingPromptText: string | null;
  loading: boolean;
  error: string;
  imageModel: string;
  productRefImages: RefImage[];
}

// Parse all CLOSED triple-backtick code blocks from a (possibly partial) markdown string.
function extractClosedCodeBlocks(text: string): string[] {
  const regex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1].trim());
  }
  return out;
}

async function* parseSSE(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const lines = rawEvent.split('\n');
        let event = 'message';
        let data = '';
        for (const line of lines) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (data) {
          try {
            yield { event, data: JSON.parse(data) };
          } catch {
            // skip malformed
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export default function StaticBriefPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('scratch');

  // Shared inputs
  const [product, setProduct] = useState('');
  const [count, setCount] = useState('3');

  // Mode A inputs (Clone) — multi competitor screenshots
  const [competitorImages, setCompetitorImages] = useState<RefImage[]>([]);
  const [modeAContext, setModeAContext] = useState('');

  // Mode B inputs (From Scratch)
  const [angle, setAngle] = useState('');
  const [modeBContext, setModeBContext] = useState('');

  // Product reference image(s) (used for image generation, both modes)
  const [productRefImages, setProductRefImages] = useState<RefImage[]>([]);

  // Image model
  const [imageModel, setImageModel] = useState('nano-banana-2');

  // Stack of runs
  const [runs, setRuns] = useState<Run[]>([]);

  // Per-run, per-prompt fired image tracking
  const firedImagePromptsRef = useRef<Map<string, Set<string>>>(new Map());

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => {
      setProjectName(d.name);
      setHasSaintGraal(d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false);
    });
  }, [id]);

  const updateRun = (runId: string, patch: Partial<Run> | ((r: Run) => Partial<Run>)) => {
    setRuns((prev) =>
      prev.map((r) => {
        if (r.id !== runId) return r;
        const p = typeof patch === 'function' ? patch(r) : patch;
        return { ...r, ...p };
      }),
    );
  };

  const fireImageGen = async (runId: string, promptText: string) => {
    const runSnap = runs.find((r) => r.id === runId);
    const modelToUse = runSnap?.imageModel ?? imageModel;
    const refsToUse = runSnap?.productRefImages ?? productRefImages;

    updateRun(runId, (r) => ({
      imageStates: { ...r.imageStates, [promptText]: { status: 'generating' } },
    }));

    let referenceImages: Array<{ base64: string; mimeType: string }> | undefined;
    const currentImageModelConfig = IMAGE_MODELS.find((m) => m.value === modelToUse);
    if (currentImageModelConfig?.allowsRef && refsToUse.length > 0) {
      referenceImages = refsToUse.map((r) => ({ base64: r.base64, mimeType: r.mimeType }));
    }

    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: promptText, model: modelToUse, referenceImages }),
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
          [promptText]: {
            status: 'error',
            error: e instanceof Error ? e.message : 'Unexpected error',
          },
        },
      }));
    }
  };

  const handleGenerate = async (withImages: boolean) => {
    if (!product.trim()) return;
    if (mode === 'clone' && competitorImages.length === 0) return;
    const n = Math.max(1, parseInt(count) || 1);

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: Run = {
      id: runId,
      mode,
      product,
      count: n,
      withImages,
      streamedText: '',
      generationId: null,
      isWinner: false,
      imageStates: {},
      iteratingPromptText: null,
      loading: true,
      error: '',
      imageModel,
      productRefImages,
    };

    // Append at top so the new run appears first
    setRuns((prev) => [newRun, ...prev]);
    firedImagePromptsRef.current.set(runId, new Set());

    const competitorRefs = mode === 'clone'
      ? competitorImages.map((r) => ({ base64: r.base64, mimeType: r.mimeType }))
      : [];

    try {
      const res = await fetch('/api/generate/static-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          product,
          count: n,
          mode,
          angle: mode === 'scratch' ? angle : '',
          additionalContext: mode === 'clone' ? modeAContext : modeBContext,
          competitorImages: competitorRefs,
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

          if (withImages) {
            const blocks = extractClosedCodeBlocks(accumulated);
            const fired = firedImagePromptsRef.current.get(runId)!;
            for (const block of blocks) {
              if (!fired.has(block)) {
                fired.add(block);
                fireImageGen(runId, block);
              }
            }
          }
        } else if (evt.event === 'done') {
          const data = evt.data as { generationId: string };
          updateRun(runId, { generationId: data.generationId });
        } else if (evt.event === 'error') {
          const data = evt.data as { error: string };
          updateRun(runId, { error: data.error });
        }
      }
    } catch (e) {
      updateRun(runId, { error: e instanceof Error ? e.message : 'Unexpected error — check console' });
    }

    updateRun(runId, { loading: false });
  };

  const toggleWinner = async (runId: string, generationId: string) => {
    const res = await fetch(`/api/history/${generationId}/winner`, { method: 'PATCH' });
    const data = await res.json();
    updateRun(runId, { isWinner: data.isWinner });
  };

  const deleteRun = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    if (!confirm('Delete this generation?')) return;
    if (run.generationId) {
      try {
        await fetch(`/api/history/${run.generationId}`, { method: 'DELETE' });
      } catch { /* noop — still remove locally */ }
    }
    firedImagePromptsRef.current.delete(runId);
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const clearAll = () => {
    if (runs.length === 0) return;
    if (!confirm(`Clear all ${runs.length} generation${runs.length !== 1 ? 's' : ''} from this view? (Saved generations stay in History.)`)) return;
    setRuns([]);
    firedImagePromptsRef.current.clear();
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const exportTxt = (run: Run) => {
    if (!run.streamedText) return;
    const blob = new Blob([run.streamedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}-nanobanana-prompts.txt`;
    a.click();
  };

  const n = Math.max(1, parseInt(count) || 1);
  const canGenerate = product.trim() && (mode === 'scratch' || competitorImages.length > 0);
  const anyLoading = runs.some((r) => r.loading);
  const initialImagesForChild = productRefImages;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      {hasSaintGraal === false ? (
        <SaintGraalGate projectId={id} />
      ) : (
      <div className="flex-1 flex overflow-hidden">

        {/* ── Left panel ── */}
        <div className="w-72 border-r border-bg-border bg-bg-elevated flex flex-col overflow-hidden">

          {/* Header */}
          <div className="px-5 py-5 border-b border-bg-border flex-shrink-0">
            <h1 className="text-text-primary font-semibold text-base">Static Brief</h1>
            <p className="text-text-muted text-xs mt-0.5">Nanobanana prompt generator</p>

            {/* Mode toggle */}
            <div className="flex gap-1.5 mt-4">
              <button
                onClick={() => setMode('scratch')}
                className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                  mode === 'scratch'
                    ? 'bg-accent-gold text-bg-base border-accent-gold'
                    : 'border-bg-border text-text-secondary hover:border-text-muted hover:text-text-primary'
                }`}
              >
                From Scratch
              </button>
              <button
                onClick={() => setMode('clone')}
                className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                  mode === 'clone'
                    ? 'bg-accent-gold text-bg-base border-accent-gold'
                    : 'border-bg-border text-text-secondary hover:border-text-muted hover:text-text-primary'
                }`}
              >
                Clone &amp; Adapt
              </button>
            </div>
          </div>

          {/* Form — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-5 space-y-5">

            {/* ── MODE A: CLONE ── */}
            {mode === 'clone' && (
              <>
                <div>
                  <label className="text-text-muted text-xs mb-2 block">Competitor Ad Screenshot(s) *</label>
                  <MultiImageInput
                    images={competitorImages}
                    onChange={setCompetitorImages}
                    max={6}
                    emptyLabel="↑ Upload competitor ad screenshot(s)"
                  />
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Product *</label>
                  <input
                    className="input-field"
                    placeholder="e.g. Eloria 3D Anti-Cellulite Leggings"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Number of Prompts</label>
                  <input
                    className="input-field"
                    type="number"
                    min="1"
                    placeholder="e.g. 5"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                  <p className="text-text-muted text-[10px] mt-1">Enter any number you want</p>
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">
                    Optional Instructions
                    <span className="text-text-muted ml-1 font-normal opacity-60">— optional</span>
                  </label>
                  <textarea
                    className="input-field resize-none text-xs"
                    rows={4}
                    placeholder={'e.g. "focus on lipedema angle"\n"include price"\n"emphasize before/after"'}
                    value={modeAContext}
                    onChange={(e) => setModeAContext(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* ── MODE B: FROM SCRATCH ── */}
            {mode === 'scratch' && (
              <>
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Product *</label>
                  <input
                    className="input-field"
                    placeholder="e.g. Eloria 3D Anti-Cellulite Leggings"
                    value={product}
                    onChange={(e) => setProduct(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">
                    Marketing Angle
                    <span className="text-text-muted ml-1 font-normal opacity-60">— optional, AI chooses if empty</span>
                  </label>
                  <input
                    className="input-field"
                    placeholder={'e.g. "lipedema angle" / "women who gave up on diets"'}
                    value={angle}
                    onChange={(e) => setAngle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Number of Prompts</label>
                  <input
                    className="input-field"
                    type="number"
                    min="1"
                    placeholder="e.g. 5"
                    value={count}
                    onChange={(e) => setCount(e.target.value)}
                  />
                  <p className="text-text-muted text-[10px] mt-1">Enter any number you want</p>
                </div>

                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">
                    Additional Context
                    <span className="text-text-muted ml-1 font-normal opacity-60">— optional</span>
                  </label>
                  <textarea
                    className="input-field resize-none text-xs"
                    rows={4}
                    placeholder="Season, promo, key claim, competitor context…"
                    value={modeBContext}
                    onChange={(e) => setModeBContext(e.target.value)}
                  />
                </div>
              </>
            )}

            {/* ── IMAGE GENERATION SETTINGS (shared) ── */}
            <div className="border-t border-bg-border pt-5 space-y-4">
              <div>
                <p className="text-text-secondary text-xs uppercase tracking-widest mb-3">Image generation</p>

                <label className="text-text-muted text-xs mb-1.5 block">
                  Product reference photo(s)
                  <span className="text-text-muted ml-1 font-normal opacity-60">— optional, used for all images</span>
                </label>
                <MultiImageInput
                  images={productRefImages}
                  onChange={setProductRefImages}
                  max={6}
                  emptyLabel="↑ Upload product photo(s)"
                />
              </div>

              <div>
                <label className="text-text-muted text-xs mb-1.5 block">Image model</label>
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
          </div>

          {/* Generate buttons — pinned bottom */}
          <div className="px-5 py-4 border-t border-bg-border flex-shrink-0 space-y-2">
            <button
              onClick={() => handleGenerate(true)}
              className="btn-primary w-full"
              disabled={anyLoading || !canGenerate}
            >
              {anyLoading
                ? `Generating…`
                : `Generate ${n} Prompt${n !== 1 ? 's' : ''} + Image${n !== 1 ? 's' : ''}`}
            </button>
            <button
              onClick={() => handleGenerate(false)}
              className="btn-secondary w-full text-xs"
              disabled={anyLoading || !canGenerate}
            >
              {anyLoading ? `Generating…` : `Generate prompts only`}
            </button>
            {mode === 'clone' && competitorImages.length === 0 && (
              <p className="text-accent-red/60 text-[10px] text-center">
                Upload a competitor ad to use Clone mode
              </p>
            )}
            {runs.length > 0 && (
              <button
                onClick={clearAll}
                className="text-text-muted hover:text-accent-red text-[10px] uppercase tracking-widest w-full text-center pt-1 transition-colors"
              >
                Clear all ({runs.length})
              </button>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">

          {/* Empty state */}
          {runs.length === 0 && (
            <div className="card p-16 text-center">
              <p className="text-text-muted text-5xl mb-5">▣</p>
              <p className="text-text-primary font-medium text-base mb-2">
                {mode === 'clone' ? 'Clone & Adapt' : 'From Scratch'}
              </p>
              <p className="text-text-muted text-sm max-w-md mx-auto leading-relaxed">
                {mode === 'clone'
                  ? 'Upload a competitor ad — the AI will audit its visual structure, psychological angle, and generate Nanobanana prompts adapted to your brand. You can also generate the final image directly.'
                  : 'Enter a product and optionally a marketing angle. The AI generates prompts with completely different formats — and can directly produce the images via Fal.ai.'}
              </p>
            </div>
          )}

          {/* All runs, newest at top */}
          {runs.map((run) => (
            <RunCard
              key={run.id}
              run={run}
              projectId={id}
              initialImagesForChild={initialImagesForChild}
              onToggleWinner={() => run.generationId && toggleWinner(run.id, run.generationId)}
              onDelete={() => deleteRun(run.id)}
              onCopyAll={() => copyText(run.streamedText)}
              onExport={() => exportTxt(run)}
              onCopyPrompt={(t) => copyText(t)}
              onSetIterating={(t) => updateRun(run.id, { iteratingPromptText: t })}
              onDismissError={() => updateRun(run.id, { error: '' })}
            />
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RunCard — renders one generation run
// ─────────────────────────────────────────────────────────────────────────────

interface RunCardProps {
  run: Run;
  projectId: string;
  initialImagesForChild: RefImage[];
  onToggleWinner: () => void;
  onDelete: () => void;
  onCopyAll: () => void;
  onExport: () => void;
  onCopyPrompt: (text: string) => void;
  onSetIterating: (text: string | null) => void;
  onDismissError: () => void;
}

function RunCard({
  run,
  projectId,
  initialImagesForChild,
  onToggleWinner,
  onDelete,
  onCopyAll,
  onExport,
  onCopyPrompt,
  onSetIterating,
  onDismissError,
}: RunCardProps) {
  return (
    <div className="space-y-4 group/run">
      {run.error && (
        <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg px-4 py-3 flex items-start gap-3">
          <span className="text-accent-red text-sm mt-0.5">✕</span>
          <div>
            <p className="text-accent-red text-sm font-medium">Generation failed</p>
            <p className="text-text-secondary text-xs mt-0.5">{run.error}</p>
          </div>
          <button onClick={onDismissError} className="ml-auto text-text-muted hover:text-text-secondary text-xs">Dismiss</button>
        </div>
      )}

      {(run.streamedText || run.loading) && (
        <>
          {/* Top bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`text-xs font-medium px-2.5 py-1 rounded border ${
                run.mode === 'clone'
                  ? 'text-accent-blue border-accent-blue/30 bg-accent-blue/10'
                  : 'text-accent-gold border-accent-gold/30 bg-accent-gold/10'
              }`}>
                {run.mode === 'clone' ? 'Clone & Adapt' : 'From Scratch'}
              </span>
              <span className="text-text-muted text-xs">
                {run.count} prompt{run.count !== 1 ? 's' : ''} · {run.product}
                {run.loading && <span className="ml-2 text-accent-gold animate-pulse">● streaming…</span>}
              </span>
            </div>
            <div className="flex gap-2 items-center">
              {!run.loading && run.generationId && (
                <>
                  <button
                    onClick={onToggleWinner}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      run.isWinner
                        ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                        : 'border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                    }`}
                  >
                    {run.isWinner ? '★ Winner' : '☆ Mark Winner'}
                  </button>
                  {run.count >= 2 && (
                    <button onClick={onExport} className="btn-secondary text-xs px-3 py-1.5">
                      Export TXT
                    </button>
                  )}
                  <button onClick={onCopyAll} className="btn-secondary text-xs px-3 py-1.5">
                    Copy All
                  </button>
                </>
              )}
              {/* Discreet delete — only visible on hover */}
              <button
                onClick={onDelete}
                title="Delete this generation"
                className="text-text-muted/40 hover:text-accent-red text-sm w-7 h-7 flex items-center justify-center rounded transition-colors opacity-0 group-hover/run:opacity-100"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Output */}
          <div className="card">
            <div className="p-6 result-content">
              {!run.streamedText && run.loading ? (
                <div className="flex items-center gap-3 text-text-muted text-sm">
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
                              <pre className="bg-bg-base border border-accent-gold/25 rounded-lg p-5 text-xs text-text-primary font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                                {children}
                              </pre>
                              <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() =>
                                    onSetIterating(
                                      run.iteratingPromptText === promptText ? null : promptText,
                                    )
                                  }
                                  className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                                    run.iteratingPromptText === promptText
                                      ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                                      : 'btn-secondary'
                                  }`}
                                >
                                  {run.iteratingPromptText === promptText ? '✕ Iterate' : '↻ Iterate'}
                                </button>
                                <button
                                  onClick={() => onCopyPrompt(promptText)}
                                  className="btn-secondary text-xs px-2.5 py-1"
                                >
                                  Copy
                                </button>
                              </div>
                            </div>

                            {run.iteratingPromptText === promptText && (
                              <IteratePanel
                                projectId={projectId}
                                originalPrompt={promptText}
                                initialImages={initialImagesForChild}
                                onClose={() => onSetIterating(null)}
                              />
                            )}

                            {/* Per-prompt image area */}
                            {imgState?.status === 'generating' && (
                              <div className="border border-bg-border rounded-lg p-6 mt-3 bg-bg-base/50 flex items-center justify-center gap-3">
                                <div className="w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                                <span className="text-text-muted text-xs">Generating image…</span>
                              </div>
                            )}
                            {imgState?.status === 'error' && (
                              <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg p-3 mt-3">
                                <p className="text-accent-red text-xs font-medium">Image generation failed</p>
                                <p className="text-text-secondary text-xs mt-0.5">{imgState.error}</p>
                                <PromptImageGenerator
                                  prompt={promptText}
                                  initialImages={initialImagesForChild}
                                  initialModel={run.imageModel}
                                />
                              </div>
                            )}
                            {imgState?.status === 'done' && imgState.url && (
                              <PromptImageGenerator
                                key={`${promptText}-done`}
                                prompt={promptText}
                                initialImages={initialImagesForChild}
                                initialModel={run.imageModel}
                                autoGenerateImageUrl={imgState.url}
                              />
                            )}
                            {!imgState && !run.loading && (
                              <PromptImageGenerator
                                key={`${promptText}-manual`}
                                prompt={promptText}
                                initialImages={initialImagesForChild}
                                initialModel={run.imageModel}
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
        </>
      )}
    </div>
  );
}
