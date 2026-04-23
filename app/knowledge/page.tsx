'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface KnowledgeItem {
  id: string;
  name: string;
  category: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

const CATEGORIES = [
  { value: 'copywriting_books', label: 'Copywriting Books', icon: '📖' },
  { value: 'video_frameworks', label: 'Video Frameworks', icon: '🎬' },
  { value: 'hook_swipe_file', label: 'Hook Swipe File', icon: '⚡' },
  { value: 'meta_ads_principles', label: 'Meta Ads Principles', icon: '📊' },
  { value: 'static_ads', label: 'Static Ads', icon: '▣' },
];

const CAT_COLORS: Record<string, string> = {
  copywriting_books: 'text-accent-gold border-accent-gold/30 bg-accent-gold/10',
  video_frameworks: 'text-accent-purple border-accent-purple/30 bg-accent-purple/10',
  hook_swipe_file: 'text-accent-blue border-accent-blue/30 bg-accent-blue/10',
  meta_ads_principles: 'text-accent-green border-accent-green/30 bg-accent-green/10',
  static_ads: 'text-accent-red border-accent-red/30 bg-accent-red/10',
};

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('copywriting_books');

  const fetchItems = async () => {
    const res = await fetch('/api/knowledge');
    const data = await res.json();
    setItems(data);
    setLoading(false);
  };

  useEffect(() => { fetchItems(); }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('category', selectedCategory);
    await fetch('/api/knowledge', { method: 'POST', body: form });
    setUploading(false);
    fetchItems();
    e.target.value = '';
  };

  const deleteItem = async (id: string) => {
    await fetch(`/api/knowledge/${id}`, { method: 'DELETE' });
    fetchItems();
  };

  const grouped = CATEGORIES.map((c) => ({
    ...c,
    items: items.filter((i) => i.category === c.value),
  }));

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-8">
          <div className="mb-8">
            <h1 className="text-text-primary text-2xl font-semibold">Global Knowledge Base</h1>
            <p className="text-text-secondary text-sm mt-1">
              Uploaded once — injected into every generation across all brand projects.
            </p>
          </div>

          {/* Upload */}
          <div className="card p-5 mb-6">
            <h2 className="text-text-primary text-sm font-semibold mb-3">Add to Knowledge Base</h2>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-text-muted text-xs mb-1.5 block">Category</label>
                <select
                  className="input-field"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <label className={`btn-primary cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? 'Uploading…' : '+ Add File'}
                <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.txt,.md,.doc,.docx,.jpg,.jpeg,.png" />
              </label>
            </div>
            <p className="text-text-muted text-xs mt-2">PDF, TXT, MD, DOC, images — stored globally and used in all generations.</p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-5 gap-3 mb-6">
            {grouped.map((g) => (
              <div key={g.value} className="card px-4 py-3 text-center">
                <p className="text-2xl mb-1">{g.icon}</p>
                <p className="text-text-primary text-lg font-semibold">{g.items.length}</p>
                <p className="text-text-muted text-xs">{g.label}</p>
              </div>
            ))}
          </div>

          {/* Items by category */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2].map((i) => <div key={i} className="card h-24 shimmer" />)}
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map((group) => (
                <div key={group.value} className="card">
                  <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{group.icon}</span>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded border ${CAT_COLORS[group.value]}`}>
                        {group.label}
                      </span>
                    </div>
                    <span className="text-text-muted text-xs">{group.items.length} file{group.items.length !== 1 ? 's' : ''}</span>
                  </div>
                  {group.items.length === 0 ? (
                    <div className="px-4 py-4 text-text-muted text-xs">No files in this category yet.</div>
                  ) : (
                    <div className="divide-y divide-bg-border">
                      {group.items.map((item) => (
                        <div key={item.id} className="px-4 py-3 flex items-center justify-between group">
                          <div className="min-w-0">
                            <p className="text-text-primary text-sm truncate">{item.name}</p>
                            <p className="text-text-muted text-xs">
                              {(item.size / 1024).toFixed(0)} KB ·{' '}
                              {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                            </p>
                          </div>
                          <button
                            onClick={() => deleteItem(item.id)}
                            className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity ml-3"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
