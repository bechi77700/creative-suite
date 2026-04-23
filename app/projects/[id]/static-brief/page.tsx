'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import PromptImageGenerator, { IMAGE_MODELS } from '@/components/PromptImageGenerator';
import IteratePanel from '@/components/IteratePanel';
import ReactMarkdown from 'react-markdown';

type Mode = 'clone' | 'scratch';

type ImageStatus = 'idle' | 'generating' | 'done' | 'error';
interface ImageState {
  status: ImageStatus;
  url?: string;
  error?: string;
}

// Parse all CLOSED triple-backtick code blocks from a (possibly partial) markdown string.
// Returns the inner text of each closed block, in order.
function extractClosedCodeBlocks(text: string): string[] {
  const regex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1].trim());
  }
  return out;
}

// Parse SSE stream chunks. Yields event objects { event, data }.
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

  // Mode A inputs (Clone)
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [modeAContext, setModeAContext] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode B inputs (From Scratch)
  const [angle, setAngle] = useState('');
  const [modeBContext, setModeBContext] = useState('');

  // Product reference image (used for image generation, both modes)
  const [productRefFile, setProductRefFile] = useState<File | null>(null);
  const [productRefPreview, setProductRefPreview] = useState('');
  const productRefInputRef = useRef<HTMLInputElement>(null);

  // Image model
  const [imageModel, setImageModel] = useState('nano-banana-2');

  // Output
  const [loading, setLoading] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [generationId, setGenerationId] = useState<string | null>(null);
  const [isWinner, setIsWinner] = useState(false);
  const [error, setError] = useState('');

  // Per-prompt image states (keyed by promptText)
  const [imageStates, setImageStates] = useState<Record<string, ImageState>>({});
  const [autoImagesEnabled, setAutoImagesEnabled] = useState(false);

  // Track which prompt has its iterate panel open
  const [iteratingPromptText, setIteratingPromptText] = useState<string | null>(null);

  // Track which prompts we've already kicked off image gen for (avoid duplicates during streaming)
  const firedImagePromptsRef = useRef<Set<string>>(new Set());
  // Track current run mode in case user retries
  const currentModeRef = useRef<Mode>('scratch');

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => {
      setProjectName(d.name);
      setHasSaintGraal(d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false);
    });
  }, [id]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setImagePreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageFile(null);
    setImagePreview('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleProductRefChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProductRefFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setProductRefPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const removeProductRef = () => {
    setProductRefFile(null);
    setProductRefPreview('');
    if (productRefInputRef.current) productRefInputRef.current.value = '';
  };

  // Fire image generation for a single prompt (called as prompts complete during streaming)
  const fireImageGen = async (promptText: string) => {
    setImageStates((prev) => ({ ...prev, [promptText]: { status: 'generating' } }));

    let referenceImageBase64: string | undefined;
    let referenceMimeType: string | undefined;
    const currentImageModelConfig = IMAGE_MODELS.find((m) => m.value === imageModel);
    if (currentImageModelConfig?.allowsRef && productRefFile && productRefPreview) {
      const comma = productRefPreview.indexOf(',');
      referenceImageBase64 = productRefPreview.slice(comma + 1);
      referenceMimeType = productRefFile.type;
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

  const handleGenerate = async (withImages: boolean) => {
    if (!product.trim()) return;
    if (mode === 'clone' && !imageFile) return;
    const n = Math.max(1, parseInt(count) || 1);

    // Reset
    setLoading(true);
    setStreamedText('');
    setError('');
    setGenerationId(null);
    setIsWinner(false);
    setImageStates({});
    firedImagePromptsRef.current = new Set();
    setAutoImagesEnabled(withImages);
    currentModeRef.current = mode;

    // Extract base64 from the dataURL already stored in imagePreview — for clone mode
    let competitorBase64 = '';
    let competitorMimeType = '';
    if (mode === 'clone' && imagePreview) {
      const comma = imagePreview.indexOf(',');
      competitorBase64 = imagePreview.slice(comma + 1);
      competitorMimeType = imageFile!.type;
    }

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
          imageBase64: competitorBase64,
          imageMimeType: competitorMimeType,
        }),
      });

      if (!res.ok || !res.body) {
        // Non-streaming error
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

          // Detect newly completed code blocks → fire image gen
          if (withImages) {
            const blocks = extractClosedCodeBlocks(accumulated);
            for (const block of blocks) {
              if (!firedImagePromptsRef.current.has(block)) {
                firedImagePromptsRef.current.add(block);
                // fire & forget
                fireImageGen(block);
              }
            }
          }
        } else if (evt.event === 'done') {
          const data = evt.data as { generationId: string };
          setGenerationId(data.generationId);
        } else if (evt.event === 'error') {
          const data = evt.data as { error: string };
          setError(data.error);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error — check console');
    }

    setLoading(false);
  };

  const toggleWinner = async () => {
    if (!generationId) return;
    const res = await fetch(`/api/history/${generationId}/winner`, { method: 'PATCH' });
    const data = await res.json();
    setIsWinner(data.isWinner);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const exportTxt = () => {
    if (!streamedText) return;
    const blob = new Blob([streamedText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}-nanobanana-prompts.txt`;
    a.click();
  };

  const n = Math.max(1, parseInt(count) || 1);
  const canGenerate = product.trim() && (mode === 'scratch' || imageFile);

  // Build initialImage payload for PromptImageGenerator (so user doesn't re-upload in each block)
  const initialImageForChild = productRefFile && productRefPreview
    ? (() => {
        const comma = productRefPreview.indexOf(',');
        return {
          base64: productRefPreview.slice(comma + 1),
          mimeType: productRefFile.type,
          previewDataUri: productRefPreview,
        };
      })()
    : undefined;

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
                onClick={() => { setMode('scratch'); setStreamedText(''); }}
                className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                  mode === 'scratch'
                    ? 'bg-accent-gold text-bg-base border-accent-gold'
                    : 'border-bg-border text-text-secondary hover:border-text-muted hover:text-text-primary'
                }`}
              >
                From Scratch
              </button>
              <button
                onClick={() => { setMode('clone'); setStreamedText(''); }}
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
                  <label className="text-text-muted text-xs mb-2 block">Competitor Ad Screenshot *</label>
                  {imagePreview ? (
                    <div className="relative">
                      <img
                        src={imagePreview}
                        alt="ref"
                        className="w-full rounded-md border border-bg-border object-cover max-h-52"
                      />
                      <button
                        onClick={removeImage}
                        className="absolute top-1.5 right-1.5 bg-bg-base/90 text-text-muted text-xs px-2 py-0.5 rounded hover:text-accent-red transition-colors"
                      >
                        ✕ Remove
                      </button>
                    </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center h-32 border border-dashed border-bg-border rounded-md cursor-pointer hover:border-accent-gold/50 transition-colors group">
                      <span className="text-text-muted text-3xl mb-1 group-hover:text-accent-gold transition-colors">↑</span>
                      <span className="text-text-muted text-xs group-hover:text-text-secondary transition-colors">Upload competitor ad</span>
                      <span className="text-text-muted text-[10px] mt-0.5">JPG · PNG · WEBP</span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleImageChange}
                      />
                    </label>
                  )}
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
                  Product reference image
                  <span className="text-text-muted ml-1 font-normal opacity-60">— optional, used for all images</span>
                </label>
                {productRefPreview ? (
                  <div className="relative">
                    <img
                      src={productRefPreview}
                      alt="product ref"
                      className="w-full rounded-md border border-bg-border object-cover max-h-32"
                    />
                    <button
                      onClick={removeProductRef}
                      className="absolute top-1.5 right-1.5 bg-bg-base/90 text-text-muted text-xs px-2 py-0.5 rounded hover:text-accent-red transition-colors"
                    >
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <label className="flex flex-col items-center justify-center h-24 border border-dashed border-bg-border rounded-md cursor-pointer hover:border-accent-gold/50 transition-colors group">
                    <span className="text-text-muted text-xs group-hover:text-text-secondary transition-colors">↑ Upload product photo</span>
                    <span className="text-text-muted text-[10px] mt-0.5">JPG · PNG · WEBP</span>
                    <input
                      ref={productRefInputRef}
                      type="file"
                      className="hidden"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleProductRefChange}
                    />
                  </label>
                )}
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
              disabled={loading || !canGenerate}
            >
              {loading && autoImagesEnabled
                ? `Generating ${n} prompt${n !== 1 ? 's' : ''} + image${n !== 1 ? 's' : ''}…`
                : `Generate ${n} Prompt${n !== 1 ? 's' : ''} + Image${n !== 1 ? 's' : ''}`}
            </button>
            <button
              onClick={() => handleGenerate(false)}
              className="btn-secondary w-full text-xs"
              disabled={loading || !canGenerate}
            >
              {loading && !autoImagesEnabled
                ? `Generating ${n} prompt${n !== 1 ? 's' : ''}…`
                : `Generate prompts only`}
            </button>
            {mode === 'clone' && !imageFile && (
              <p className="text-accent-red/60 text-[10px] text-center">
                Upload a competitor ad to use Clone mode
              </p>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Error */}
          {error && (
            <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
              <span className="text-accent-red text-sm mt-0.5">✕</span>
              <div>
                <p className="text-accent-red text-sm font-medium">Generation failed</p>
                <p className="text-text-secondary text-xs mt-0.5">{error}</p>
              </div>
              <button onClick={() => setError('')} className="ml-auto text-text-muted hover:text-text-secondary text-xs">Dismiss</button>
            </div>
          )}

          {/* Result / streaming view */}
          {(streamedText || loading) && (
            <div className="space-y-4">
              {/* Top bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded border ${
                    currentModeRef.current === 'clone'
                      ? 'text-accent-blue border-accent-blue/30 bg-accent-blue/10'
                      : 'text-accent-gold border-accent-gold/30 bg-accent-gold/10'
                  }`}>
                    {currentModeRef.current === 'clone' ? 'Clone & Adapt' : 'From Scratch'}
                  </span>
                  <span className="text-text-muted text-xs">
                    {n} prompt{n !== 1 ? 's' : ''} · {product}
                    {loading && <span className="ml-2 text-accent-gold animate-pulse">● streaming…</span>}
                  </span>
                </div>
                {!loading && generationId && (
                  <div className="flex gap-2">
                    <button
                      onClick={toggleWinner}
                      className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                        isWinner
                          ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                          : 'border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                      }`}
                    >
                      {isWinner ? '★ Winner' : '☆ Mark Winner'}
                    </button>
                    {n >= 2 && (
                      <button onClick={exportTxt} className="btn-secondary text-xs px-3 py-1.5">
                        Export TXT
                      </button>
                    )}
                    <button onClick={() => copyText(streamedText)} className="btn-secondary text-xs px-3 py-1.5">
                      Copy All
                    </button>
                  </div>
                )}
              </div>

              {/* Output */}
              <div className="card">
                <div className="p-6 result-content">
                  {!streamedText && loading ? (
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
                            const imgState = imageStates[promptText];
                            return (
                              <div className="my-3">
                                <div className="relative group">
                                  <pre className="bg-bg-base border border-accent-gold/25 rounded-lg p-5 text-xs text-text-primary font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                                    {children}
                                  </pre>
                                  <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      onClick={() =>
                                        setIteratingPromptText(
                                          iteratingPromptText === promptText ? null : promptText,
                                        )
                                      }
                                      className={`text-xs px-2.5 py-1 rounded border transition-colors ${
                                        iteratingPromptText === promptText
                                          ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                                          : 'btn-secondary'
                                      }`}
                                    >
                                      {iteratingPromptText === promptText ? '✕ Iterate' : '↻ Iterate'}
                                    </button>
                                    <button
                                      onClick={() => copyText(promptText)}
                                      className="btn-secondary text-xs px-2.5 py-1"
                                    >
                                      Copy
                                    </button>
                                  </div>
                                </div>

                                {iteratingPromptText === promptText && (
                                  <IteratePanel
                                    projectId={id}
                                    originalPrompt={promptText}
                                    initialImage={initialImageForChild}
                                    onClose={() => setIteratingPromptText(null)}
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
                                      initialImage={initialImageForChild}
                                      initialModel={imageModel}
                                    />
                                  </div>
                                )}
                                {imgState?.status === 'done' && imgState.url && (
                                  <PromptImageGenerator
                                    key={`${promptText}-done`}
                                    prompt={promptText}
                                    initialImage={initialImageForChild}
                                    initialModel={imageModel}
                                    autoGenerateImageUrl={imgState.url}
                                  />
                                )}
                                {!imgState && !loading && (
                                  <PromptImageGenerator
                                    key={`${promptText}-manual`}
                                    prompt={promptText}
                                    initialImage={initialImageForChild}
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
            </div>
          )}

          {/* Empty state */}
          {!streamedText && !loading && !error && (
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
        </div>
      </div>
      )}
    </div>
  );
}
