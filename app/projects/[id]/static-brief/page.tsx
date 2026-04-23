'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import PromptImageGenerator from '@/components/PromptImageGenerator';
import ReactMarkdown from 'react-markdown';

type Mode = 'clone' | 'scratch';

interface Result {
  output: string;
  generationId: string;
  isWinner: boolean;
}

export default function StaticBriefPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('scratch');

  // Shared inputs
  const [product, setProduct] = useState('');
  const [count, setCount] = useState('3');

  // Mode A inputs
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState('');
  const [modeAContext, setModeAContext] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Mode B inputs
  const [angle, setAngle] = useState('');
  const [modeBContext, setModeBContext] = useState('');

  // Output
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

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

  const handleGenerate = async () => {
    if (!product.trim()) return;
    if (mode === 'clone' && !imageFile) return;
    const n = Math.max(1, parseInt(count) || 1);

    setLoading(true);
    setResult(null);
    setError('');

    // Extract base64 from the dataURL already stored in imagePreview — browser-safe, no Buffer needed
    let imageBase64 = '';
    let imageMimeType = '';
    if (mode === 'clone' && imagePreview) {
      const comma = imagePreview.indexOf(',');
      imageBase64 = imagePreview.slice(comma + 1);
      imageMimeType = imageFile!.type;
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
          imageBase64,
          imageMimeType,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        setError(err.error || `Error ${res.status}`);
        setLoading(false);
        return;
      }

      const data = await res.json();
      setResult({ output: data.output, generationId: data.generationId, isWinner: false });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unexpected error — check console');
    }

    setLoading(false);
  };

  const toggleWinner = async () => {
    if (!result) return;
    const res = await fetch(`/api/history/${result.generationId}/winner`, { method: 'PATCH' });
    const data = await res.json();
    setResult((prev) => prev ? { ...prev, isWinner: data.isWinner } : null);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const exportTxt = () => {
    if (!result) return;
    const blob = new Blob([result.output], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName}-nanobanana-prompts.txt`;
    a.click();
  };

  const n = Math.max(1, parseInt(count) || 1);
  const canGenerate = product.trim() && (mode === 'scratch' || imageFile);

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
                onClick={() => { setMode('scratch'); setResult(null); }}
                className={`flex-1 py-2 rounded-md text-xs font-medium border transition-colors ${
                  mode === 'scratch'
                    ? 'bg-accent-gold text-bg-base border-accent-gold'
                    : 'border-bg-border text-text-secondary hover:border-text-muted hover:text-text-primary'
                }`}
              >
                From Scratch
              </button>
              <button
                onClick={() => { setMode('clone'); setResult(null); }}
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
          </div>

          {/* Generate button — pinned bottom */}
          <div className="px-5 py-4 border-t border-bg-border flex-shrink-0">
            <button
              onClick={handleGenerate}
              className="btn-primary w-full"
              disabled={loading || !canGenerate}
            >
              {loading
                ? `Generating ${n} prompt${n !== 1 ? 's' : ''}…`
                : `Generate ${n || '?'} Prompt${n !== 1 ? 's' : ''}`}
            </button>
            {mode === 'clone' && !imageFile && (
              <p className="text-accent-red/60 text-[10px] text-center mt-1.5">
                Upload a competitor ad to use Clone mode
              </p>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 overflow-y-auto p-6">

          {/* Error */}
          {error && !loading && (
            <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg px-4 py-3 mb-4 flex items-start gap-3">
              <span className="text-accent-red text-sm mt-0.5">✕</span>
              <div>
                <p className="text-accent-red text-sm font-medium">Generation failed</p>
                <p className="text-text-secondary text-xs mt-0.5">{error}</p>
              </div>
              <button onClick={() => setError('')} className="ml-auto text-text-muted hover:text-text-secondary text-xs">Dismiss</button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="card p-16 flex items-center justify-center">
              <div className="text-center">
                <div className="w-10 h-10 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin mx-auto mb-5" />
                <p className="text-text-primary text-sm font-medium">
                  {mode === 'clone'
                    ? 'Auditing competitor ad structure…'
                    : `Generating ${n} prompt${n !== 1 ? 's' : ''}…`}
                </p>
                <p className="text-text-muted text-xs mt-1.5">
                  {mode === 'clone'
                    ? 'Analyzing visual hierarchy, psychological angle, then adapting to your brand.'
                    : 'Each prompt will use a different visual format.'}
                </p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && !loading && (
            <div className="space-y-4">
              {/* Top bar */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-medium px-2.5 py-1 rounded border ${
                    mode === 'clone'
                      ? 'text-accent-blue border-accent-blue/30 bg-accent-blue/10'
                      : 'text-accent-gold border-accent-gold/30 bg-accent-gold/10'
                  }`}>
                    {mode === 'clone' ? 'Clone & Adapt' : 'From Scratch'}
                  </span>
                  <span className="text-text-muted text-xs">{n} prompt{n !== 1 ? 's' : ''} · {product}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={toggleWinner}
                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                      result.isWinner
                        ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                        : 'border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                    }`}
                  >
                    {result.isWinner ? '★ Winner' : '☆ Mark Winner'}
                  </button>
                  {n >= 2 && (
                    <button onClick={exportTxt} className="btn-secondary text-xs px-3 py-1.5">
                      Export TXT
                    </button>
                  )}
                  <button onClick={() => copyText(result.output)} className="btn-secondary text-xs px-3 py-1.5">
                    Copy All
                  </button>
                </div>
              </div>

              {/* Output */}
              <div className="card">
                <div className="p-6 result-content">
                  <ReactMarkdown
                    components={{
                      code({ children, className }) {
                        const isBlock = className || String(children).includes('\n');
                        if (isBlock) {
                          const promptText = String(children).trim();
                          return (
                            <div className="my-3">
                              <div className="relative group">
                                <pre className="bg-bg-base border border-accent-gold/25 rounded-lg p-5 text-xs text-text-primary font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
                                  {children}
                                </pre>
                                <button
                                  onClick={() => copyText(promptText)}
                                  className="absolute top-2.5 right-2.5 btn-secondary text-xs px-2.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                  Copy
                                </button>
                              </div>
                              <PromptImageGenerator prompt={promptText} />
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
                    {result.output}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && (
            <div className="card p-16 text-center">
              <p className="text-text-muted text-5xl mb-5">▣</p>
              <p className="text-text-primary font-medium text-base mb-2">
                {mode === 'clone' ? 'Clone & Adapt' : 'From Scratch'}
              </p>
              <p className="text-text-muted text-sm max-w-md mx-auto leading-relaxed">
                {mode === 'clone'
                  ? 'Upload a competitor ad — the AI will audit its visual structure, psychological angle, and generate Nanobanana prompts adapted to your brand.'
                  : 'Enter a product and optionally a marketing angle. The AI generates prompts with completely different formats — no two prompts share the same structure.'}
              </p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
