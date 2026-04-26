'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import Logo from '@/components/Logo';

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: { text: string; tone: 'new' | 'soon' };
}

// Inline SVG icons (Lucide-style stroke icons) — keeps bundle tiny
const Icon = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 12l9-9 9 9" /><path d="M5 10v10a1 1 0 0 0 1 1h3v-6h6v6h3a1 1 0 0 0 1-1V10" />
    </svg>
  ),
  brain: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v15A2.5 2.5 0 0 0 9.5 22h0a2.5 2.5 0 0 0 2.5-2.5v-15A2.5 2.5 0 0 0 9.5 2Z" />
      <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v15a2.5 2.5 0 0 1-2.5 2.5h0a2.5 2.5 0 0 1-2.5-2.5v-15A2.5 2.5 0 0 1 14.5 2Z" />
    </svg>
  ),
  image: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  ),
  refresh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" />
    </svg>
  ),
  video: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="m22 8-6 4 6 4V8Z" /><rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  ),
  zap: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
    </svg>
  ),
  history: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 3" />
    </svg>
  ),
  folder: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  ),
  arrowLeft: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="m12 19-7-7 7-7" /><path d="M19 12H5" />
    </svg>
  ),
  star: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M12 2l2.9 6.6 7.1.6-5.4 4.7 1.6 7-6.2-3.7-6.2 3.7 1.6-7L2 9.2l7.1-.6L12 2z" />
    </svg>
  ),
};

const overviewItems: NavItem[] = [
  { href: '/', label: 'Projects', icon: Icon.home },
  { href: '/knowledge', label: 'Knowledge Base', icon: Icon.brain },
];

const moduleItems = [
  { label: 'Static Brief', icon: Icon.image, path: 'static-brief' },
  { label: 'Iterate', icon: Icon.refresh, path: 'iterate' },
  { label: 'Video Script', icon: Icon.video, path: 'video-script' },
  { label: 'Hook Generator', icon: Icon.zap, path: 'hooks' },
  { label: 'Winners', icon: Icon.star, path: 'winners' },
  { label: 'History', icon: Icon.history, path: 'history' },
];

interface SidebarProps {
  projectId?: string;
  projectName?: string;
}

function Badge({ text, tone }: { text: string; tone: 'new' | 'soon' }) {
  const cls = tone === 'new'
    ? 'bg-accent-green/15 text-accent-green border-accent-green/30'
    : 'bg-bg-hover text-text-muted border-bg-border';
  return (
    <span className={`ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${cls}`}>
      {text}
    </span>
  );
}

export default function Sidebar({ projectId, projectName }: SidebarProps) {
  const pathname = usePathname();
  // Mobile drawer open/close. On desktop (>= md) the sidebar is always visible.
  const [open, setOpen] = useState(false);

  // Close the drawer whenever the route changes (so tapping a nav link feels right).
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock background scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      {/* Mobile top bar — always visible on small screens. The hamburger
          opens the drawer; the logo links home. */}
      <div className="md:hidden fixed top-0 inset-x-0 z-30 h-12 bg-bg-elevated/95 backdrop-blur border-b border-bg-border flex items-center justify-between px-3">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="w-9 h-9 rounded-lg flex items-center justify-center text-text-primary hover:bg-bg-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-5 h-5">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
        </button>
        <Link href="/" className="flex items-center gap-2">
          <Logo size={22} noGlow />
          <span className="text-text-primary font-semibold text-sm tracking-tight">Creative Suite</span>
        </Link>
        <span className="w-9" />
      </div>

      {/* Mobile backdrop */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          className="md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm"
          aria-hidden
        />
      )}

      <aside
        className={`
          ${open ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0
          fixed md:relative inset-y-0 left-0 z-50
          w-64 md:w-60 bg-bg-elevated border-r border-bg-border
          flex flex-col h-screen flex-shrink-0
          transition-transform duration-200 ease-out
        `}
      >
      {/* Logo */}
      <div className="px-4 py-5 border-b border-bg-border flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <Logo size={28} className="transition-transform group-hover:scale-105" />
          <span className="text-text-primary font-semibold text-base tracking-tight group-hover:text-accent-violet transition-colors">
            Creative Suite
          </span>
        </Link>
        {/* Close button — mobile only */}
        <button
          onClick={() => setOpen(false)}
          aria-label="Close menu"
          className="md:hidden w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Scrollable nav area */}
      <div className="flex-1 overflow-y-auto py-3 px-3 space-y-5">

        {/* Overview section */}
        <Section label="Overview">
          {overviewItems.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              icon={item.icon}
              label={item.label}
              active={pathname === item.href}
              badge={item.badge}
            />
          ))}
        </Section>

        {/* Project modules — only when inside a project */}
        {projectId && (
          <>
            <Section label="Project" sublabel={projectName}>
              <NavLink
                href={`/projects/${projectId}`}
                icon={Icon.folder}
                label="Project files"
                active={pathname === `/projects/${projectId}`}
              />
            </Section>

            <Section label="Generate">
              {moduleItems.map((item) => {
                const href = `/projects/${projectId}/${item.path}`;
                const active = pathname.startsWith(href);
                return (
                  <NavLink
                    key={item.path}
                    href={href}
                    icon={item.icon}
                    label={item.label}
                    active={active}
                  />
                );
              })}
            </Section>
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-bg-border">
        <p className="text-text-muted text-[10px] uppercase tracking-widest">US Market · Meta Ads</p>
      </div>
      </aside>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function Section({
  label,
  sublabel,
  children,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="px-2.5 mb-2">
        <p className="text-text-muted text-[10px] uppercase tracking-widest font-medium">{label}</p>
        {sublabel && (
          <p className="text-text-primary text-xs font-semibold mt-0.5 truncate">{sublabel}</p>
        )}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  active,
  badge,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: { text: string; tone: 'new' | 'soon' };
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
        active
          ? 'bg-accent-violet/10 text-accent-violet'
          : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover'
      }`}
    >
      <span className={active ? 'text-accent-violet' : 'text-text-muted'}>{icon}</span>
      <span className="font-medium">{label}</span>
      {badge && <Badge {...badge} />}
    </Link>
  );
}
