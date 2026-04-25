'use client';

import { useEffect, useMemo, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import ReactMarkdown from 'react-markdown';

interface Winner {
  id: string;
  projectId: string;
  generationId: string | null;
  assetType: string;
  assetKey: string;
  content: string;
  imageUrl: string | null;
  meta: string | null;
  createdAt: string;
}

const TYPE_TABS: Array<{ value: string; label: string; icon: string }> = [
  { value: 'all', label: 'All', icon: '★' },
  { value: 'static', label: 'Statics', icon: '🖼' },
  { value: 'iterate', label: 'Iterations', icon: '↻' },
  { value: 'video_script', label: 'Video Scripts', icon: '▶' },
  { value: 'hook', label: 'Hooks', icon: '⚡' },
];

export default function WinnersPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [winners, setWinners] = useState<Winner[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');

  useEffect(() => {
    fetch(`/api/projects/${id}`).then((r) => r.json()).then((d) => setProjectName(d.name));
  }, [id]);

  const fetchWinners = async () => {
    setLoading(true);
    const res = await fetch(`/api/winners?projectId=${id}`);
    const data = await res.json();
    setWinners(data);
    setLoading(false);
  };

  useEffect(() => { fetchWinners(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const removeWinner = async (winnerId: string) => {
    if (!confirm('Remove this from your Winners library?')) return;
    await fetch(`/api/winners/${winnerId}`, { method: 'DELETE' });
    setWinners((prev) => prev.filter((w) => w.id !== winnerId));
  };

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: winners.length };
    for (const w of winners) {
      map[w.assetType] = (map[w.assetType] || 0) + 1;
    }
    return map;
  }, [winners]);

  const filtered = activeTab === 'all'
    ? winners
    : winners.filter((w) => w.assetType === activeTab);

  // Group static + iterate visually; both are images.
  const isImage = (w: Winner) => w.assetType === 'static' || w.assetType === 'iterate';

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10">
          <div className="mb-8">
            <p className="text-accent-violet text-xs font-semibold uppercase tracking-widest mb-2">★ Library</p>
            <h1 className="text-text-primary text-3xl font-bold tracking-tight">Winners</h1>
            <p className="text-text-secondary text-sm mt-2 max-w-2xl">
              Every asset you marked as winner — auto-organised by type.
              Hooks, scripts and visuals stay separated so you can find what scaled fast.
            </p>
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-1.5 mb-6">
            {TYPE_TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setActiveTab(t.value)}
                className={activeTab === t.value ? 'tag-active' : 'tag-inactive'}
              >
                <span className="mr-1.5">{t.icon}</span>
                {t.label}
                <span className="ml-2 opacity-60">{counts[t.value] ?? 0}</span>
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="card h-24 shimmer" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-16 text-center">
              <p className="text-text-muted text-3xl mb-2">★</p>
              <p className="text-text-primary font-medium">
                {activeTab === 'all'
                  ? 'No winners yet'
                  : `No winning ${TYPE_TABS.find((t) => t.value === activeTab)?.label.toLowerCase()} yet`}
              </p>
              <p className="text-text-muted text-sm mt-1">
                Mark individual hooks, scripts or images as winners — they land here.
              </p>
            </div>
          ) : (
            <div className={isImage(filtered[0]) && filtered.every(isImage)
              ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4'
              : 'space-y-3'}>
              {filtered.map((w) => (
                <WinnerCard key={w.id} winner={w} onRemove={() => removeWinner(w.id)} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function WinnerCard({ winner, onRemove }: { winner: Winner; onRemove: () => void }) {
  const meta = winner.meta ? safeParse(winner.meta) : null;
  const isImage = winner.assetType === 'static' || winner.assetType === 'iterate';

  if (isImage && winner.imageUrl) {
    return (
      <div className="card overflow-hidden group/winner">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <a href={winner.imageUrl} target="_blank" rel="noreferrer" className="block">
          <img
            src={winner.imageUrl}
            alt="winner"
            className="w-full h-48 object-cover hover:opacity-90 transition-opacity"
          />
        </a>
        <div className="px-3 py-2 flex items-center justify-between border-t border-bg-border">
          <span className="text-text-muted text-[10px] uppercase tracking-widest">
            {winner.assetType === 'static' ? 'Static' : 'Iteration'}
          </span>
          <button
            onClick={onRemove}
            className="text-text-muted/40 hover:text-accent-red text-sm opacity-0 group-hover/winner:opacity-100 transition-opacity"
            title="Remove from winners"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-4 group/winner">
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-accent-violet text-[10px] uppercase tracking-widest font-semibold">
            {winner.assetType === 'hook' ? 'Hook' : winner.assetType === 'video_script' ? 'Video Script' : winner.assetType}
          </span>
          {meta?.format && (
            <span className="text-text-muted text-[10px]">· {String(meta.format)}</span>
          )}
          {meta?.length && (
            <span className="text-text-muted text-[10px]">· {String(meta.length)}</span>
          )}
          {meta?.mode && (
            <span className="text-text-muted text-[10px]">· {String(meta.mode)}</span>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-text-muted/40 hover:text-accent-red text-sm opacity-0 group-hover/winner:opacity-100 transition-opacity"
          title="Remove from winners"
        >
          ✕
        </button>
      </div>
      <div className="result-content text-sm">
        <ReactMarkdown>{winner.content}</ReactMarkdown>
      </div>
    </div>
  );
}

function safeParse(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
