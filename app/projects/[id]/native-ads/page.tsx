'use client';

// Native Ads page — long-form editorial-style ad generator.
//
// Single-screen flow:
//   1. Product textarea (required)
//   2. Additional context textarea (optional — angle direction, persona, etc.)
//   3. Generate → SSE stream from /api/generate/native-ad
//   4. Live markdown render with copy button
//
// No funnel selector, no language toggle — Native Ads default to TOFU and
// the language is inferred from the Saint Graal market. See SOP for the
// 9-block architecture the model follows.

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';
import { parseSSE, extractClosedCodeBlocks } from '@/lib/streaming';

interface PageProps {
  params: { id: string };
}

export default function NativeAdsPage({ params }: PageProps) {
  const { id } = params;

  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);

  const [product, setProduct] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  // Image generation (fal.ai, fired automatically once the text stream ends).
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imagePromptUsed, setImagePromptUsed] = useState('');

  useEffect(() => {
    fetch(`/api/projects/${id}`)
      .then((r) => r.json())
      .then((d) => {
        setProjectName(d.name);
        setHasSaintGraal(
          d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false,
        );
      });
  }, [id]);

  // Pull the Nanobanana prompt out of the streamed markdown. The model is
  // instructed to wrap it in a single fenced code block under "Prompt
  // Nanobanana". We just take the first closed code block.
  const extractNanoPrompt = (md: string): string => {
    const blocks = extractClosedCodeBlocks(md);
    return blocks[0]?.trim() ?? '';
  };

  const generateImage = async (nanoPrompt: string) => {
    if (!nanoPrompt) return;
    setImageLoading(true);
    setImageError('');
    setImageUrl('');
    setImagePromptUsed(nanoPrompt);

    try {
      const res = await fetch('/api/generate/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: nanoPrompt,
          model: 'nano-banana-pro',
          projectId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setImageUrl(data.imageUrl);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setImageError(message);
    } finally {
      setImageLoading(false);
    }
  };

  const generate = async () => {
    if (!product.trim() || loading) return;
    setLoading(true);
    setError('');
    setOutput('');
    // Reset previous image too — new ad → new image.
    setImageUrl('');
    setImageError('');
    setImagePromptUsed('');

    try {
      const res = await fetch('/api/generate/native-ad', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          product: product.trim(),
          additionalContext: additionalContext.trim() || undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      let acc = '';
      for await (const evt of parseSSE(res.body)) {
        if (evt.event === 'text') {
          const text = (evt.data as { text?: string }).text ?? '';
          acc += text;
          setOutput(acc);
        } else if (evt.event === 'error') {
          const message = (evt.data as { error?: string }).error ?? 'Stream error';
          throw new Error(message);
        }
      }

      // Stream done — auto-fire image generation if a Nanobanana prompt
      // was emitted. Don't await: image takes 30-60s, no need to block UI.
      const nanoPrompt = extractNanoPrompt(acc);
      if (nanoPrompt) {
        void generateImage(nanoPrompt);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const regenerateImage = () => {
    const nanoPrompt = extractNanoPrompt(output);
    if (nanoPrompt) void generateImage(nanoPrompt);
  };

  const copy = async () => {
    if (!output) return;
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const wordCount = output.trim() ? output.trim().split(/\s+/).length : 0;

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      {hasSaintGraal === false ? (
        <SaintGraalGate projectId={id} />
      ) : (
        <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
          <div className="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-10">
            {/* Header */}
            <div className="mb-8">
              <p className="text-accent-violet text-xs font-semibold uppercase tracking-widest mb-2">
                ● Native Ads
              </p>
              <h1 className="text-text-primary text-3xl md:text-4xl font-bold tracking-tight">
                Long-form editorial ad generator
              </h1>
              <p className="text-text-secondary text-base mt-3 max-w-2xl leading-relaxed">
                Génère une native ad de 1500–3500 mots dans le style éditorial / témoignage —
                hook narratif, parcours d'échec, moment de bascule, autorité, mécanisme,
                preuves, CTA douce. Image brief Nanobanana inclus à la fin.
              </p>
              <p className="text-text-muted text-xs mt-2">
                ⚠️ Assure-toi d'avoir uploadé <code className="text-accent-violet">NATIVE_ADS_COMPLETE.md</code> dans la KB sous la catégorie <em>Native Ads</em> — c'est ce qui définit la mécanique pour Claude.
              </p>
            </div>

            {/* Inputs */}
            <div className="card p-5 space-y-4">
              <div>
                <label className="block text-text-primary text-sm font-semibold mb-1.5">
                  Produit à promouvoir <span className="text-accent-red">*</span>
                </label>
                <textarea
                  className="input-field w-full min-h-[100px] resize-y"
                  placeholder="Ex: Oreiller anti-ronflement Nuviya Papillon — mémoire de forme + design ergonomique qui ouvre les voies respiratoires. 89€. Public principal: femmes 50+ dont le partenaire ronfle."
                  value={product}
                  onChange={(e) => setProduct(e.target.value)}
                  disabled={loading}
                />
              </div>

              <div>
                <label className="block text-text-primary text-sm font-semibold mb-1.5">
                  Contexte additionnel <span className="text-text-muted font-normal">(optionnel)</span>
                </label>
                <textarea
                  className="input-field w-full min-h-[80px] resize-y"
                  placeholder="Ex: Angle 'perspective d'une fille dont la mère ronfle' — scène intime, lit d'hôpital évoqué. Ou: utiliser l'angle apnée du sommeil."
                  value={additionalContext}
                  onChange={(e) => setAdditionalContext(e.target.value)}
                  disabled={loading}
                />
                <p className="text-text-muted text-xs mt-1.5">
                  Laisse vide pour laisser Claude choisir l'angle le plus fort dans le Saint Graal.
                </p>
              </div>

              <div className="flex items-center justify-between pt-1">
                <p className="text-text-muted text-xs">
                  Modèle: <span className="text-text-secondary font-medium">Claude Opus 4.7</span> · Streaming · ~2-4 min
                </p>
                <button
                  onClick={generate}
                  disabled={loading || !product.trim()}
                  className="btn-primary"
                >
                  {loading ? 'Génération en cours…' : '✨ Générer la native ad'}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="mt-5 border border-accent-red/40 bg-accent-red/5 rounded-lg px-4 py-3">
                <p className="text-accent-red text-sm font-medium">Erreur</p>
                <p className="text-text-secondary text-sm mt-1">{error}</p>
              </div>
            )}

            {/* Output */}
            {(output || loading) && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-text-primary text-lg font-semibold">Native ad</h2>
                    {wordCount > 0 && (
                      <span className="text-text-muted text-xs">
                        {wordCount} mots
                      </span>
                    )}
                    {loading && (
                      <span className="text-accent-violet text-xs flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                        streaming…
                      </span>
                    )}
                  </div>
                  {output && (
                    <button onClick={copy} className="btn-secondary text-xs">
                      {copied ? '✓ Copié' : 'Copier tout'}
                    </button>
                  )}
                </div>

                <div className="card p-6 md:p-8">
                  {output ? (
                    <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-code:text-accent-violet prose-code:bg-bg-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-base prose-pre:border prose-pre:border-bg-border">
                      <ReactMarkdown>{output}</ReactMarkdown>
                    </article>
                  ) : (
                    <div className="space-y-3">
                      <div className="h-4 bg-bg-hover rounded shimmer w-3/4" />
                      <div className="h-4 bg-bg-hover rounded shimmer w-full" />
                      <div className="h-4 bg-bg-hover rounded shimmer w-5/6" />
                      <div className="h-4 bg-bg-hover rounded shimmer w-2/3" />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Image (auto-generated from the IMAGE BRIEF block) */}
            {(imageLoading || imageUrl || imageError) && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-text-primary text-lg font-semibold">Image</h2>
                    <span className="text-text-muted text-xs">Nano-Banana Pro</span>
                    {imageLoading && (
                      <span className="text-accent-violet text-xs flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                        génération…
                      </span>
                    )}
                  </div>
                  {imageUrl && !imageLoading && (
                    <button onClick={regenerateImage} className="btn-secondary text-xs">
                      ↻ Régénérer
                    </button>
                  )}
                </div>

                <div className="card p-4 md:p-6">
                  {imageError ? (
                    <div className="space-y-3">
                      <p className="text-accent-red text-sm font-medium">Image non générée</p>
                      <p className="text-text-secondary text-sm">{imageError}</p>
                      <button onClick={regenerateImage} className="btn-secondary text-xs">
                        Réessayer
                      </button>
                    </div>
                  ) : imageUrl ? (
                    <div className="space-y-4">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imageUrl}
                        alt="Native ad visual"
                        className="w-full max-w-2xl mx-auto rounded-lg border border-bg-border"
                      />
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={imageUrl}
                          download
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary text-xs"
                        >
                          ⬇ Télécharger
                        </a>
                        <a
                          href={imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-secondary text-xs"
                        >
                          ↗ Ouvrir
                        </a>
                      </div>
                      {imagePromptUsed && (
                        <details className="text-xs">
                          <summary className="text-text-muted cursor-pointer hover:text-text-secondary">
                            Voir le prompt utilisé
                          </summary>
                          <pre className="mt-2 p-3 bg-bg-base border border-bg-border rounded text-text-secondary whitespace-pre-wrap break-words">
                            {imagePromptUsed}
                          </pre>
                        </details>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="aspect-[3/4] max-w-md mx-auto bg-bg-hover rounded shimmer" />
                      <p className="text-center text-text-muted text-xs">
                        L'image se génère automatiquement à partir du IMAGE BRIEF (30-60s)…
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </main>
      )}
    </div>
  );
}
