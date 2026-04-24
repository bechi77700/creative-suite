'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';

interface Project {
  id: string;
  name: string;
  createdAt: string;
  _count: { documents: number; generations: number };
}

export default function HomePage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [showForm, setShowForm] = useState(false);

  const fetchProjects = async () => {
    const res = await fetch('/api/projects');
    const data = await res.json();
    setProjects(data);
    setLoading(false);
  };

  useEffect(() => { fetchProjects(); }, []);

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    });
    setNewName('');
    setShowForm(false);
    setCreating(false);
    fetchProjects();
  };

  const deleteProject = async (id: string) => {
    if (!confirm('Delete this brand project and all its data?')) return;
    await fetch(`/api/projects/${id}`, { method: 'DELETE' });
    fetchProjects();
  };

  return (
    <div className="flex h-screen bg-bg-base overflow-hidden">
      <Sidebar />

      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-8 py-12">
          {/* Hero */}
          <div className="mb-10">
            <p className="text-accent-violet text-xs font-semibold uppercase tracking-widest mb-3">
              ● Creative engine
            </p>
            <h1 className="text-text-primary text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              Génère des creas qui <span className="text-accent-violet">scalent.</span>
            </h1>
            <p className="text-text-secondary text-base md:text-lg mt-4 max-w-2xl leading-relaxed">
              Nano Banana prompts, scripts vidéo, hooks, itérations sur tes winners — tout ton pipeline créatif Meta Ads, mis à jour en continu avec ta brand knowledge.
            </p>
          </div>

          {/* Header with create */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-text-primary text-xl font-semibold">Brand projects</h2>
              <p className="text-text-muted text-sm mt-0.5">
                Une project par marque — docs, ads, scripts et générations restent groupés.
              </p>
            </div>
            <button onClick={() => setShowForm(true)} className="btn-primary">
              + New Project
            </button>
          </div>

          {/* Create form */}
          {showForm && (
            <div className="card p-4 mb-6 animate-fade-in">
              <form onSubmit={createProject} className="flex gap-3">
                <input
                  className="input-field flex-1"
                  placeholder="Brand name (e.g. EverHaar, Eloria, Garden & Gather)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn-primary" disabled={creating}>
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">
                  Cancel
                </button>
              </form>
            </div>
          )}

          {/* Projects */}
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card h-20 shimmer" />
              ))}
            </div>
          ) : projects.length === 0 ? (
            <div className="card p-16 text-center">
              <div className="logo-mark mx-auto mb-4 w-12 h-12 text-xl">C</div>
              <p className="text-text-primary font-medium">No brand projects yet</p>
              <p className="text-text-muted text-sm mt-1">Create your first project to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="card px-5 py-4 flex items-center justify-between hover:border-accent-violet/30 transition-colors group"
                >
                  <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                    <h3 className="text-text-primary font-semibold text-sm group-hover:text-accent-violet transition-colors">
                      {project.name}
                    </h3>
                    <div className="flex gap-4 mt-1">
                      <span className="text-text-muted text-xs">
                        {project._count.documents} doc{project._count.documents !== 1 ? 's' : ''}
                      </span>
                      <span className="text-text-muted text-xs">
                        {project._count.generations} generation{project._count.generations !== 1 ? 's' : ''}
                      </span>
                      <span className="text-text-muted text-xs">
                        {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </Link>

                  <div className="flex items-center gap-2 ml-4">
                    <Link href={`/projects/${project.id}/static-brief`} className="btn-secondary text-xs px-3 py-1.5">
                      Static Brief
                    </Link>
                    <Link href={`/projects/${project.id}/video-script`} className="btn-secondary text-xs px-3 py-1.5">
                      Video Script
                    </Link>
                    <Link href={`/projects/${project.id}/hooks`} className="btn-secondary text-xs px-3 py-1.5">
                      Hooks
                    </Link>
                    <button
                      onClick={() => deleteProject(project.id)}
                      className="btn-danger opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
