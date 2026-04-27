'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';
import { addWinner, removeWinner, parseNumberedBlocks } from '@/lib/winners';
import VideoReferenceInput from '@/components/VideoReferenceInput';
import type { VideoAnalysis } from '@/lib/gemini-video';

type Mode = 'from_script' | 'from_brand' | 'from_video';

const HOOK_COUNTS = [1, 3, 6, 10] as const;
type HookCount = (typeof HOOK_COUNTS)[number];

interface Run {
  id: string;
  mode: Mode;
  count: number;
  output: string;
  generationId: string;
  variationsOutput: string;
  variationsLoading: boolean;
  loading: boolean;
  // assetKeys of hooks the user starred in this run.
  winnerKeys: Set<string>;
}

export default function HookGeneratorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('from_brand');
  const [count, setCount] = useState<HookCount>(6);
  const [script, setScript] = useState('');
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysis | null>(null);
  const [videoSource, setVideoSource] = useState<'own' | 'competitor'>('competitor');
  const [instructions, setInstructions] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => {
      setProjectName(d.name);
      setHasSaintGraal(d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false);
    });
  }, [id]);

  const updateRun = (runId: string, patch: Partial<Run> | ((r: Run) => Partial<Run>)) => {
    setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) } : r)));
  };

  const generate = async () => {
    if (mode === 'from_script' && !script.trim()) return;
    if (mode === 'from_video' && !videoAnalysis) return;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: Run = {
      id: runId,
      mode,
      count,
      output: '',
      generationId: '',
      variationsOutput: '',
      variationsLoading: false,
      loading: true,
      winnerKeys: new Set(),
    };
    setRuns((prev) => [newRun, ...prev]);

    try {
      const res = await fetch('/api/generate/hooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          mode,
          count,
          script,
          instructions,
          videoAnalysis: mode === 'from_video' ? videoAnalysis : null,
          videoSource: mode === 'from_video' ? videoSource : null,
        }),
      });
      const data = await res.json();
      updateRun(runId, {
        output: data.output || '',
        generationId: data.generationId || '',
        loading: false,
      });
    } catch (e) {
      updateRun(runId, {
        output: `Error: ${e instanceof Error ? e.message : 'unknown'}`,
        loading: false,
      });
    }
  };

  // Toggle a single hook as winner — keyed on (generationId, assetKey).
  // bucket = 'main' (original output) or 'more' (the More Hooks variations).
  const toggleHookWinner = async (
    runId: string,
    bucket: 'main' | 'more',
    block: { index: number; full: string; title: string },
  ) => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !run.generationId) return;
    const assetKey = `${bucket}-hook-${block.index}`;
    const isWinner = run.winnerKeys.has(assetKey);

    // Optimistic update
    updateRun(runId, (r) => {
      const next = new Set(r.winnerKeys);
      if (isWinner) next.delete(assetKey);
      else next.add(assetKey);
      return { winnerKeys: next };
    });

    if (isWinner) {
      await removeWinner(run.generationId, assetKey);
    } else {
      await addWinner({
        projectId: id,
        generationId: run.generationId,
        assetType: 'hook',
        assetKey,
        content: block.full,
        meta: { mode: run.mode, hookTitle: block.title, bucket },
      });
    }
  };

  const getVariations = async (runId: string, generationId: string) => {
    updateRun(runId, { variationsLoading: true, variationsOutput: '' });
    const res = await fetch('/api/generate/variations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId }),
    });
    const data = await res.json();
    updateRun(runId, { variationsOutput: data.output || '', variationsLoading: false });
  };

  const deleteRun = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    if (!confirm('Delete this generation? (Starred winners stay in your library.)')) return;
    if (run.generationId) {
      try { await fetch(`/api/history/${run.generationId}`, { method: 'DELETE' }); } catch { /* noop */ }
    }
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const clearAll = () => {
    if (runs.length === 0) return;
    if (!confirm(`Clear all ${runs.length} generation${runs.length !== 1 ? 's' : ''} from this view? (Saved winners and history stay.)`)) return;
    setRuns([]);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const anyLoading = runs.some((r) => r.loading);

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      {hasSaintGraal === false ? (
        <SaintGraalGate projectId={id} />
      ) : (
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden pt-12 md:pt-0">
        {/* Left: Form */}
        <div className="w-full md:w-80 md:max-h-none max-h-[55vh] md:flex-shrink-0 border-b md:border-b-0 md:border-r border-bg-border overflow-y-auto bg-bg-elevated flex flex-col">
          <div className="px-5 py-5 border-b border-bg-border">
            <h1 className="text-text-primary font-semibold text-base">Hook Generator</h1>
            <p className="text-text-secondary text-xs mt-1">Scroll-stopping hooks — written + visual</p>
          </div>

          <div className="p-5 space-y-5 flex-1">
            <div>
              <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Mode</label>
              <div className="space-y-1.5">
                <button
                  onClick={() => setMode('from_brand')}
                  className={`w-full text-left px-3 py-3 rounded-md text-xs transition-colors border ${
                    mode === 'from_brand'
                      ? 'bg-accent-gold/10 border-accent-gold/40 text-accent-gold'
                      : 'border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  <p className="font-semibold mb-0.5">From Brand Knowledge</p>
                  <p className="text-text-muted text-[10px] leading-relaxed">
                    Generate hooks directly from brand docs + global knowledge. No script needed.
                  </p>
                </button>
                <button
                  onClick={() => setMode('from_script')}
                  className={`w-full text-left px-3 py-3 rounded-md text-xs transition-colors border ${
                    mode === 'from_script'
                      ? 'bg-accent-gold/10 border-accent-gold/40 text-accent-gold'
                      : 'border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  <p className="font-semibold mb-0.5">From Existing Script</p>
                  <p className="text-text-muted text-[10px] leading-relaxed">
                    Paste a script and generate hook variations for it.
                  </p>
                </button>
                <button
                  onClick={() => setMode('from_video')}
                  className={`w-full text-left px-3 py-3 rounded-md text-xs transition-colors border ${
                    mode === 'from_video'
                      ? 'bg-accent-gold/10 border-accent-gold/40 text-accent-gold'
                      : 'border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  <p className="font-semibold mb-0.5">From Reference Video</p>
                  <p className="text-text-muted text-[10px] leading-relaxed">
                    Upload a winning hook (yours or a competitor&apos;s) — clone the mechanism, adapt the content to your brand.
                  </p>
                </button>
              </div>
            </div>

            {mode === 'from_script' && (
              <div>
                <label className="text-text-muted text-xs mb-1.5 block">Paste Script</label>
                <textarea
                  className="input-field resize-none text-xs"
                  rows={8}
                  placeholder="Paste your script here…"
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                />
              </div>
            )}

            {mode === 'from_video' && (
              <div className="space-y-3">
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block uppercase tracking-widest">Source</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setVideoSource('own')}
                      className={`px-2.5 py-2 rounded-md text-[11px] transition-colors border ${
                        videoSource === 'own'
                          ? 'bg-accent-violet/10 border-accent-violet/50 text-accent-violet'
                          : 'border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                      }`}
                    >
                      <p className="font-semibold leading-tight">Own brand</p>
                      <p className="text-text-muted text-[9px] mt-0.5 leading-snug">Iterate a winner — keep product & claims</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setVideoSource('competitor')}
                      className={`px-2.5 py-2 rounded-md text-[11px] transition-colors border ${
                        videoSource === 'competitor'
                          ? 'bg-accent-violet/10 border-accent-violet/50 text-accent-violet'
                          : 'border-bg-border text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                      }`}
                    >
                      <p className="font-semibold leading-tight">Competitor</p>
                      <p className="text-text-muted text-[9px] mt-0.5 leading-snug">Clone mechanism — swap product & claims</p>
                    </button>
                  </div>
                </div>
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block">Reference Hook Video</label>
                  <VideoReferenceInput
                    analysis={videoAnalysis}
                    onChange={setVideoAnalysis}
                    emptyLabel="↑ Upload a hook video"
                  />
                  <p className="text-text-muted text-[10px] mt-1.5 leading-relaxed">
                    {videoSource === 'own'
                      ? 'Same product, same claims, fresh executions. Mechanism stays, wording / visuals are multiplied.'
                      : 'Mechanism is cloned (the WHY it stops the scroll). Product, claims and vertical-specific words are swapped to match your brand.'}
                  </p>
                </div>
              </div>
            )}

            {mode === 'from_brand' && (
              <div className="card px-4 py-3">
                <p className="text-text-secondary text-xs">
                  Hooks will be generated from your brand project documents and the global knowledge base.
                </p>
                <p className="text-text-muted text-xs mt-1">
                  Make sure you&apos;ve uploaded brand docs for best results.
                </p>
              </div>
            )}

            <div>
              <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Number of hooks</label>
              <div className="flex flex-wrap gap-1.5">
                {HOOK_COUNTS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setCount(n)}
                    className={count === n ? 'tag-active' : 'tag-inactive'}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-text-muted text-xs mb-1.5 block uppercase tracking-widest">Instructions <span className="normal-case text-text-muted">(optional)</span></label>
              <textarea
                className="input-field resize-none text-xs"
                rows={3}
                placeholder="Ex: focus on pain-point hooks, only visual hooks, use the mirror angle, mix written + visual…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>
          </div>

          <div className="px-5 py-4 border-t border-bg-border space-y-2">
            <button
              onClick={generate}
              className="btn-primary w-full"
              disabled={anyLoading || (mode === 'from_script' && !script.trim()) || (mode === 'from_video' && !videoAnalysis)}
            >
              {anyLoading ? 'Generating hooks…' : `Generate ${count} Hook${count !== 1 ? 's' : ''}`}
            </button>
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

        {/* Right: Output */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {runs.length === 0 && (
            <div className="card p-12 text-center">
              <p className="text-text-muted text-3xl mb-3">⚡</p>
              <p className="text-text-secondary text-sm">Generate scroll-stopping hooks.</p>
              <p className="text-text-muted text-xs mt-1">Star individual hooks → land in Winners library.</p>
            </div>
          )}

          {runs.map((run) => (
            <div key={run.id} className="space-y-3 group/run">
              {run.loading && (
                <div className="card p-8 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-text-secondary text-sm">Generating {run.count} hook{run.count !== 1 ? 's' : ''}…</p>
                    <p className="text-text-muted text-xs mt-1">No self-censorship. Full creative freedom.</p>
                  </div>
                </div>
              )}

              {run.output && !run.loading && (
                <>
                  <div className="card">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-widest">Hooks</span>
                        <span className="text-text-muted text-xs ml-3">
                          {run.mode === 'from_brand' ? 'From brand knowledge' : run.mode === 'from_script' ? 'From script' : 'From reference video'}
                        </span>
                        {run.winnerKeys.size > 0 && (
                          <span className="text-accent-violet text-xs ml-3">
                            ★ {run.winnerKeys.size} starred
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2 items-center">
                        {run.generationId && (
                          <button
                            onClick={() => getVariations(run.id, run.generationId)}
                            className="btn-secondary text-xs px-3 py-1"
                            disabled={run.variationsLoading}
                          >
                            More Hooks
                          </button>
                        )}
                        <button onClick={() => copyText(run.output)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                        <button
                          onClick={() => deleteRun(run.id)}
                          title="Delete this generation"
                          className="text-text-muted/40 hover:text-accent-red text-sm w-7 h-7 flex items-center justify-center rounded transition-colors opacity-0 group-hover/run:opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <HookList
                      markdown={run.output}
                      bucket="main"
                      winnerKeys={run.winnerKeys}
                      onToggle={(block) => toggleHookWinner(run.id, 'main', block)}
                    />
                  </div>

                  {run.variationsLoading && (
                    <div className="card p-6 flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                      <span className="text-text-secondary text-sm">Generating more hooks…</span>
                    </div>
                  )}

                  {run.variationsOutput && !run.variationsLoading && (
                    <div className="card">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                        <span className="text-text-muted text-xs uppercase tracking-widest">More Hooks</span>
                        <button onClick={() => copyText(run.variationsOutput)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                      </div>
                      <HookList
                        markdown={run.variationsOutput}
                        bucket="more"
                        winnerKeys={run.winnerKeys}
                        onToggle={(block) => toggleHookWinner(run.id, 'more', block)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
      )}
    </div>
  );
}

// Renders a markdown list of hooks as individual cards with a star-toggle.
// Falls back to raw markdown if the parser can't find any numbered block.
function HookList({
  markdown,
  bucket,
  winnerKeys,
  onToggle,
}: {
  markdown: string;
  bucket: 'main' | 'more';
  winnerKeys: Set<string>;
  onToggle: (block: { index: number; full: string; title: string }) => void;
}) {
  const blocks = parseNumberedBlocks(markdown);
  if (blocks.length === 0) {
    return (
      <div className="p-5 result-content">
        <ReactMarkdown>{markdown}</ReactMarkdown>
      </div>
    );
  }
  return (
    <div className="p-3 space-y-2">
      {blocks.map((b) => {
        const assetKey = `${bucket}-hook-${b.index}`;
        const starred = winnerKeys.has(assetKey);
        return (
          <HookCard
            key={b.id}
            block={b}
            starred={starred}
            onToggle={() => onToggle({ index: b.index, full: b.full, title: b.title })}
          />
        );
      })}
    </div>
  );
}

function HookCard({
  block,
  starred,
  onToggle,
}: {
  block: { id: string; index: number; title: string; body: string; full: string };
  starred: boolean;
  onToggle: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      // Copy the full hook block (title + body) so the user gets everything
      // they see on screen — but as plain text (no CSS bg leaks into Docs).
      await navigator.clipboard.writeText(block.full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${
        starred ? 'bg-accent-violet/5 border-accent-violet/40' : 'bg-bg-base/40 border-bg-border'
      }`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          title={starred ? 'Remove from Winners' : 'Mark as Winner'}
          className={`flex-shrink-0 w-7 h-7 rounded-full border flex items-center justify-center text-sm transition-colors ${
            starred
              ? 'bg-accent-violet/20 border-accent-violet text-accent-violet'
              : 'border-bg-border text-text-muted hover:border-accent-violet/50 hover:text-accent-violet'
          }`}
        >
          {starred ? '★' : '☆'}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-text-primary text-sm font-semibold">
              {block.index + 1}. {block.title}
            </p>
            <button
              onClick={copy}
              className="btn-secondary text-[11px] px-2 py-0.5 flex-shrink-0"
              title="Copy this hook"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div className="result-content mt-1.5 [&_p]:mb-0.5">
            <ReactMarkdown>{block.body}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
