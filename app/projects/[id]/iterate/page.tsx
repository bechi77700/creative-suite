'use client';

import { useEffect, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import IteratePanel from '@/components/IteratePanel';

interface Winner {
  id: string;
  module: string;
  output: string;
  createdAt: string;
}

// Pull all triple-backtick code blocks (closed) from a markdown string.
function extractClosedCodeBlocks(text: string): string[] {
  const regex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    out.push(match[1].trim());
  }
  return out;
}

export default function IteratePage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [winners, setWinners] = useState<Winner[]>([]);
  const [selectedPrompt, setSelectedPrompt] = useState<string>('');
  const [pastedPrompt, setPastedPrompt] = useState('');
  const [productRefFile, setProductRefFile] = useState<File | null>(null);
  const [productRefPreview, setProductRefPreview] = useState('');
  const productRefInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => setProjectName(d.name));
    fetch(`/api/history?projectId=${id}`)
      .then((r) => r.json())
      .then((data) => {
        const list = (Array.isArray(data) ? data : data.generations || []) as Array<Winner & { isWinner?: boolean }>;
        setWinners(list.filter((g) => g.isWinner));
      })
      .catch(() => setWinners([]));
  }, [id]);

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

  const activePrompt = (selectedPrompt || pastedPrompt).trim();

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-text-primary font-semibold text-xl">Iterate on a winning prompt</h1>
            <p className="text-text-muted text-sm mt-1">
              Pick a prior winner — or paste any prompt — and generate sibling variations that keep the winning DNA.
            </p>
          </div>

          {/* Winner picker */}
          <div className="card p-5 space-y-4">
            <p className="text-text-secondary text-xs uppercase tracking-widest">1 · Choose source prompt</p>

            {winners.length > 0 && (
              <div>
                <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-2">
                  From your marked winners
                </label>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {winners.flatMap((w) =>
                    extractClosedCodeBlocks(w.output).map((block, i) => (
                      <button
                        key={`${w.id}-${i}`}
                        onClick={() => { setSelectedPrompt(block); setPastedPrompt(''); }}
                        className={`block w-full text-left text-xs p-3 rounded border transition-colors font-mono ${
                          selectedPrompt === block
                            ? 'bg-accent-gold/10 border-accent-gold/60 text-text-primary'
                            : 'border-bg-border text-text-secondary hover:border-text-muted'
                        }`}
                      >
                        <span className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                          {w.module} · {new Date(w.createdAt).toLocaleDateString()}
                        </span>
                        <span className="line-clamp-3 whitespace-pre-wrap">{block}</span>
                      </button>
                    )),
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                Or paste a prompt manually
              </label>
              <textarea
                className="input-field resize-none text-xs font-mono"
                rows={6}
                placeholder="Paste a Nanobanana prompt here…"
                value={pastedPrompt}
                onChange={(e) => { setPastedPrompt(e.target.value); setSelectedPrompt(''); }}
              />
            </div>

            <div>
              <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                Product reference image <span className="normal-case">(optional, for image generation)</span>
              </label>
              {productRefPreview ? (
                <div className="relative inline-block">
                  <img
                    src={productRefPreview}
                    alt="product ref"
                    className="h-24 rounded-md border border-bg-border"
                  />
                  <button
                    onClick={removeProductRef}
                    className="absolute top-1 right-1 bg-bg-base/90 text-text-muted text-[10px] px-1.5 py-0.5 rounded hover:text-accent-red"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label className="flex items-center justify-center h-20 border border-dashed border-bg-border rounded-md cursor-pointer hover:border-accent-gold/50 transition-colors">
                  <span className="text-text-muted text-xs">↑ Upload product photo</span>
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
          </div>

          {/* Iterate panel */}
          {activePrompt ? (
            <div>
              <p className="text-text-secondary text-xs uppercase tracking-widest mb-2">2 · Configure iterations</p>
              <IteratePanel
                projectId={id}
                originalPrompt={activePrompt}
                initialImage={initialImageForChild}
                hideClose
              />
            </div>
          ) : (
            <div className="card p-10 text-center">
              <p className="text-text-muted text-3xl mb-3">↻</p>
              <p className="text-text-primary text-sm font-medium">Pick a winner or paste a prompt above</p>
              <p className="text-text-muted text-xs mt-1">Then choose which axes to vary.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
