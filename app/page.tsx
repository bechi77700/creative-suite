'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Sidebar from '@/components/Sidebar';
import Logo from '@/components/Logo';

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

      <main className="flex-1 overflow-y-auto pt-12 md:pt-0">
        <div className="max-w-5xl mx-auto px-4 py-6 md:px-8 md:py-12">
          {/* Hero */}
          <div className="mb-10">
            <p className="text-accent-violet text-sm font-semibold uppercase tracking-widest mb-3">
              ● Creative engine
            </p>
            <h1 className="text-text-primary text-5xl md:text-6xl font-bold tracking-tight leading-[1.05]">
              Génère des creas qui <span className="text-accent-violet">scalent.</span>
            </h1>
            <p className="text-text-secondary text-lg md:text-xl mt-5 max-w-2xl leading-relaxed">
              Nano Banana prompts, scripts vidéo, hooks, itérations sur tes winners — tout ton pipeline créatif Meta Ads, mis à jour en continu avec ta brand knowledge.
            </p>
          </div>

          {/* Header with create */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-text-primary text-2xl font-semibold">Brand projects</h2>
              <p className="text-text-muted text-base mt-1">
                Une project par marque — docs, ads, scripts et générations restent groupés.
              </p>
            </div>
            <button onClick={() => setShowForm(true)} className="btn-primary self-start sm:self-auto">
              + New Project
            </button>
          </div>

          {/* Create form */}
          {showForm && (
            <div className="card p-4 mb-6 animate-fade-in">
              <form onSubmit={createProject} className="flex flex-col sm:flex-row gap-3">
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
              <div className="flex justify-center mb-4"><Logo size={48} /></div>
              <p className="text-text-primary font-medium">No brand projects yet</p>
              <p className="text-text-muted text-sm mt-1">Create your first project to get started.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="card px-4 py-4 md:px-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 hover:border-accent-violet/30 transition-colors group"
                >
                  <Link href={`/projects/${project.id}`} className="flex-1 min-w-0">
                    <h3 className="text-text-primary font-semibold text-base group-hover:text-accent-violet transition-colors">
                      {project.name}
                    </h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                      <span className="text-text-muted text-sm">
                        {project._count.documents} doc{project._count.documents !== 1 ? 's' : ''}
                      </span>
                      <span className="text-text-muted text-sm">
                        {project._count.generations} generation{project._count.generations !== 1 ? 's' : ''}
                      </span>
                      <span className="text-text-muted text-sm">
                        {new Date(project.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>
                  </Link>

                  <div className="flex flex-wrap items-center gap-2 md:ml-4">
                    <Link href={`/projects/${project.id}/static-brief`} className="btn-secondary text-sm px-3 py-1.5">
                      Static Brief
                    </Link>
                    <Link href={`/projects/${project.id}/video-script`} className="btn-secondary text-sm px-3 py-1.5">
                      Video Script
                    </Link>
                    <Link href={`/projects/${project.id}/hooks`} className="btn-secondary text-sm px-3 py-1.5">
                      Hooks
                    </Link>
                    <button
                      onClick={() => deleteProject(project.id)}
                      className="btn-danger md:opacity-0 md:group-hover:opacity-100 transition-opacity"
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
