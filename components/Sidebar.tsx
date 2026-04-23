'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Projects', icon: '◈' },
  { href: '/knowledge', label: 'Knowledge Base', icon: '⊕' },
];

const moduleItems = [
  { label: 'Static Brief', icon: '▣', path: 'static-brief' },
  { label: 'Video Script', icon: '▶', path: 'video-script' },
  { label: 'Hook Generator', icon: '⚡', path: 'hooks' },
  { label: 'History', icon: '◷', path: 'history' },
];

interface SidebarProps {
  projectId?: string;
  projectName?: string;
}

export default function Sidebar({ projectId, projectName }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside className="w-56 bg-bg-elevated border-r border-bg-border flex flex-col h-screen flex-shrink-0">
      {/* Logo */}
      <div className="px-4 py-5 border-b border-bg-border">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded bg-accent-gold/20 border border-accent-gold/40 flex items-center justify-center">
            <span className="text-accent-gold text-xs font-bold">CS</span>
          </div>
          <span className="text-text-primary font-semibold text-sm tracking-wide">Creative Suite</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="px-2 py-3 border-b border-bg-border">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors duration-150 mb-0.5 ${
                active
                  ? 'bg-accent-gold/10 text-accent-gold border border-accent-gold/20'
                  : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
              }`}
            >
              <span className="text-xs opacity-70">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Project modules — only shown when inside a project */}
      {projectId && (
        <div className="px-2 py-3 flex-1 overflow-y-auto">
          <div className="px-3 mb-2">
            <p className="text-text-muted text-xs uppercase tracking-widest font-medium">Project</p>
            <p className="text-text-gold text-xs font-semibold mt-0.5 truncate">{projectName}</p>
          </div>

          <div className="space-y-0.5">
            {moduleItems.map((item) => {
              const href = `/projects/${projectId}/${item.path}`;
              const active = pathname.startsWith(href);
              return (
                <Link
                  key={item.path}
                  href={href}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors duration-150 ${
                    active
                      ? 'bg-accent-gold/10 text-accent-gold border border-accent-gold/20'
                      : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  <span className="text-xs opacity-70">{item.icon}</span>
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* Back to project */}
          <div className="mt-3 px-3">
            <Link
              href={`/projects/${projectId}`}
              className={`flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors ${
                pathname === `/projects/${projectId}` ? 'text-text-secondary' : ''
              }`}
            >
              <span>←</span> Project files
            </Link>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-bg-border">
        <p className="text-text-muted text-xs">US Market · Meta Ads</p>
      </div>
    </aside>
  );
}
