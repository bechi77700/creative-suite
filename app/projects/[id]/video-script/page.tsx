'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import SaintGraalGate from '@/components/SaintGraalGate';
import ReactMarkdown from 'react-markdown';

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

export default function VideoScriptPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [hasSaintGraal, setHasSaintGraal] = useState<boolean | null>(null);
  const [step, setStep] = useState<Step>(1);

  const [selectedFormat, setSelectedFormat] = useState('');
  const [selectedLength, setSelectedLength] = useState('');
  const [angles, setAngles] = useState('');
  const [anglesLoading, setAnglesLoading] = useState(false);
  const [selectedAngle, setSelectedAngle] = useState('');
  const [additionalContext, setAdditionalContext] = useState('');

  const [scriptLoading, setScriptLoading] = useState(false);
  const [scriptError, setScriptError] = useState('');
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

  const fetchAngles = async () => {
    if (!selectedFormat || !selectedLength) return;
    setAnglesLoading(true);
    setAngles('');
    setSelectedAngle('');
    const res = await fetch('/api/generate/video-angles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: id, format: selectedFormat, length: selectedLength }),
    });
    const data = await res.json();
    setAngles(data.angles);
    setAnglesLoading(false);
    setStep(3);
  };

  const generateScript = async () => {
    if (!selectedAngle.trim()) return;
    setScriptLoading(true);
    setScriptError('');
    setOutput('');
    setVariationsOutput('');
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
        setScriptError(data.error || `Server error ${res.status}`);
      } else {
        setOutput(data.output);
        setGenerationId(data.generationId);
        setIsWinner(false);
        setStep(4);
      }
    } catch {
      setScriptError('Network error — check the console.');
    } finally {
      setScriptLoading(false);
    }
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
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Steps */}
        <div className="w-80 border-r border-bg-border overflow-y-auto bg-bg-elevated">
          <div className="px-5 py-5 border-b border-bg-border">
            <h1 className="text-text-primary font-semibold text-base">Video Script Generator</h1>
            <div className="flex flex-col gap-2 mt-4">
              <StepBadge n={1} label="Choose Format" />
              <StepBadge n={2} label="Choose Length" />
              <StepBadge n={3} label="Select Angle" />
              <StepBadge n={4} label="Script Ready" />
            </div>
          </div>

          <div className="p-5 space-y-5">
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
                  disabled={scriptLoading || !selectedAngle.trim()}
                >
                  {scriptLoading ? 'Writing script…' : 'Generate Script →'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right: Angles + Output */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Angles */}
          {anglesLoading && (
            <div className="card p-8 flex items-center justify-center gap-3">
              <div className="w-6 h-6 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
              <span className="text-text-secondary text-sm">Proposing angles from brand knowledge…</span>
            </div>
          )}

          {angles && !anglesLoading && (
            <div className="card">
              <div className="px-4 py-3 border-b border-bg-border">
                <span className="text-text-muted text-xs uppercase tracking-widest">Angle Proposals</span>
                <p className="text-text-muted text-xs mt-0.5">Pick one and paste it in Step 3, or request new ones.</p>
              </div>
              <div className="p-5 result-content">
                <ReactMarkdown>{angles}</ReactMarkdown>
              </div>
            </div>
          )}

          {scriptError && (
            <div className="card border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
              <span className="text-red-400 text-sm">✕</span>
              <div>
                <p className="text-red-400 text-sm font-medium">Generation failed</p>
                <p className="text-red-300 text-xs mt-0.5">{scriptError}</p>
              </div>
              <button onClick={() => setScriptError('')} className="ml-auto text-red-400 hover:text-red-300 text-xs">✕</button>
            </div>
          )}

          {/* Script loading */}
          {scriptLoading && (
            <div className="card p-8 flex items-center justify-center">
              <div className="text-center">
                <div className="w-8 h-8 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin mx-auto mb-3" />
                <p className="text-text-secondary text-sm">Writing your script…</p>
              </div>
            </div>
          )}

          {/* Script output */}
          {output && !scriptLoading && (
            <>
              <div className="card">
                <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                  <div>
                    <span className="text-text-muted text-xs uppercase tracking-widest">Script</span>
                    <span className="text-text-muted text-xs ml-3">{selectedFormat} · {selectedLength}</span>
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
                      5 Variations
                    </button>
                    <button onClick={() => copyText(output)} className="btn-secondary text-xs px-3 py-1">Copy</button>
                  </div>
                </div>
                <div className="p-5 result-content">
                  <ReactMarkdown>{output}</ReactMarkdown>
                </div>
              </div>

              {variationsLoading && (
                <div className="card p-6 flex items-center justify-center gap-3">
                  <div className="w-5 h-5 border-2 border-accent-gold/30 border-t-accent-gold rounded-full animate-spin" />
                  <span className="text-text-secondary text-sm">Generating 5 script variations…</span>
                </div>
              )}

              {variationsOutput && !variationsLoading && (
                <div className="card">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-bg-border">
                    <span className="text-text-muted text-xs uppercase tracking-widest">Variations</span>
                    <button onClick={() => copyText(variationsOutput)} className="btn-secondary text-xs px-3 py-1">Copy All</button>
                  </div>
                  <div className="p-5 result-content">
                    <ReactMarkdown>{variationsOutput}</ReactMarkdown>
                  </div>
                </div>
              )}
            </>
          )}

          {!angles && !output && !anglesLoading && !scriptLoading && (
            <div className="card p-12 text-center">
              <p className="text-text-muted text-3xl mb-3">▶</p>
              <p className="text-text-secondary text-sm">Select a format and length to begin.</p>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
}
