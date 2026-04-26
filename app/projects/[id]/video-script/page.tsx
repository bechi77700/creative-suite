'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';
import { addWinner, removeWinner } from '@/lib/winners';
import VideoReferenceInput from '@/components/VideoReferenceInput';
import { parseSSE } from '@/lib/streaming';
import type { VideoAnalysis } from '@/lib/gemini-video';

// Parse the angles markdown returned by /api/generate/video-angles into
// individual angle blocks (one per checkbox). Each block looks like:
//   **1. ANGLE NAME**
//   - Core idea: ...
//   - Why it works: ...
//   - Hook preview: ...
function parseAngles(md: string): Array<{ id: string; title: string; body: string; full: string }> {
  if (!md) return [];
  const lines = md.split('\n');
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    const isHeader = /^\*\*\d+\./.test(line.trim());
    if (isHeader && current.length > 0) {
      blocks.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join('\n').trim());

  return blocks
    .filter((b) => /^\*\*\d+\./.test(b.trim()))
    .map((b, i) => {
      const titleMatch = b.match(/^\*\*\d+\.\s*(.+?)\*\*/);
      const title = titleMatch ? titleMatch[1].trim() : `Angle ${i + 1}`;
      const body = b.replace(/^\*\*\d+\..+?\*\*\s*\n?/, '').trim();
      return { id: `a-${i}`, title, body, full: b };
    });
}

const VIDEO_FORMATS = [
  'UGC face cam',
  'UGC testimonial',
  'Mashup / montage + VO',
  'VSL long form',
  'Reaction video',
  'POV (subjective camera)',
  'Unboxing / product demo',
  'Before / After transformation',
  'Talking head expert',
  'Skit / mini sketch',
  'Interview / fake Q&A',
  'Text-only / kinetic typography',
  'Screen recording / tutorial',
];

const LENGTHS = ['7-15s', '15-30s', '30-45s', '45-60s', '60-90s', '90-120s', '2-3 min', '3-5 min'];

type Step = 1 | 2 | 3 | 4;
type Mode = 'scratch' | 'clone';

interface CloneRun {
  id: string;
  output: string;
  loading: boolean;
  error: string;
  generationId: string;
}

interface ScriptRun {
  id: string;
  format: string;
  length: string;
  output: string;
  generationId: string;
  isWinner: boolean;
  variationsOutput: string;
  variationsLoading: boolean;
  loading: boolean;
  error: string;
  feedback: string;
  refining: boolean;
}

export default function VideoScriptPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>('scratch');

  // ── Clone & Adapt state ─────────────────
  const [cloneAnalysis, setCloneAnalysis] = useState<VideoAnalysis | null>(null);
  const [cloneCount, setCloneCount] = useState('3');
  const [cloneAdditional, setCloneAdditional] = useState('');
  const [cloneRuns, setCloneRuns] = useState<CloneRun[]>([]);
  const cloneAnyLoading = cloneRuns.some((r) => r.loading);

  const updateCloneRun = (runId: string, patch: Partial<CloneRun>) => {
    setCloneRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...patch } : r)));
  };

  const generateCloneAndAdapt = async () => {
    if (!cloneAnalysis) return;
    const n = Math.max(1, Math.min(10, parseInt(cloneCount) || 3));
    const runId = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: CloneRun = {
      id: runId,
      output: '',
      loading: true,
      error: '',
      generationId: '',
    };
    setCloneRuns((prev) => [newRun, ...prev]);

    try {
      const res = await fetch('/api/generate/clone-and-adapt-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          videoAnalysis: cloneAnalysis,
          additionalContext: cloneAdditional,
          count: n,
        }),
      });

      if (!res.ok || !res.body) {
        let errMsg = `Server error ${res.status}`;
        try {
          const err = await res.json();
          errMsg = err.error || errMsg;
        } catch { /* noop */ }
        updateCloneRun(runId, { error: errMsg, loading: false });
        return;
      }

      let accumulated = '';
      let generationId = '';
      for await (const evt of parseSSE(res.body)) {
        if (evt.event === 'text') {
          accumulated += (evt.data as { text: string }).text;
          updateCloneRun(runId, { output: accumulated });
        } else if (evt.event === 'done') {
          generationId = (evt.data as { generationId: string }).generationId;
        } else if (evt.event === 'error') {
          updateCloneRun(runId, { error: (evt.data as { error: string }).error });
        }
      }
      updateCloneRun(runId, { loading: false, generationId });
    } catch (e) {
      updateCloneRun(runId, {
        error: e instanceof Error ? e.message : 'Unexpected error',
        loading: false,
      });
    }
  };

  const deleteCloneRun = async (runId: string) => {
    const run = cloneRuns.find((r) => r.id === runId);
    if (!run) return;
    if (!confirm('Delete this Clone & Adapt set?')) return;
    if (run.generationId) {
      try { await fetch(`/api/history/${run.generationId}`, { method: 'DELETE' }); } catch { /* noop */ }
    }
    setCloneRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const [selectedFormat, setSelectedFormat] = useState('');
  const [selectedLength, setSelectedLength] = useState('');
  const [angles, setAngles] = useState('');
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [selectedAngle, setSelectedAngle] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');
  const [checkedAngleIds, setCheckedAngleIds] = useState<Set<string>>(new Set());

  const parsedAngles = useMemo(() => parseAngles(angles), [angles]);

  const toggleAngleCheck = (angleId: string) => {
    const next = new Set(checkedAngleIds);
    if (next.has(angleId)) next.delete(angleId);
    else next.add(angleId);
    setCheckedAngleIds(next);
    // Rebuild step-3 textarea from currently-checked angles, in original order.
    const text = parsedAngles
      .filter((a) => next.has(a.id))
      .map((a) => a.full)
      .join('\n\n');
    setSelectedAngle(text);
  };

  const [runs, setRuns] = useState<ScriptRun[]>([]);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => {
      setProjectName(d.name);
      setHasSaintGraal(d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false);
    });
  }, [id]);

  const updateRun = (runId: string, patch: Partial<ScriptRun>) => {
    setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, ...patch } : r)));
  };

  const fetchAngles = async () => {
    if (!selectedFormat || !selectedLength) return;
    setAnglesLoading(true);
    setAngles('');
    setSelectedAngle('');
    setCheckedAngleIds(new Set());
    setStep(3);

    try {
      const res = await fetch('/api/generate/video-angles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: id, format: selectedFormat, length: selectedLength }),
      });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
        console.error('[video-angles] error:', err.error);
        setAnglesLoading(false);
        return;
      }

      let accumulated = '';
      for await (const evt of parseSSE(res.body)) {
        if (evt.event === 'text' && evt.data && typeof evt.data === 'object' && 'text' in evt.data) {
          accumulated += (evt.data as { text: string }).text;
          setAngles(accumulated);
        } else if (evt.event === 'done') {
          break;
        } else if (evt.event === 'error') {
          console.error('[video-angles] stream error:', evt.data);
          break;
        }
      }
    } catch (e) {
      console.error('[video-angles] fetch failed:', e);
    } finally {
      setAnglesLoading(false);
    }
  };

  const generateScript = async () => {
    if (!selectedAngle.trim()) return;
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const newRun: ScriptRun = {
      id: runId,
      format: selectedFormat,
      length: selectedLength,
      output: '',
      generationId: '',
      isWinner: false,
      variationsOutput: '',
      variationsLoading: false,
      loading: true,
      error: '',
      feedback: '',
      refining: false,
    };
    setRuns((prev) => [newRun, ...prev]);

    try {
      const res = await fetch('/api/generate/video-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          format: selectedFormat,
          length: selectedLength,
          angle: selectedAngle,
          additionalContext,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        updateRun(runId, { error: data.error || `Server error ${res.status}`, loading: false });
      } else {
        updateRun(runId, {
          output: data.output,
          generationId: data.generationId,
          loading: false,
        });
        setStep(4);
      }
    } catch {
      updateRun(runId, { error: 'Network error — check the console.', loading: false });
    }
  };

  const toggleWinner = async (runId: string, generationId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run) return;
    // Optimistic flip — also save to per-asset Winners library so the script
    // shows up there. assetKey 'full' = the whole script (one per generation).
    const next = !run.isWinner;
    updateRun(runId, { isWinner: next });
    if (next) {
      await addWinner({
        projectId: id,
        generationId,
        assetType: 'video_script',
        assetKey: 'full',
        content: run.output,
        meta: { format: run.format, length: run.length },
      });
    } else {
      await removeWinner(generationId, 'full');
    }
    // Keep the legacy batch flag in sync for the existing History UI.
    fetch(`/api/history/${generationId}/winner`, { method: 'PATCH' }).catch(() => undefined);
  };

  const refineRun = async (runId: string) => {
    const run = runs.find((r) => r.id === runId);
    if (!run || !run.feedback.trim() || !run.output) return;
    updateRun(runId, { refining: true });
    try {
      const res = await fetch('/api/generate/video-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          format: run.format,
          length: run.length,
          angle: selectedAngle || '(see previous script)',
          additionalContext,
          previousOutput: run.output,
          feedback: run.feedback,
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        updateRun(runId, { refining: false });
        return;
      }
      updateRun(runId, {
        output: data.output,
        generationId: data.generationId,
        feedback: '',
        refining: false,
        // Reset winner flag — the user is looking at a brand-new script body now.
        isWinner: false,
        variationsOutput: '',
      });
    } catch {
      updateRun(runId, { refining: false });
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
    if (!confirm('Delete this script?')) return;
    if (run.generationId) {
      try { await fetch(`/api/history/${run.generationId}`, { method: 'DELETE' }); } catch { /* noop */ }
    }
    setRuns((prev) => prev.filter((r) => r.id !== runId));
  };

  const clearAll = () => {
    if (runs.length === 0) return;
    if (!confirm(`Clear all ${runs.length} script${runs.length !== 1 ? 's' : ''} from this view? (Saved generations stay in History.)`)) return;
    setRuns([]);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const anyLoading = runs.some((r) => r.loading);

  const StepBadge = ({ n, label }: { n: number; label: string }) => (
    <div className={`flex items-center gap-2 ${step >= n ? 'text-text-primary' : 'text-text-muted'}`}>
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold border ${
        step > n ? 'bg-accent-green border-accent-green text-bg-base' :
        step === n ? 'bg-accent-gold border-accent-gold text-bg-base' :
        'border-bg-border text-text-muted'
      }`}>{step > n ? '✓' : n}</div>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      {hasSaintGraal === false ? (
        <SaintGraalGate projectId={id} />
      ) : (
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden pt-12 md:pt-0">
        {/* Left: Steps */}
        <div className="w-full md:w-80 md:max-h-none max-h-[55vh] md:flex-shrink-0 border-b md:border-b-0 md:border-r border-bg-border overflow-y-auto bg-bg-elevated flex flex-col">
          <div className="px-5 py-5 border-b border-bg-border">
            <h1 className="text-text-primary font-semibold text-base">Video Script Generator</h1>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-1 mt-3 p-1 bg-bg-base rounded-md border border-bg-border">
              <button
                onClick={() => setMode('scratch')}
                className={`text-xs py-1.5 rounded transition-colors ${
                  mode === 'scratch'
                    ? 'bg-accent-gold/20 text-accent-gold font-semibold'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                ✦ From scratch
              </button>
              <button
                onClick={() => setMode('clone')}
                className={`text-xs py-1.5 rounded transition-colors ${
                  mode === 'clone'
                    ? 'bg-accent-violet/20 text-accent-violet font-semibold'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
              >
                ⎘ Clone & Adapt
              </button>
            </div>

            {mode === 'scratch' && (
              <div className="flex flex-col gap-2 mt-4">
                <StepBadge n={1} label="Choose Format" />
                <StepBadge n={2} label="Choose Length" />
                <StepBadge n={3} label="Select Angle" />
                <StepBadge n={4} label="Script Ready" />
              </div>
            )}
            {mode === 'clone' && (
              <p className="text-text-muted text-[11px] mt-3 leading-relaxed">
                Upload a winning video from another brand — Gemini transcribes & decodes it,
                Claude clones the structure for your brand following the SOP.
              </p>
            )}
          </div>

          {mode === 'scratch' && (
          <div className="p-5 space-y-5 flex-1">
            {/* Step 1: Format */}
            <div>
              <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Step 1 — Format</label>
              <div className="space-y-1">
                {VIDEO_FORMATS.map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => { setSelectedFormat(f); if (step < 2) setStep(2); }}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                      selectedFormat === f
                        ? 'bg-accent-gold/10 border border-accent-gold/40 text-accent-gold'
                        : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover border border-transparent'
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Length */}
            {selectedFormat && (
              <div>
                <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Step 2 — Length</label>
                <div className="flex flex-wrap gap-1.5">
                  {LENGTHS.map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => { setSelectedLength(l); if (step < 2) setStep(2); }}
                      className={selectedLength === l ? 'tag-active' : 'tag-inactive'}
                    >
                      {l}
                    </button>
                  ))}
                </div>
                {selectedLength && (
                  <button
                    onClick={fetchAngles}
                    className="btn-primary w-full mt-3"
                    disabled={anglesLoading}
                  >
                    {anglesLoading ? 'Proposing angles…' : 'Get Angle Proposals →'}
                  </button>
                )}
              </div>
            )}

            {/* Step 3: Angle selection */}
            {(step >= 3 || angles) && (
              <div>
                <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Step 3 — Your Angle</label>
                <textarea
                  className="input-field resize-none text-xs"
                  rows={3}
                  placeholder="Paste or type the angle you want to use…"
                  value={selectedAngle}
                  onChange={(e) => setSelectedAngle(e.target.value)}
                />
                <div>
                  <label className="text-text-muted text-xs mb-1.5 block mt-3">Additional Context</label>
                  <textarea
                    className="input-field resize-none text-xs"
                    rows={2}
                    placeholder="Any extra instructions…"
                    value={additionalContext}
                    onChange={(e) => setAdditionalContext(e.target.value)}
                  />
                </div>
                <button
                  onClick={generateScript}
                  className="btn-primary w-full mt-3"
                  disabled={anyLoading || !selectedAngle.trim()}
                >
                  {anyLoading ? 'Writing script…' : 'Generate Script →'}
                </button>
              </div>
            )}
          </div>
          )}

          {mode === 'clone' && (
            <div className="p-5 space-y-4 flex-1">
              <div>
                <label className="text-text-muted text-xs mb-2 block uppercase tracking-widest">Reference video</label>
                <VideoReferenceInput
                  analysis={cloneAnalysis}
                  onChange={setCloneAnalysis}
                  emptyLabel="↑ Upload the reference video"
                />
              </div>

              <div>
                <label className="text-text-muted text-xs mb-1.5 block uppercase tracking-widest">Number of adapted scripts</label>
                <input
                  type="number"
                  min="1"
                  max="10"
                  className="input-field text-xs"
                  value={cloneCount}
                  onChange={(e) => setCloneCount(e.target.value)}
                />
              </div>

              <div>
                <label className="text-text-muted text-xs mb-1.5 block uppercase tracking-widest">Additional context <span className="normal-case">(optional)</span></label>
                <textarea
                  className="input-field resize-none text-xs"
                  rows={3}
                  placeholder='e.g. "lean on the 30-day refund", "target men 35+", "we want a softer CTA"'
                  value={cloneAdditional}
                  onChange={(e) => setCloneAdditional(e.target.value)}
                />
              </div>

              <button
                onClick={generateCloneAndAdapt}
                disabled={!cloneAnalysis || cloneAnyLoading}
                className="btn-primary w-full text-xs"
              >
                {cloneAnyLoading
                  ? 'Cloning & adapting…'
                  : `⎘ Clone & Adapt — ${parseInt(cloneCount) || 3} script${parseInt(cloneCount) === 1 ? '' : 's'}`}
              </button>

              {!cloneAnalysis && (
                <p className="text-text-muted text-[11px] leading-relaxed">
                  Upload a reference video first. Once Gemini finishes the analysis (~10-20s),
                  the button activates and Claude will produce the autopsy + adapted scripts in one go.
                </p>
              )}
            </div>
          )}

          {mode === 'scratch' && runs.length > 0 && (
            <div className="px-5 py-3 border-t border-bg-border">
              <button
                onClick={clearAll}
                className="text-text-muted hover:text-accent-red text-[10px] uppercase tracking-widest w-full text-center transition-colors"
              >
                Clear all scripts ({runs.length})
              </button>
            </div>
          )}
          {mode === 'clone' && cloneRuns.length > 0 && (
            <div className="px-5 py-3 border-t border-bg-border">
              <button
                onClick={() => {
                  if (confirm(`Clear all ${cloneRuns.length} Clone & Adapt set${cloneRuns.length !== 1 ? 's' : ''}?`)) setCloneRuns([]);
                }}
                className="text-text-muted hover:text-accent-red text-[10px] uppercase tracking-widest w-full text-center transition-colors"
              >
                Clear all ({cloneRuns.length})
              </button>
            </div>
          )}
        </div>

        {/* Right: Angles + Output */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {mode === 'clone' && (
            <>
              {cloneRuns.length === 0 && !cloneAnalysis && (
                <div className="card p-12 text-center">
                  <p className="text-text-muted text-3xl mb-3">⎘</p>
                  <p className="text-text-secondary text-sm">Upload a reference video to begin.</p>
                  <p className="text-text-muted text-xs mt-1 max-w-md mx-auto">
                    The output will follow the Clone &amp; Adapt SOP — a Structural Autopsy of the
                    reference, then {parseInt(cloneCount) || 3} adapted scripts that mirror its skeleton
                    and copy DNA for your brand.
                  </p>
                </div>
              )}

              {cloneRuns.map((run) => (
                <div key={run.id} className="card group/clone">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                    <div>
                      <span className="text-text-muted text-xs uppercase tracking-widest">Clone &amp; Adapt</span>
                      {run.loading && <span className="ml-3 text-accent-violet animate-pulse text-xs">● streaming…</span>}
                    </div>
                    <div className="flex gap-2 items-center">
                      {run.output && (
                        <button onClick={() => copyText(run.output)} className="btn-secondary text-xs px-3 py-1">Copy</button>
                      )}
                      <button
                        onClick={() => deleteCloneRun(run.id)}
                        title="Delete this set"
                        className="text-text-muted/40 hover:text-accent-red text-sm w-7 h-7 flex items-center justify-center rounded transition-colors opacity-0 group-hover/clone:opacity-100"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                  {run.error && (
                    <div className="px-4 py-3 border-b border-red-500/30 bg-red-500/10 text-red-400 text-xs">
                      {run.error}
                    </div>
                  )}
                  {run.loading && !run.output && (
                    <div className="p-8 flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-accent-violet/30 border-t-accent-violet rounded-full animate-spin" />
                      <span className="text-text-secondary text-xs">Running autopsy + writing adapted scripts…</span>
                    </div>
                  )}
                  {run.output && (
                    <div className="p-5 result-content">
                      <ReactMarkdown>{run.output}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {mode === 'scratch' && (
          <>
          {/* Angles */}
          {anglesLoading && !angles && (
            <div className="card p-8 flex items-center justify-center gap-3">
              <div className="w-6 h-6 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
              <span className="text-text-secondary text-sm">Proposing angles from brand knowledge…</span>
            </div>
          )}

          {/* While streaming: show raw markdown progressively */}
          {anglesLoading && angles && (
            <div className="card">
              <div className="px-4 py-3 border-b border-bg-border flex items-center gap-3">
                <div className="w-4 h-4 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                <span className="text-text-muted text-xs uppercase tracking-widest">
                  Streaming angles… checkboxes will appear when done
                </span>
              </div>
              <div className="p-5 result-content">
                <ReactMarkdown>{angles}</ReactMarkdown>
              </div>
            </div>
          )}

          {angles && !anglesLoading && (
            <div className="card">
              <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between">
                <div>
                  <span className="text-text-muted text-xs uppercase tracking-widest">Angle Proposals</span>
                  <p className="text-text-muted text-xs mt-0.5">
                    Check the angle(s) you want — they fill Step 3 automatically.
                    {checkedAngleIds.size > 0 && ` · ${checkedAngleIds.size} selected`}
                  </p>
                </div>
                {checkedAngleIds.size > 0 && (
                  <button
                    onClick={() => { setCheckedAngleIds(new Set()); setSelectedAngle(''); }}
                    className="text-text-muted hover:text-text-primary text-[10px] uppercase tracking-widest"
                  >
                    Clear selection
                  </button>
                )}
              </div>
              {parsedAngles.length === 0 ? (
                // Fallback: couldn't parse — render the raw markdown like before
                <div className="p-5 result-content">
                  <ReactMarkdown>{angles}</ReactMarkdown>
                </div>
              ) : (
                <div className="p-3 space-y-2">
                  {parsedAngles.map((a) => {
                    const checked = checkedAngleIds.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAngleCheck(a.id)}
                        className={`w-full text-left rounded-lg border px-4 py-3 transition-colors ${
                          checked
                            ? 'bg-accent-violet/10 border-accent-violet/50'
                            : 'bg-bg-base/40 border-bg-border hover:border-text-muted'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`mt-0.5 flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center text-[10px] font-bold ${
                              checked
                                ? 'bg-accent-violet border-accent-violet text-white'
                                : 'border-bg-border text-transparent'
                            }`}
                          >
                            ✓
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-semibold ${checked ? 'text-accent-violet' : 'text-text-primary'}`}>
                              {a.title}
                            </p>
                            <div className="result-content mt-1.5 [&_p]:mb-0 [&_li]:text-xs">
                              <ReactMarkdown>{a.body}</ReactMarkdown>
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Stack of script runs */}
          {runs.map((run) => (
            <div key={run.id} className="space-y-3 group/run">
              {run.error && (
                <div className="card border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                  <span className="text-red-400 text-sm">✕</span>
                  <div>
                    <p className="text-red-400 text-sm font-medium">Generation failed</p>
                    <p className="text-red-300 text-xs mt-0.5">{run.error}</p>
                  </div>
                  <button
                    onClick={() => deleteRun(run.id)}
                    className="ml-auto text-red-400 hover:text-red-300 text-xs"
                  >✕</button>
                </div>
              )}

              {run.loading && (
                <div className="card p-8 flex items-center justify-center">
                  <div className="text-center">
                    <div className="w-8 h-8 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin mx-auto mb-3" />
                    <p className="text-text-secondary text-sm">Writing your script…</p>
                  </div>
                </div>
              )}

              {run.output && !run.loading && (
                <>
                  <div className="card">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                      <div>
                        <span className="text-text-muted text-xs uppercase tracking-widest">Script</span>
                        <span className="text-text-muted text-xs ml-3">{run.format} · {run.length}</span>
                      </div>
                      <div className="flex gap-2 items-center">
                        {run.generationId && (
                          <>
                            <button
                              onClick={() => toggleWinner(run.id, run.generationId)}
                              className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                                run.isWinner
                                  ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                                  : 'bg-transparent border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                              }`}
                            >
                              {run.isWinner ? '★ Winner' : '☆ Mark Winner'}
                            </button>
                            <button
                              onClick={() => getVariations(run.id, run.generationId)}
                              className="btn-secondary text-xs px-3 py-1"
                              disabled={run.variationsLoading}
                            >
                              5 Variations
                            </button>
                          </>
                        )}
                        <button onClick={() => copyText(run.output)} className="btn-secondary text-xs px-3 py-1">Copy</button>
                        <button
                          onClick={() => deleteRun(run.id)}
                          title="Delete this script"
                          className="text-text-muted/40 hover:text-accent-red text-sm w-7 h-7 flex items-center justify-center rounded transition-colors opacity-0 group-hover/run:opacity-100"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    <div className="p-5 result-content">
                      <ReactMarkdown>{run.output}</ReactMarkdown>
                    </div>

                    {/* Refine with feedback */}
                    <div className="border-t border-bg-border px-4 py-3 bg-bg-base/30">
                      <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1.5">
                        Refine this script with feedback
                      </label>
                      <textarea
                        className="input-field resize-none text-xs"
                        rows={2}
                        placeholder="e.g. shorter intro, sharper CTA, swap the second beat for a testimonial, more punchy hook…"
                        value={run.feedback}
                        onChange={(e) => updateRun(run.id, { feedback: e.target.value })}
                        disabled={run.refining}
                      />
                      <button
                        onClick={() => refineRun(run.id)}
                        disabled={run.refining || !run.feedback.trim()}
                        className="btn-primary text-xs mt-2"
                      >
                        {run.refining ? 'Rewriting…' : 'Regenerate with feedback'}
                      </button>
                    </div>
                  </div>

                  {run.variationsLoading && (
                    <div className="card p-6 flex items-center justify-center gap-3">
                      <div className="w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                      <span className="text-text-secondary text-sm">Generating 5 script variations…</span>
                    </div>
                  )}

                  {run.variationsOutput && !run.variationsLoading && (
                    <div className="card">
                      <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                        <span className="text-text-muted text-xs uppercase tracking-widest">Variations</span>
                        <button onClick={() => copyText(run.variationsOutput)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                      </div>
                      <div className="p-5 result-content">
                        <ReactMarkdown>{run.variationsOutput}</ReactMarkdown>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {!angles && runs.length === 0 && !anglesLoading && (
            <div className="card p-12 text-center">
              <p className="text-text-muted text-3xl mb-3">▶</p>
              <p className="text-text-secondary text-sm">Select a format and length to begin.</p>
            </div>
          )}
          </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
