'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';

type Mode = 'from_script' | 'from_brand';

export default function HookGeneratorPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [mode, setMode] = useState<Mode>('from_brand');
  const [script, setScript] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState('');
  const [generationId, setGenerationId] = useState('');
  const [isWinner, setIsWinner] = useState(false);
  const [variationsLoading, setVariationsLoading] = useState(false);
  const [variationsOutput, setVariationsOutput] = useState('');

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => {
      setProjectName(d.name);
      setHasSaintGraal(d.documents?.some((doc: { type: string }) => doc.type === 'saint_graal_doc') ?? false);
    });
  }, [id]);

  const generate = async () => {
    if (mode === 'from_script' && !script.trim()) return;
    setLoading(true);
    setOutput('');
    setVariationsOutput('');
    const res = await fetch('/api/generate/hooks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, mode, script, instructions }),
    });
    const data = await res.json();
    setOutput(data.output);
    setGenerationId(data.generationId);
    setIsWinner(false);
    setLoading(false);
  };

  const toggleWinner = async () => {
    const res = await fetch(`/api/history/${generationId}/winner`, { method: 'PATCH' });
    const data = await res.json();
    setIsWinner(data.isWinner);
  };

  const getVariations = async () => {
    setVariationsLoading(true);
    setVariationsOutput('');
    const res = await fetch('/api/generate/variations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId }),
    });
    const data = await res.json();
    setVariationsOutput(data.output);
    setVariationsLoading(false);
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      {hasSaintGraal === false ? (
        <SaintGraalGate projectId={id} />
      ) : (
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Form */}
        <div className="w-80 border-r border-bg-border overflow-y-auto bg-bg-elevated">
          <div className="px-5 py-5 border-b border-bg-border">
            <h1 className="text-text-primary font-semibold text-base">Hook Generator</h1>
            <p className="text-text-secondary text-xs mt-1">12 scroll-stopping hooks — written + visual</p>
          </div>

          <div className="p-5 space-y-5">
            {/* Mode selector */}
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
                    Paste a script and generate 12 hook variations for it.
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
              <label className="text-text-muted text-xs mb-1.5 block uppercase tracking-widest">Instructions <span className="normal-case text-text-muted">(optional)</span></label>
              <textarea
                className="input-field resize-none text-xs"
                rows={3}
                placeholder="Ex: focus on pain-point hooks, only visual hooks, use the mirror angle, mix written + visual…"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
              />
            </div>

            <button
              onClick={generate}
              className="btn-primary w-full"
              disabled={loading || (mode === 'from_script' && !script.trim())}
            >
              {loading ? 'Generating hooks…' : 'Generate 12 Hooks'}
            </button>
          </div>
        </div>

        {/* Right: Output */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {loading && (
            <div className="card p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin mx-auto mb-3" />
                <p className="text-text-secondary text-sm">Generating 12 hooks…</p>
                <p className="text-text-muted text-xs mt-1">No self-censorship. Full creative freedom.</p>
              </div>
            </div>
          )}

          {output && !loading && (
            <>
              <div className="card">
                <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                  <div>
                    <span className="text-text-muted text-xs uppercase tracking-widest">Hooks</span>
                    <span className="text-text-muted text-xs ml-3">
                      {mode === 'from_brand' ? 'From brand knowledge' : 'From script'}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={toggleWinner}
                      className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                        isWinner
                          ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                          : 'bg-transparent border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                      }`}
                    >
                      {isWinner ? '★ Winner' : '☆ Mark Winner'}
                    </button>
                    <button onClick={getVariations} className="btn-secondary text-xs px-3 py-1" disabled={variationsLoading}>
                      More Hooks
                    </button>
                    <button onClick={() => copyText(output)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                  </div>
                </div>
                <div className="p-5 result-content">
                  <ReactMarkdown>{output}</ReactMarkdown>
                </div>
              </div>

              {variationsLoading && (
                <div className="card p-6 flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                  <span className="text-text-secondary text-sm">Generating more hooks…</span>
                </div>
              )}

              {variationsOutput && !variationsLoading && (
                <div className="card">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                    <span className="text-text-muted text-xs uppercase tracking-widest">More Hooks</span>
                    <button onClick={() => copyText(variationsOutput)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                  </div>
                  <div className="p-5 result-content">
                    <ReactMarkdown>{variationsOutput}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}

          {!output && !loading && (
            <div className="card p-12 text-center">
              <p className="text-text-muted text-3xl mb-3">⚡</p>
              <p className="text-text-secondary text-sm">Generate 12 scroll-stopping hooks.</p>
              <p className="text-text-muted text-xs mt-1">Mix of written hooks + visual hook ideas. Scored 1-10.</p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
