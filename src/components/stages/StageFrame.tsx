'use client';
import * as React from 'react';
import { cx } from '@/components/ui/primitives';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * Stage shell.
 *
 * Every production stage has the same anatomy so the user always knows where
 * they are: context header → working area + inspector → review/next footer.
 */
export function StageFrame({ title, subtitle, icon, headerRight, aside, asideTitle, footer, children, className, asideWidth = 320 }: {
  title: React.ReactNode; subtitle?: React.ReactNode; icon?: React.ReactNode;
  headerRight?: React.ReactNode; aside?: React.ReactNode; asideTitle?: React.ReactNode;
  footer?: React.ReactNode; children: React.ReactNode; className?: string; asideWidth?: number;
}) {
  /**
   * Below the xl breakpoint the inspector would simply vanish, which hides real
   * controls. Instead it collapses to an overlay drawer with a toggle in the
   * header, so every stage stays fully usable at 1024px and 768px.
   */
  const [asideOpen, setAsideOpen] = React.useState(false);
  return (
    <motion.section initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}
      className={cx('relative flex h-full min-h-0 flex-col overflow-hidden bg-bg', className)}>
      <header className="sheen relative flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-panel-grad px-4 py-3">
        {icon && (
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/25 text-accent-bright shadow-[0_0_22px_-8px_rgba(217,154,50,.85)]"
            style={{ background: 'linear-gradient(180deg, rgba(217,154,50,0.16), rgba(217,154,50,0.04))' }}>
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 truncate text-[11.5px] text-ink2">{subtitle}</p>}
        </div>
        {headerRight && <div className="flex shrink-0 flex-wrap items-center gap-2">{headerRight}</div>}
        {aside && (
          <button type="button" onClick={() => setAsideOpen(v => !v)} data-on={asideOpen}
            className="icon-btn shrink-0 xl:hidden" aria-label="Toggle inspector">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" />
            </svg>
          </button>
        )}
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="scroll-thin min-w-0 flex-1 overflow-y-auto">{children}</div>
        {aside && (
          <>
            <aside className="hidden shrink-0 flex-col overflow-hidden border-l border-line bg-panel xl:flex" style={{ width: asideWidth }}>
              {asideTitle && <div className="shrink-0 border-b border-line-soft px-3 py-2.5 text-[11.5px] font-semibold text-ink">{asideTitle}</div>}
              <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{aside}</div>
            </aside>
            {/* narrow windows: the same inspector as an overlay drawer */}
            <AnimatePresence>
              {asideOpen && (
                <>
                  <motion.div className="absolute inset-0 z-30 bg-black/50 backdrop-blur-[2px] xl:hidden"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAsideOpen(false)} />
                  <motion.aside className="absolute bottom-0 right-0 top-0 z-40 flex w-[min(340px,88vw)] flex-col overflow-hidden border-l border-line bg-panel-grad shadow-pop xl:hidden"
                    initial={{ x: 360 }} animate={{ x: 0 }} exit={{ x: 360 }} transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
                    <div className="flex shrink-0 items-center gap-2 border-b border-line-soft px-3 py-2.5">
                      <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-ink">{asideTitle ?? 'Inspector'}</span>
                      <button type="button" className="icon-btn" onClick={() => setAsideOpen(false)} aria-label="Close inspector">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    </div>
                    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">{aside}</div>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>
          </>
        )}
      </div>

      {footer && <footer className="shrink-0 border-t border-line bg-panel-grad px-4 py-2.5">{footer}</footer>}
    </motion.section>
  );
}

/** Compact two-column field row used across inspectors. */
export function MetaRow({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line-soft/60 py-1.5 last:border-0">
      <span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-ink3">{label}</span>
      <span className={cx('min-w-0 flex-1 text-right text-[11.5px] text-ink2', mono && 'mono text-[10.5px]')}>{children}</span>
    </div>
  );
}

export function StageNote({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'ok'; title: string; children?: React.ReactNode }) {
  const cls = tone === 'warn' ? 'border-accent/25 bg-accent/[0.06]' : tone === 'ok' ? 'border-ok/25 bg-ok/[0.06]' : 'border-line-soft bg-well2';
  return (
    <div className={cx('rounded-lg border px-3 py-2.5', cls)}>
      <p className={cx('text-[11.5px] font-semibold', tone === 'warn' ? 'text-accent-bright' : tone === 'ok' ? 'text-ok' : 'text-ink')}>{title}</p>
      {children && <div className="mt-1 text-[11px] leading-relaxed text-ink2">{children}</div>}
    </div>
  );
}
