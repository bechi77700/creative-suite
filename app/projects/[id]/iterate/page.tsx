'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import IteratePanel from '@/components/IteratePanel';
import VideoIteratePanel from '@/components/VideoIteratePanel';
import MultiImageInput, { RefImage } from '@/components/MultiImageInput';

type Tab = 'photo' | 'video';

interface HistoryEntry {
  id: string;
  module: string;
  output: string;
  isWinner: boolean;
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
  const [tab, setTab] = useState<Tab>('photo');
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // ── Photo state ───────────────────────────
  const [photoSelectedPrompt, setPhotoSelectedPrompt] = useState('');
  const [photoPastedPrompt, setPhotoPastedPrompt] = useState('');
  const [photoRefImages, setPhotoRefImages] = useState<RefImage[]>([]);

  // ── Video state ───────────────────────────
  const [videoSelectedScript, setVideoSelectedScript] = useState('');
  const [videoPastedScript, setVideoPastedScript] = useState('');

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => setProjectName(d.name));
    fetch(`/api/history?projectId=${id}`)
      .then((r) => r.json())
      .then((data) => {
        const list = (Array.isArray(data) ? data : data.generations || []) as HistoryEntry[];
        setHistory(list.filter((g) => g.isWinner));
      })
      .catch(() => setHistory([]));
  }, [id]);

  const photoActivePrompt = (photoSelectedPrompt || photoPastedPrompt).trim();
  const photoCanIterate = !!photoActivePrompt || photoRefImages.length > 0;

  const videoActiveScript = (videoSelectedScript || videoPastedScript).trim();

  // Winners filtered per tab — photo iterate uses static-ad code blocks;
  // video iterate uses any winner whose module is video / iterate-video.
  const photoWinners = history.filter(
    (w) => w.module === 'static' || w.module === 'iterate',
  );
  const videoWinners = history.filter(
    (w) => w.module === 'video' || w.module === 'iterate-video',
  );

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          <div>
            <h1 className="text-text-primary font-semibold text-xl">Iterate on a winner</h1>
            <p className="text-text-muted text-sm mt-1">
              Generate sibling variations that keep the winning DNA — for photos or video scripts.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex gap-2 border-b border-bg-border">
            <button
              onClick={() => setTab('photo')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'photo'
                  ? 'text-accent-gold border-accent-gold'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              ▣ Photo
            </button>
            <button
              onClick={() => setTab('video')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === 'video'
                  ? 'text-accent-blue border-accent-blue'
                  : 'text-text-muted border-transparent hover:text-text-secondary'
              }`}
            >
              ▶ Video
            </button>
          </div>

          {/* ── PHOTO TAB ── */}
          {tab === 'photo' && (
            <>
              <div className="card p-5 space-y-4">
                <p className="text-text-secondary text-xs uppercase tracking-widest">1 · Source — photo, prompt, or both</p>

                {photoWinners.length > 0 && (
                  <div>
                    <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-2">
                      From your marked winners
                    </label>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {photoWinners.flatMap((w) =>
                        extractClosedCodeBlocks(w.output).map((block, i) => (
                          <button
                            key={`${w.id}-${i}`}
                            onClick={() => { setPhotoSelectedPrompt(block); setPhotoPastedPrompt(''); }}
                            className={`block w-full text-left text-xs p-3 rounded border transition-colors font-mono ${
                              photoSelectedPrompt === block
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
                    Or paste a prompt manually <span className="normal-case">(optional if you upload a photo below)</span>
                  </label>
                  <textarea
                    className="input-field resize-none text-xs font-mono"
                    rows={6}
                    placeholder="Paste a Nanobanana prompt here…"
                    value={photoPastedPrompt}
                    onChange={(e) => { setPhotoPastedPrompt(e.target.value); setPhotoSelectedPrompt(''); }}
                  />
                </div>

                <div>
                  <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                    Reference photo(s) <span className="normal-case">(optional if you have a prompt — passed straight into Nano Banana 2 for every iteration; multiple allowed)</span>
                  </label>
                  <MultiImageInput
                    images={photoRefImages}
                    onChange={setPhotoRefImages}
                    max={6}
                    emptyLabel="↑ Upload reference photo(s)"
                  />
                </div>

                {!photoCanIterate && (
                  <p className="text-text-muted text-xs">
                    Provide a reference photo, a prompt, or both to enable iteration.
                  </p>
                )}
              </div>

              {photoCanIterate ? (
                <div>
                  <p className="text-text-secondary text-xs uppercase tracking-widest mb-2">2 · Configure iterations</p>
                  <IteratePanel
                    key={`${photoActivePrompt}-${photoRefImages.map((r) => r.base64.slice(0, 8)).join('|') || 'no-img'}`}
                    projectId={id}
                    originalPrompt={photoActivePrompt}
                    initialImages={photoRefImages}
                    hideClose
                  />
                </div>
              ) : (
                <div className="card p-10 text-center">
                  <p className="text-text-muted text-3xl mb-3">▣</p>
                  <p className="text-text-primary text-sm font-medium">Pick a winner, paste a prompt, or upload a photo</p>
                  <p className="text-text-muted text-xs mt-1">Then choose which axes to vary.</p>
                </div>
              )}
            </>
          )}

          {/* ── VIDEO TAB ── */}
          {tab === 'video' && (
            <>
              <div className="card p-5 space-y-4">
                <p className="text-text-secondary text-xs uppercase tracking-widest">1 · Source script</p>

                {videoWinners.length > 0 && (
                  <div>
                    <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-2">
                      From your marked video winners
                    </label>
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {videoWinners.map((w) => (
                        <button
                          key={w.id}
                          onClick={() => { setVideoSelectedScript(w.output); setVideoPastedScript(''); }}
                          className={`block w-full text-left text-xs p-3 rounded border transition-colors ${
                            videoSelectedScript === w.output
                              ? 'bg-accent-blue/10 border-accent-blue/60 text-text-primary'
                              : 'border-bg-border text-text-secondary hover:border-text-muted'
                          }`}
                        >
                          <span className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                            {w.module} · {new Date(w.createdAt).toLocaleDateString()}
                          </span>
                          <span className="line-clamp-4 whitespace-pre-wrap">{w.output}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-text-muted text-[10px] uppercase tracking-widest block mb-1">
                    Or paste a script manually
                  </label>
                  <textarea
                    className="input-field resize-none text-xs"
                    rows={10}
                    placeholder={'Paste a winning video script here — hook, body, CTA…'}
                    value={videoPastedScript}
                    onChange={(e) => { setVideoPastedScript(e.target.value); setVideoSelectedScript(''); }}
                  />
                </div>
              </div>

              {videoActiveScript ? (
                <div>
                  <p className="text-text-secondary text-xs uppercase tracking-widest mb-2">2 · Configure iterations</p>
                  <VideoIteratePanel
                    key={videoActiveScript.slice(0, 40)}
                    projectId={id}
                    originalScript={videoActiveScript}
                    hideClose
                  />
                </div>
              ) : (
                <div className="card p-10 text-center">
                  <p className="text-text-muted text-3xl mb-3">▶</p>
                  <p className="text-text-primary text-sm font-medium">Pick a winner or paste a script</p>
                  <p className="text-text-muted text-xs mt-1">Then choose which axes to vary.</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
