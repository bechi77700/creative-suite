'use client';

// Native Ads page — long-form editorial-style ad generator.
//
// Flow:
//   1. Product textarea (required) + optional context
//   2. Generate → SSE stream from /api/generate/native-ad
//   3. Stream is split into two cards: the ad copy and the image brief
//   4. Once stream ends, the Nanobanana prompt fires fal.ai (nano-banana-2)
//   5. Iterate panel below the image lets the user refine via feedback

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';
import { parseSSE } from '@/lib/streaming';
import { addWinner, removeWinner } from '@/lib/winners';

interface Headline {
  index: number;
  principle: string;
  principleCode: string;
  text: string;
}

interface PageProps {
  params: { id: string };
}

// ── Output parser ───────────────────────────────────────────────────────────
//
// The model emits the ad copy followed by a `# IMAGE BRIEF` block. We split
// at the first H1 starting with "IMAGE BRIEF" (or its variants) and parse
// the brief into 3 fields: concept, prompt, why-it-works.
//
// While the stream is still in progress, the IMAGE BRIEF section may be
// partial or empty — that's fine, the parser returns null fields.

interface ParsedOutput {
  adCopy: string;
  brief: {
    concept: string;
    prompt: string;
    why: string;
    raw: string;
  } | null;
}

function parseOutput(md: string): ParsedOutput {
  // Split at the first "# IMAGE BRIEF" header (with or without parens after).
  const splitRe = /\n#+\s*IMAGE BRIEF[^\n]*\n/i;
  const match = md.match(splitRe);
  if (!match || match.index === undefined) {
    return { adCopy: md, brief: null };
  }
  const adCopy = md.slice(0, match.index).trim();
  const briefRaw = md.slice(match.index + match[0].length).trim();

  // Within the brief, pull out the three labeled fields. The model uses
  // "**Concept de l'image**", "**Prompt Nanobanana**", "**Pourquoi ...**".
  // The prompt itself is wrapped in a fenced code block.
  const concept = extractField(briefRaw, /\*\*Concept[^*]*\*\*\s*:?\s*([\s\S]*?)(?=\*\*Prompt|\*\*Pourquoi|$)/i);
  const promptCodeMatch = briefRaw.match(/\*\*Prompt[^*]*\*\*\s*:?\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)```/i);
  // Fallback: if the model didn't fence the prompt, take the text up to "Pourquoi".
  const prompt = promptCodeMatch
    ? promptCodeMatch[1].trim()
    : extractField(briefRaw, /\*\*Prompt[^*]*\*\*\s*:?\s*([\s\S]*?)(?=\*\*Pourquoi|$)/i);
  const why = extractField(briefRaw, /\*\*Pourquoi[^*]*\*\*\s*:?\s*([\s\S]*?)$/i);

  return {
    adCopy,
    brief: { concept, prompt, why, raw: briefRaw },
  };
}

function extractField(src: string, re: RegExp): string {
  const m = src.match(re);
  if (!m) return '';
  return m[1].replace(/^```[a-zA-Z0-9_-]*\n?|```$/g, '').trim();
}

// Strip the structural scaffolding (## A — Hook narratif, ## B — …, ---)
// from the ad copy, keeping only the title + prose. Used when the user wants
// to paste the ad as a clean, ready-to-publish editorial.
function stripBlockHeaders(md: string): string {
  return md
    // Remove block headers like "## A — Hook narratif", "## B - Mise en scène", etc.
    // Match any H2/H3 that starts with a single capital letter followed by an em/en/hyphen dash.
    .replace(/^#{2,3}\s*[A-Z]\s*[—–-][^\n]*\n?/gm, '')
    // Remove standalone "---" separator lines.
    .replace(/^---+\s*$/gm, '')
    // Collapse runs of 3+ blank lines into 2 (clean paragraph spacing).
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
  const [cleanCopied, setCleanCopied] = useState(false);
  const [promptCopied, setPromptCopied] = useState(false);

  // Image generation (fal.ai, fired automatically once the text stream ends).
  const [imageUrl, setImageUrl] = useState('');
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState('');
  const [imagePromptUsed, setImagePromptUsed] = useState('');
  const [imageFeedback, setImageFeedback] = useState('');

  // Alternative image briefs — when the user wants a DIFFERENT type of image
  // for the same ad copy (different moment / different SOP §6 réflexe).
  // `briefHistory` is the running log of all briefs we've shown for this ad
  // copy (including the original). It's sent back to the alt-image route so
  // Claude can pick a DIFFERENT moment each time.
  // `activeBrief` overrides the parsed brief in the UI — when null we fall
  // back to whatever was parsed from the stream.
  type ImgBrief = { concept: string; prompt: string; why: string };
  const [activeBrief, setActiveBrief] = useState<ImgBrief | null>(null);
  const [briefHistory, setBriefHistory] = useState<ImgBrief[]>([]);
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState('');

  // ── Headlines (SOP §7) ───────────────────────────────────────────────────
  const [headlines, setHeadlines] = useState<Headline[]>([]);
  const [headlinesLoading, setHeadlinesLoading] = useState(false);
  const [headlinesError, setHeadlinesError] = useState('');
  const [headlinesGenerationId, setHeadlinesGenerationId] = useState<string | null>(null);
  const [headlineCopied, setHeadlineCopied] = useState<number | null>(null);
  // Map of headlineKey → winnerId (when marked as winner). null means in-flight.
  const [headlineWinners, setHeadlineWinners] = useState<Record<string, string | null>>({});
  // Standalone-mode form
  const [showStandaloneForm, setShowStandaloneForm] = useState(false);
  const [hlBrand, setHlBrand] = useState('');
  const [hlAngle, setHlAngle] = useState('');
  const [hlContext, setHlContext] = useState('');
  const [hlCount, setHlCount] = useState(8);

  const PRINCIPLE_COLORS: Record<string, string> = {
    A: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
    B: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
    C: 'bg-accent-violet/10 text-accent-violet border-accent-violet/30',
    D: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    E: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/30',
    F: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
  };

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

  // Parse the streamed output into ad copy + brief. Memoized so we don't
  // re-parse the full markdown on every keystroke of feedback input.
  const parsed = useMemo(() => parseOutput(output), [output]);

  // The brief currently shown / used for image generation. When the user
  // asks for "another type of image", we set activeBrief and the UI swaps.
  const displayBrief: ImgBrief | null =
    activeBrief ??
    (parsed.brief
      ? { concept: parsed.brief.concept, prompt: parsed.brief.prompt, why: parsed.brief.why }
      : null);

  const generateImage = async (nanoPrompt: string, feedback?: string) => {
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
          model: 'nano-banana-2',
          projectId: id,
          feedback: feedback?.trim() || undefined,
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
    setImageUrl('');
    setImageError('');
    setImagePromptUsed('');
    setImageFeedback('');
    setActiveBrief(null);
    setBriefHistory([]);
    setAltError('');

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

      // Stream done — fire image generation if we got a parseable prompt.
      const finalParsed = parseOutput(acc);
      const nanoPrompt = finalParsed.brief?.prompt ?? '';
      if (finalParsed.brief && nanoPrompt) {
        // Seed brief history with the original brief so the alt-image route
        // knows what's been tried already.
        setBriefHistory([
          {
            concept: finalParsed.brief.concept,
            prompt: finalParsed.brief.prompt,
            why: finalParsed.brief.why,
          },
        ]);
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
    if (displayBrief?.prompt) void generateImage(displayBrief.prompt);
  };

  const iterateImage = () => {
    if (displayBrief?.prompt && imageFeedback.trim()) {
      void generateImage(displayBrief.prompt, imageFeedback.trim());
    }
  };

  // Ask Claude for a NEW image brief — same ad copy, different moment /
  // different SOP §6 réflexe. Sends the full brief history so the model
  // doesn't repeat itself.
  const generateAltImage = async () => {
    if (!parsed.adCopy.trim() || altLoading) return;
    setAltLoading(true);
    setAltError('');
    try {
      const res = await fetch('/api/generate/native-ad/alt-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          adCopy: parsed.adCopy,
          previousBriefs: briefHistory,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const newBrief: ImgBrief = {
        concept: data.concept ?? '',
        prompt: data.prompt ?? '',
        why: data.why ?? '',
      };
      if (!newBrief.prompt) throw new Error('No prompt returned.');
      setActiveBrief(newBrief);
      setBriefHistory((prev) => [...prev, newBrief]);
      // Fire the image with the new prompt.
      void generateImage(newBrief.prompt);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAltError(message);
    } finally {
      setAltLoading(false);
    }
  };

  const copyAll = async () => {
    if (!parsed.adCopy) return;
    try {
      await navigator.clipboard.writeText(parsed.adCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  // Copy the ad copy WITHOUT the structural block headers (## A — Hook
  // narratif, etc.) and without the --- separators. Used when the user
  // wants to paste the ad straight into a publishing surface as clean prose.
  const copyClean = async () => {
    if (!parsed.adCopy) return;
    try {
      await navigator.clipboard.writeText(stripBlockHeaders(parsed.adCopy));
      setCleanCopied(true);
      setTimeout(() => setCleanCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const copyPrompt = async () => {
    if (!displayBrief?.prompt) return;
    try {
      await navigator.clipboard.writeText(displayBrief.prompt);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const wordCount = parsed.adCopy.trim() ? parsed.adCopy.trim().split(/\s+/).length : 0;

  // ── Headlines actions ────────────────────────────────────────────────────
  const generateHeadlines = async (mode: 'from_copy' | 'standalone') => {
    if (headlinesLoading) return;
    if (mode === 'from_copy' && !parsed.adCopy.trim()) return;
    if (mode === 'standalone' && !hlAngle.trim()) {
      setHeadlinesError('Angle requis en mode standalone.');
      return;
    }

    setHeadlinesLoading(true);
    setHeadlinesError('');
    setHeadlines([]);
    setHeadlinesGenerationId(null);
    setHeadlineWinners({});

    try {
      const res = await fetch('/api/generate/native-headlines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          mode,
          adCopy: mode === 'from_copy' ? stripBlockHeaders(parsed.adCopy) : undefined,
          brand: hlBrand.trim() || undefined,
          angle: hlAngle.trim() || undefined,
          context: hlContext.trim() || undefined,
          count: hlCount,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setHeadlines(data.headlines as Headline[]);
      setHeadlinesGenerationId(data.generationId as string);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setHeadlinesError(message);
    } finally {
      setHeadlinesLoading(false);
    }
  };

  const copyHeadline = async (h: Headline) => {
    try {
      await navigator.clipboard.writeText(h.text);
      setHeadlineCopied(h.index);
      setTimeout(() => setHeadlineCopied(null), 1200);
    } catch {
      /* ignore */
    }
  };

  const headlineKey = (h: Headline) =>
    `${headlinesGenerationId ?? 'na'}::${h.principleCode}::${h.index}`;

  const toggleHeadlineWinner = async (h: Headline) => {
    if (!headlinesGenerationId) return;
    const key = headlineKey(h);
    const currentId = headlineWinners[key];
    if (currentId === null) return; // in flight

    if (currentId) {
      // Remove
      setHeadlineWinners((prev) => ({ ...prev, [key]: null }));
      const ok = await removeWinner(headlinesGenerationId, key);
      setHeadlineWinners((prev) => {
        const next = { ...prev };
        if (ok) delete next[key];
        else next[key] = currentId;
        return next;
      });
    } else {
      // Add
      setHeadlineWinners((prev) => ({ ...prev, [key]: null }));
      const result = await addWinner({
        projectId: id,
        generationId: headlinesGenerationId,
        assetType: 'native_headline',
        assetKey: key,
        content: h.text,
        meta: { principle: h.principle, principleCode: h.principleCode, index: h.index },
      });
      setHeadlineWinners((prev) => {
        const next = { ...prev };
        if (result?.id) next[key] = result.id;
        else delete next[key];
        return next;
      });
    }
  };

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
                  Modèle: <span className="text-text-secondary font-medium">Claude Sonnet 4.6</span> · Streaming · ~1-2 min
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

            {/* ─── Card 1 — Ad copy ─────────────────────────────────────── */}
            {(output || loading) && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-text-primary text-lg font-semibold">Ad copy</h2>
                    {wordCount > 0 && (
                      <span className="text-text-muted text-xs">{wordCount} mots</span>
                    )}
                    {loading && (
                      <span className="text-accent-violet text-xs flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                        streaming…
                      </span>
                    )}
                  </div>
                  {output && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={copyClean}
                        className="btn-primary text-xs"
                        title="Copie le texte sans les titres de blocs (A — Hook, B — Mise en scène, etc.) — prêt à publier"
                      >
                        {cleanCopied ? '✓ Copié' : '✨ Copier propre'}
                      </button>
                      <button
                        onClick={copyAll}
                        className="btn-secondary text-xs"
                        title="Copie tout, y compris les titres de blocs"
                      >
                        {copied ? '✓ Copié' : 'Copier brut'}
                      </button>
                    </div>
                  )}
                </div>

                <div className="card p-6 md:p-8">
                  {parsed.adCopy ? (
                    <article className="prose prose-invert prose-sm md:prose-base max-w-none prose-headings:text-text-primary prose-p:text-text-secondary prose-strong:text-text-primary prose-code:text-accent-violet prose-code:bg-bg-hover prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:before:content-none prose-code:after:content-none prose-pre:bg-bg-base prose-pre:border prose-pre:border-bg-border">
                      <ReactMarkdown>{parsed.adCopy}</ReactMarkdown>
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

            {/* ─── Card 2 — Image brief (separate, structured) ──────────── */}
            {displayBrief && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <div className="flex items-center gap-3 flex-wrap">
                    <h2 className="text-text-primary text-lg font-semibold">Image brief</h2>
                    <span className="text-text-muted text-xs">pour Nanobanana</span>
                    {briefHistory.length > 1 && (
                      <span className="text-accent-violet text-[11px] font-semibold">
                        Variante {briefHistory.findIndex((b) => b.prompt === displayBrief.prompt) + 1}/{briefHistory.length}
                      </span>
                    )}
                    {altLoading && (
                      <span className="text-accent-violet text-xs flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                        nouvelle image…
                      </span>
                    )}
                  </div>
                  <button
                    onClick={generateAltImage}
                    disabled={altLoading || !parsed.adCopy.trim()}
                    className="btn-secondary text-xs"
                    title="Génère un AUTRE type d'image (autre moment du récit, autre réflexe SOP §6) — ce n'est pas une itération."
                  >
                    {altLoading ? '…' : '🎨 Autre type d\'image'}
                  </button>
                </div>

                {altError && (
                  <div className="mb-3 border border-accent-red/40 bg-accent-red/5 rounded-lg px-3 py-2">
                    <p className="text-accent-red text-sm">{altError}</p>
                  </div>
                )}

                <div className="card p-5 md:p-6 space-y-5 border-l-2 border-l-accent-violet/60">
                  {/* Concept */}
                  {displayBrief.concept && (
                    <div>
                      <p className="text-text-muted text-[11px] uppercase tracking-widest font-semibold mb-1.5">
                        Concept de l'image
                      </p>
                      <p className="text-text-secondary text-sm leading-relaxed">
                        {displayBrief.concept}
                      </p>
                    </div>
                  )}

                  {/* Prompt — dedicated styled code block */}
                  {displayBrief.prompt && (
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-text-muted text-[11px] uppercase tracking-widest font-semibold">
                          Prompt Nanobanana
                        </p>
                        <button onClick={copyPrompt} className="btn-secondary text-[11px] px-2 py-1">
                          {promptCopied ? '✓ Copié' : 'Copier'}
                        </button>
                      </div>
                      <pre className="bg-bg-base border border-bg-border rounded-lg p-4 text-text-primary text-xs md:text-sm font-mono whitespace-pre-wrap break-words leading-relaxed overflow-x-auto">
                        {displayBrief.prompt}
                      </pre>
                    </div>
                  )}

                  {/* Why it works */}
                  {displayBrief.why && (
                    <div>
                      <p className="text-text-muted text-[11px] uppercase tracking-widest font-semibold mb-1.5">
                        Pourquoi cette image fonctionne
                      </p>
                      <p className="text-text-secondary text-sm leading-relaxed">
                        {displayBrief.why}
                      </p>
                    </div>
                  )}

                  {/* Variant switcher — when multiple briefs exist, let the
                      user jump back to a previous variant. */}
                  {briefHistory.length > 1 && (
                    <div className="border-t border-bg-border pt-4">
                      <p className="text-text-muted text-[11px] uppercase tracking-widest font-semibold mb-2">
                        Variantes générées
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {briefHistory.map((b, i) => {
                          const isActive = b.prompt === displayBrief.prompt;
                          return (
                            <button
                              key={i}
                              onClick={() => {
                                if (isActive) return;
                                setActiveBrief(b);
                                void generateImage(b.prompt);
                              }}
                              className={`text-[11px] px-2.5 py-1 rounded border transition-colors ${
                                isActive
                                  ? 'bg-accent-violet/15 border-accent-violet/50 text-accent-violet'
                                  : 'btn-secondary'
                              }`}
                              title={b.concept}
                            >
                              #{i + 1}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ─── Card 3 — Generated image + iterate panel ─────────────── */}
            {(imageLoading || imageUrl || imageError) && (
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-text-primary text-lg font-semibold">Image</h2>
                    <span className="text-text-muted text-xs">Nano-Banana 2 · fal.ai</span>
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
                    <div className="space-y-5">
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

                      {/* Iterate panel */}
                      <div className="border-t border-bg-border pt-4 mt-2">
                        <p className="text-text-primary text-sm font-semibold mb-2">
                          Itérer l'image
                        </p>
                        <p className="text-text-muted text-xs mb-3">
                          Décris ce que tu veux changer. Le prompt original est conservé, ton feedback est ajouté par-dessus.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-2">
                          <input
                            type="text"
                            className="input-field flex-1"
                            placeholder="Ex: lumière plus chaude, mains plus âgées, cadrer plus serré sur les tomates"
                            value={imageFeedback}
                            onChange={(e) => setImageFeedback(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && imageFeedback.trim() && !imageLoading) {
                                e.preventDefault();
                                iterateImage();
                              }
                            }}
                            disabled={imageLoading}
                          />
                          <button
                            onClick={iterateImage}
                            disabled={imageLoading || !imageFeedback.trim()}
                            className="btn-primary text-sm"
                          >
                            ✨ Itérer
                          </button>
                        </div>
                      </div>

                      {imagePromptUsed && (
                        <details className="text-xs">
                          <summary className="text-text-muted cursor-pointer hover:text-text-secondary">
                            Voir le prompt complet utilisé pour cette image
                          </summary>
                          <pre className="mt-2 p-3 bg-bg-base border border-bg-border rounded text-text-secondary whitespace-pre-wrap break-words font-mono">
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

            {/* ─── Card 4 — Headlines (SOP §7) ──────────────────────────── */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <h2 className="text-text-primary text-lg font-semibold">Headlines</h2>
                  <span className="text-text-muted text-xs">SOP §7 · 5–10 variantes</span>
                  {headlinesLoading && (
                    <span className="text-accent-violet text-xs flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-accent-violet animate-pulse" />
                      génération…
                    </span>
                  )}
                </div>
              </div>

              <div className="card p-5 md:p-6 space-y-4">
                {/* CTA row */}
                <div className="flex flex-wrap items-center gap-2">
                  {parsed.adCopy.trim() && (
                    <button
                      onClick={() => generateHeadlines('from_copy')}
                      disabled={headlinesLoading}
                      className="btn-primary text-sm"
                    >
                      {headlinesLoading ? 'Génération…' : '✨ Générer headlines depuis cette ad'}
                    </button>
                  )}
                  <button
                    onClick={() => setShowStandaloneForm((v) => !v)}
                    className="btn-secondary text-sm"
                  >
                    {showStandaloneForm ? 'Masquer' : parsed.adCopy.trim() ? 'Mode standalone' : '✨ Générer headlines (standalone)'}
                  </button>
                  {!parsed.adCopy.trim() && (
                    <p className="text-text-muted text-xs">
                      Pas d'ad copy en session — utilise le mode standalone (marque + angle).
                    </p>
                  )}
                </div>

                {/* Standalone form */}
                {showStandaloneForm && (
                  <div className="border border-bg-border rounded-lg p-4 space-y-3 bg-bg-base/40">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-text-secondary text-xs font-semibold mb-1">
                          Marque <span className="text-text-muted font-normal">(optionnel)</span>
                        </label>
                        <input
                          type="text"
                          className="input-field w-full text-sm"
                          placeholder="Ex: Nuviya Papillon"
                          value={hlBrand}
                          onChange={(e) => setHlBrand(e.target.value)}
                          disabled={headlinesLoading}
                        />
                      </div>
                      <div>
                        <label className="block text-text-secondary text-xs font-semibold mb-1">
                          Nombre de variantes
                        </label>
                        <input
                          type="number"
                          min={5}
                          max={10}
                          className="input-field w-full text-sm"
                          value={hlCount}
                          onChange={(e) => setHlCount(Math.max(5, Math.min(10, parseInt(e.target.value) || 8)))}
                          disabled={headlinesLoading}
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-text-secondary text-xs font-semibold mb-1">
                        Angle <span className="text-accent-red">*</span>
                      </label>
                      <input
                        type="text"
                        className="input-field w-full text-sm"
                        placeholder="Ex: perspective fille dont la mère ronfle, scène intime"
                        value={hlAngle}
                        onChange={(e) => setHlAngle(e.target.value)}
                        disabled={headlinesLoading}
                      />
                    </div>
                    <div>
                      <label className="block text-text-secondary text-xs font-semibold mb-1">
                        Contexte <span className="text-text-muted font-normal">(optionnel)</span>
                      </label>
                      <textarea
                        className="input-field w-full text-sm min-h-[60px] resize-y"
                        placeholder="Mécanique, public, ton particulier…"
                        value={hlContext}
                        onChange={(e) => setHlContext(e.target.value)}
                        disabled={headlinesLoading}
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        onClick={() => generateHeadlines('standalone')}
                        disabled={headlinesLoading || !hlAngle.trim()}
                        className="btn-primary text-sm"
                      >
                        {headlinesLoading ? 'Génération…' : '✨ Générer'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Error */}
                {headlinesError && (
                  <div className="border border-accent-red/40 bg-accent-red/5 rounded-lg px-3 py-2">
                    <p className="text-accent-red text-sm">{headlinesError}</p>
                  </div>
                )}

                {/* Headlines list */}
                {headlines.length > 0 && (
                  <ul className="space-y-2 pt-1">
                    {headlines.map((h) => {
                      const key = headlineKey(h);
                      const winnerState = headlineWinners[key];
                      const isWinner = !!winnerState;
                      const inFlight = winnerState === null;
                      const colorClass =
                        PRINCIPLE_COLORS[h.principleCode] ??
                        'bg-bg-hover text-text-secondary border-bg-border';
                      return (
                        <li
                          key={key}
                          className="border border-bg-border rounded-lg p-3 md:p-4 bg-bg-base/40 hover:bg-bg-base/70 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="text-text-muted text-[11px] font-mono">
                                  #{h.index}
                                </span>
                                <span
                                  className={`text-[10px] uppercase tracking-wider font-semibold border rounded px-1.5 py-0.5 ${colorClass}`}
                                  title={`Principe ${h.principleCode}`}
                                >
                                  {h.principleCode} · {h.principle}
                                </span>
                              </div>
                              <p className="text-text-primary text-base md:text-lg leading-snug font-serif">
                                {h.text}
                              </p>
                            </div>
                            <div className="flex flex-col gap-1.5 shrink-0">
                              <button
                                onClick={() => copyHeadline(h)}
                                className="btn-secondary text-[11px] px-2 py-1"
                              >
                                {headlineCopied === h.index ? '✓' : 'Copier'}
                              </button>
                              <button
                                onClick={() => toggleHeadlineWinner(h)}
                                disabled={inFlight || !headlinesGenerationId}
                                className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                                  isWinner
                                    ? 'bg-accent-gold/15 border-accent-gold/50 text-accent-gold'
                                    : 'btn-secondary'
                                }`}
                                title={isWinner ? 'Retirer des winners' : 'Marquer comme winner'}
                              >
                                {inFlight ? '…' : isWinner ? '★ Winner' : '☆ Winner'}
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}

                {/* Empty state when nothing generated yet */}
                {headlines.length === 0 && !headlinesLoading && !headlinesError && (
                  <p className="text-text-muted text-xs">
                    Génère 5 à 10 headlines courtes (3–12 mots), chacune taggée avec son principe systémique
                    (filtre audience / autorité / mystère / citation / recadrage / découverte).
                  </p>
                )}
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
