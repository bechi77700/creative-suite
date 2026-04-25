'use client';

import { useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';

interface Doc {
  id: string;
  name: string;
  type: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  documents: Doc[];
}

const DOC_TYPES = [
  { value: 'saint_graal_doc', label: 'Saint Graal Doc' },
  { value: 'avatar_doc', label: 'Avatar Doc' },
  { value: 'winning_ad', label: 'Winning Ad' },
  { value: 'validated_script', label: 'Validated Script' },
];

const TYPE_COLORS: Record<string, string> = {
  saint_graal_doc: 'text-accent-gold border-accent-gold/30 bg-accent-gold/10',
  avatar_doc: 'text-accent-blue border-accent-blue/30 bg-accent-blue/10',
  winning_ad: 'text-accent-green border-accent-green/30 bg-accent-green/10',
  validated_script: 'text-accent-purple border-accent-purple/30 bg-accent-purple/10',
};

export default function ProjectPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [project, setProject] = useState<Project | null>(null);
  const [uploading, setUploading] = useState(false);
  const [selectedType, setSelectedType] = useState('saint_graal_doc');
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = async (file: File) => {
    setUploading(true);
    const form = new FormData();
    form.append('file', file);
    form.append('type', selectedType);
    await fetch(`/api/projects/${id}`, { method: 'POST', body: form });
    setUploading(false);
    fetchProject();
  };

  const fetchProject = async () => {
    const res = await fetch(`/api/projects/${id}`);
    const data = await res.json();
    setProject(data);
  };

  useEffect(() => { fetchProject(); }, [id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await uploadFile(file);
    e.target.value = '';
  };

  const deleteDoc = async (docId: string) => {
    await fetch(`/api/projects/${id}/documents/${docId}`, { method: 'DELETE' });
    fetchProject();
  };

  if (!project) {
    return (
      <div className="flex h-screen bg-bg-base items-center justify-center">
        <div className="text-text-muted text-sm">Loading…</div>
      </div>
    );
  }

  const grouped = DOC_TYPES.map((t) => ({
    ...t,
    docs: project.documents.filter((d) => d.type === t.value),
  }));

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar projectId={id} projectName={project.name} />

      <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
        <div className="max-w-3xl mx-auto px-4 py-6 md:px-6 md:py-8">
          <div className="mb-8">
            <h1 className="text-text-primary text-2xl font-semibold">{project.name}</h1>
            <p className="text-text-secondary text-sm mt-1">
              Brand documents — injected into every generation for this project.
            </p>
          </div>

          {/* Upload */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              if (!uploading) setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={async (e) => {
              e.preventDefault();
              setDragOver(false);
              if (uploading) return;
              const file = e.dataTransfer.files?.[0];
              if (file) await uploadFile(file);
            }}
            className={`card p-5 mb-6 transition-colors ${
              dragOver ? 'border-accent-gold/60 bg-accent-gold/5' : ''
            }`}
          >
            <h2 className="text-text-primary text-sm font-semibold mb-3">
              Upload Document
              {dragOver && <span className="ml-2 text-accent-gold text-xs">Drop to upload</span>}
            </h2>
            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="text-text-muted text-xs mb-1.5 block">Document Type</label>
                <select
                  className="input-field"
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <label className={`btn-primary cursor-pointer ${uploading ? 'opacity-50 pointer-events-none' : ''}`}>
                {uploading ? 'Uploading…' : '+ Upload File'}
                <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.txt,.md,.doc,.docx,.jpg,.jpeg,.png,.webp" />
              </label>
            </div>
            <p className="text-text-muted text-xs mt-2">
              PDF, TXT, MD, DOC, DOCX, images — max 10MB · or drag &amp; drop anywhere on this card
            </p>
          </div>

          {/* Documents by type */}
          <div className="space-y-4">
            {grouped.map((group) => (
              <div key={group.value} className="card">
                <div className="px-4 py-3 border-b border-bg-border flex items-center justify-between">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded border ${TYPE_COLORS[group.value]}`}>
                    {group.label}
                  </span>
                  <span className="text-text-muted text-xs">{group.docs.length} file{group.docs.length !== 1 ? 's' : ''}</span>
                </div>
                {group.docs.length === 0 ? (
                  <div className="px-4 py-4 text-text-muted text-xs">No files uploaded yet.</div>
                ) : (
                  <div className="divide-y divide-bg-border">
                    {group.docs.map((doc) => (
                      <div key={doc.id} className="px-4 py-3 flex items-center justify-between group">
                        <div className="min-w-0">
                          <p className="text-text-primary text-sm truncate">{doc.name}</p>
                          <p className="text-text-muted text-xs">
                            {(doc.size / 1024).toFixed(0)} KB ·{' '}
                            {new Date(doc.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteDoc(doc.id)}
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
        </div>
      </main>
    </div>
  );
}
