'use client';
import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { QueuePanel } from './QueuePanel';
import { UsagePanel } from './UsagePanel';
import { Copilot } from './Copilot';
import { useApp, useBoot } from '@/store/app';
import { cx } from '@/components/ui/primitives';

export function AppShell({ children, stageNav, bare }: { children: React.ReactNode; stageNav?: React.ReactNode; bare?: boolean }) {
  const sidebar = useApp(s => s.ui.sidebar);
  const boot = useBoot();
  const booting = useApp(s => s.booting);
  const pathname = usePathname();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // With SSR hydration `boot` is present on the very first render, so the
  // splash only appears if the server preload failed and we're still fetching.
  if (!boot && booting) return <BootSplash />;

  return (
    <div className="flex h-full w-full overflow-hidden">
      {!bare && sidebar && <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar />
        {stageNav}
        <main className={cx('relative min-h-0 flex-1 overflow-hidden', pathname === '/' && 'overflow-y-auto')}>
          {!boot ? <BootSplash /> : children}
        </main>
      </div>
      <QueuePanel />
      <UsagePanel />
      <Copilot />
    </div>
  );
}

export function BootSplash() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg">
      <div className="relative flex h-12 w-12 items-center justify-center rounded-xl border border-accent/30 bg-gradient-to-b from-accent/20 to-well2">
        <span className="absolute inset-0 animate-pulseDot rounded-xl shadow-[0_0_40px_-8px_rgba(217,154,50,.8)]" />
        <svg width="20" height="20" viewBox="0 0 32 32" fill="none" className="relative text-accent-bright">
          <rect x="6" y="7" width="20" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
          <path d="M11 7v18M21 7v18M6 13h5M6 19h5M21 13h5M21 19h5" stroke="currentColor" strokeWidth="1.1" opacity=".6" />
          <circle cx="16" cy="16" r="2.6" fill="currentColor" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-[13px] font-semibold tracking-tight text-ink">AI Film Studio</p>
        <p className="mt-1 text-[11px] text-ink3">Loading workspace…</p>
      </div>
      <div className="h-0.5 w-40 overflow-hidden rounded-full bg-card">
        <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-transparent via-accent to-transparent" />
      </div>
    </div>
  );
}
