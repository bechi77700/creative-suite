'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import ReactMarkdown from 'react-markdown';
import Link from 'next/link';

interface Generation {
  id: string;
  module: string;
  inputs: string;
  output: string;
  isWinner: boolean;
  createdAt: string;
}

const MODULE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  static: { label: 'Static Brief', icon: '▣', color: 'text-accent-gold border-accent-gold/30 bg-accent-gold/10' },
  video: { label: 'Video Script', icon: '▶', color: 'text-accent-blue border-accent-blue/30 bg-accent-blue/10' },
  hook: { label: 'Hook Generator', icon: '⚡', color: 'text-accent-purple border-accent-purple/30 bg-accent-purple/10' },
};

export default function HistoryPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [projectName, setProjectName] = useState('');
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'winners'>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [variationsLoading, setVariationsLoading] = useState<string | null>(null);
  const [variationsOutput, setVariationsOutput] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);

  const fetchData = async () => {
    const [proj, hist] = await Promise.all([
      fetch(`/api/projects/${id}`).then((r) => r.json()),
      fetch(`/api/history?projectId=${id}`).then((r) => r.json()),
    ]);
    setProjectName(proj.name);
    setGenerations(hist);
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [id]);

  const toggleWinner = async (genId: string) => {
    await fetch(`/api/history/${genId}/winner`, { method: 'PATCH' });
    fetchData();
  };

  const getVariations = async (genId: string) => {
    setVariationsLoading(genId);
    const res = await fetch('/api/generate/variations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ generationId: genId }),
    });
    const data = await res.json();
    setVariationsOutput((prev) => ({ ...prev, [genId]: data.output }));
    setVariationsLoading(null);
    fetchData();
  };

  const copyText = (text: string) => navigator.clipboard.writeText(text);

  const deleteOne = async (genId: string) => {
    if (!confirm('Delete this generation? This cannot be undone.')) return;
    await fetch(`/api/history/${genId}`, { method: 'DELETE' });
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(genId);
      return next;
    });
    if (expanded === genId) setExpanded(null);
    fetchData();
  };

  const toggleSelected = (genId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(genId)) next.delete(genId);
      else next.add(genId);
      return next;
    });
  };

  const deleteSelected = async () => {
    if (selected.size === 0) return;
    if (!confirm(`Delete ${selected.size} generation${selected.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    setDeleting(true);
    await Promise.all(
      Array.from(selected).map((id) => fetch(`/api/history/${id}`, { method: 'DELETE' })),
    );
    setSelected(new Set());
    setDeleting(false);
    fetchData();
  };

  const filtered = filter === 'winners'
    ? generations.filter((g) => g.isWinner)
    : generations;

  const getInputSummary = (inputs: string, module: string) => {
    try {
      const parsed = JSON.parse(inputs);
      if (module === 'static') return `${parsed.angle} · ${parsed.designFamily} · ${parsed.audience}`;
      if (module === 'video') return `${parsed.format} · ${parsed.length}`;
      if (module === 'hook') return parsed.mode === 'from_script' ? 'From script' : 'From brand';
      return '';
    } catch { return ''; }
  };

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={projectName} />

      <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
        <div className="max-w-4xl mx-auto px-4 py-6 md:px-6 md:py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-text-primary text-2xl font-semibold">Generation History</h1>
              <p className="text-text-secondary text-sm mt-1">
                All outputs for {projectName}. Mark winners to influence future generations.
              </p>
            </div>
            <div className="flex gap-2 items-center">
              {selected.size > 0 && (
                <button
                  onClick={deleteSelected}
                  disabled={deleting}
                  className="px-3 py-1.5 rounded text-xs font-medium border border-accent-red/40 bg-accent-red/10 text-accent-red hover:bg-accent-red/20 transition-colors"
                >
                  {deleting ? 'Deleting…' : `🗑 Delete ${selected.size}`}
                </button>
              )}
              <button
                onClick={() => setFilter('all')}
                className={filter === 'all' ? 'tag-active' : 'tag-inactive'}
              >All ({generations.length})</button>
              <button
                onClick={() => setFilter('winners')}
                className={filter === 'winners' ? 'tag-active' : 'tag-inactive'}
              >★ Winners ({generations.filter((g) => g.isWinner).length})</button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <div key={i} className="card h-16 shimmer" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card p-12 text-center">
              <p className="text-text-muted text-3xl mb-3">◷</p>
              <p className="text-text-secondary text-sm">
                {filter === 'winners' ? 'No winners marked yet.' : 'No generations yet.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map((gen) => {
                const meta = MODULE_LABELS[gen.module] || MODULE_LABELS.static;
                const isExpanded = expanded === gen.id;
                const summary = getInputSummary(gen.inputs, gen.module);

                return (
                  <div key={gen.id} className={`card border ${gen.isWinner ? 'border-accent-gold/30' : 'border-bg-border'}`}>
                    {/* Header row */}
                    <div
                      className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-bg-hover transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : gen.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <input
                          type="checkbox"
                          checked={selected.has(gen.id)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={() => toggleSelected(gen.id)}
                          className="w-3.5 h-3.5 cursor-pointer"
                          title="Select for bulk delete"
                        />
                        {gen.isWinner && <span className="text-accent-gold text-xs">★</span>}
                        <span className={`text-xs font-medium px-2 py-0.5 rounded border ${meta.color}`}>
                          {meta.icon} {meta.label}
                        </span>
                        {summary && (
                          <span className="text-text-muted text-xs truncate">{summary}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 ml-3">
                        <span className="text-text-muted text-xs whitespace-nowrap">
                          {new Date(gen.createdAt).toLocaleDateString('en-US', {
                            month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deleteOne(gen.id); }}
                          className="text-text-muted hover:text-accent-red text-xs transition-colors"
                          title="Delete this generation"
                        >
                          🗑
                        </button>
                        <span className="text-text-muted text-xs">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded */}
                    {isExpanded && (
                      <div className="border-t border-bg-border">
                        <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated">
                          <span className="text-text-muted text-xs">Output</span>
                          <div className="flex gap-2">
                            <button
                              onClick={() => toggleWinner(gen.id)}
                              className={`px-3 py-1 rounded text-xs font-medium border transition-colors ${
                                gen.isWinner
                                  ? 'bg-accent-gold/20 border-accent-gold/60 text-accent-gold'
                                  : 'border-bg-border text-text-muted hover:border-accent-gold/40 hover:text-accent-gold'
                              }`}
                            >
                              {gen.isWinner ? '★ Winner' : '☆ Mark Winner'}
                            </button>
                            <button
                              onClick={() => getVariations(gen.id)}
                              className="btn-secondary text-xs px-3 py-1"
                              disabled={variationsLoading === gen.id}
                            >
                              {variationsLoading === gen.id ? 'Generating…' : '5 Variations'}
                            </button>
                            {gen.isWinner && (
                              <Link
                                href={`/projects/${id}/iterate`}
                                className="px-3 py-1 rounded text-xs font-medium border bg-accent-gold/10 border-accent-gold/40 text-accent-gold hover:bg-accent-gold/20 transition-colors"
                              >
                                ↻ Iterate
                              </Link>
                            )}
                            <button onClick={() => copyText(gen.output)} className="btn-secondary text-xs px-3 py-1">
                              Copy
                            </button>
                            <button
                              onClick={() => deleteOne(gen.id)}
                              className="px-3 py-1 rounded text-xs font-medium border border-accent-red/40 text-accent-red hover:bg-accent-red/10 transition-colors"
                            >
                              🗑 Delete
                            </button>
                          </div>
                        </div>
                        <div className="p-5 result-content max-h-96 overflow-y-auto">
                          <ReactMarkdown>{gen.output}</ReactMarkdown>
                        </div>

                        {variationsOutput[gen.id] && (
                          <div className="border-t border-bg-border">
                            <div className="flex items-center justify-between px-4 py-2 bg-bg-elevated">
                              <span className="text-text-muted text-xs">Variations</span>
                              <button onClick={() => copyText(variationsOutput[gen.id])} className="btn-secondary text-xs px-3 py-1">
                                Copy All
                              </button>
                            </div>
                            <div className="p-5 result-content max-h-96 overflow-y-auto">
                              <ReactMarkdown>{variationsOutput[gen.id]}</ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
