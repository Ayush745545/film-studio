'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Info, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { cx, Button } from './primitives';
import { useApp, type Toast } from '@/store/app';

/* ── Modal ──────────────────────────────────────────────── */
export function Modal({ open, onClose, title, sub, children, footer, width = 560, className, icon }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; sub?: React.ReactNode;
  children?: React.ReactNode; footer?: React.ReactNode; width?: number; className?: string; icon?: React.ReactNode;
}) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    document.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', h); document.body.style.overflow = prev; };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto p-4 sm:p-8"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14 }}>
          <div className="modal-backdrop fixed inset-0" onClick={onClose} />
          <motion.div role="dialog" aria-modal="true"
            className={cx('relative z-10 my-auto w-full overflow-hidden rounded-xl border border-line bg-panel-grad shadow-pop', className)}
            style={{ maxWidth: width }}
            initial={{ opacity: 0, y: 12, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.99 }}
            transition={{ duration: 0.19, ease: [0.22, 0.61, 0.36, 1] }}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-vignette" />
            {(title || icon) && (
              <div className="relative flex items-start gap-3 border-b border-line-soft px-5 py-3.5">
                {icon && <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/10 text-accent-bright">{icon}</span>}
                <div className="min-w-0 flex-1">
                  <h2 className="text-[14px] font-semibold tracking-tight text-ink">{title}</h2>
                  {sub && <p className="mt-0.5 text-[11.5px] leading-snug text-ink2">{sub}</p>}
                </div>
                <button type="button" onClick={onClose} className="icon-btn -mr-1 -mt-1 shrink-0" aria-label="Close"><X size={15} /></button>
              </div>
            )}
            <div className="scroll-thin relative max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
            {footer && <div className="flex items-center justify-end gap-2 border-t border-line-soft bg-well2 px-5 py-3">{footer}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ── Drawer (right side panel) ──────────────────────────── */
export function Drawer({ open, onClose, title, sub, children, footer, width = 380, side = 'right' }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; sub?: React.ReactNode;
  children?: React.ReactNode; footer?: React.ReactNode; width?: number; side?: 'right' | 'left';
}) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[180] bg-black/45 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.aside className={cx('fixed top-0 z-[181] flex h-full flex-col border-line bg-panel-grad shadow-pop',
            side === 'right' ? 'right-0 border-l' : 'left-0 border-r')}
            style={{ width }}
            initial={{ x: side === 'right' ? width : -width }} animate={{ x: 0 }} exit={{ x: side === 'right' ? width : -width }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}>
            <header className="flex items-start gap-2 border-b border-line-soft px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-[13px] font-semibold text-ink">{title}</h2>
                {sub && <p className="mt-0.5 truncate text-[11px] text-ink2">{sub}</p>}
              </div>
              <button type="button" onClick={onClose} className="icon-btn shrink-0" aria-label="Close"><X size={15} /></button>
            </header>
            <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
            {footer && <div className="border-t border-line-soft bg-well2 px-4 py-3">{footer}</div>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── Confirm ────────────────────────────────────────────── */
export interface ConfirmSpec {
  title: string; body?: React.ReactNode; confirmLabel?: string; cancelLabel?: string;
  tone?: 'default' | 'danger' | 'premium'; credits?: number; details?: { label: string; value: React.ReactNode }[];
  requireText?: string;
}
export function ConfirmDialog({ spec, open, onCancel, onConfirm }: { spec: ConfirmSpec | null; open: boolean; onCancel: () => void; onConfirm: () => void }) {
  const [typed, setTyped] = React.useState('');
  React.useEffect(() => { if (open) setTyped(''); }, [open]);
  const blocked = Boolean(spec?.requireText) && typed !== spec?.requireText;
  return (
    <Modal open={open} onClose={onCancel} width={460} icon={spec?.tone === 'danger' ? <AlertTriangle size={14} /> : <Sparkles size={14} />}
      title={spec?.title ?? 'Are you sure?'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>{spec?.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={spec?.tone === 'danger' ? 'danger' : 'primary'} disabled={blocked} onClick={onConfirm}>
            {spec?.confirmLabel ?? 'Confirm'}
          </Button>
        </>
      }>
      {spec?.body && <div className="text-[12.5px] leading-relaxed text-ink2">{spec.body}</div>}
      {spec?.details?.length ? (
        <div className="mt-3 overflow-hidden rounded-md border border-line-soft">
          {spec.details.map((d, i) => (
            <div key={i} className={cx('flex items-center justify-between gap-4 px-3 py-2 text-[11.5px]', i % 2 ? 'bg-white/[0.015]' : '')}>
              <span className="text-ink3">{d.label}</span><span className="text-right font-medium text-ink">{d.value}</span>
            </div>
          ))}
        </div>
      ) : null}
      {typeof spec?.credits === 'number' && (
        <div className={cx('mt-3 flex items-center gap-2.5 rounded-md border px-3 py-2.5',
          spec.credits > 0 ? 'border-accent/30 bg-accent/[0.07]' : 'border-line-soft bg-well2')}>
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/30 bg-accent/10 text-[10px] font-bold text-accent-bright">✦</span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold text-ink">
              {spec.credits > 0 ? <>This will use approximately <span className="text-accent-bright tnum">{spec.credits}</span> credits</> : 'This will not use any credits'}
            </p>
            <p className="mt-0.5 text-[10.5px] text-ink2">{spec.credits > 0 ? 'Credits are only charged when a generation succeeds. Failures are refunded automatically.' : 'Built-in Studio Engine output is marked PREVIS and costs nothing.'}</p>
          </div>
        </div>
      )}
      {spec?.requireText && (
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] text-ink2">Type <code className="mono rounded bg-well px-1 py-0.5 text-bad">{spec.requireText}</code> to confirm</p>
          <input className="input" value={typed} onChange={e => setTyped(e.target.value)} placeholder={spec.requireText} autoFocus />
        </div>
      )}
    </Modal>
  );
}

export function useConfirm() {
  const [spec, setSpec] = React.useState<ConfirmSpec | null>(null);
  const resolver = React.useRef<((v: boolean) => void) | null>(null);
  const confirm = React.useCallback((s: ConfirmSpec) => new Promise<boolean>(res => { resolver.current = res; setSpec(s); }), []);
  const close = (v: boolean) => { resolver.current?.(v); resolver.current = null; setSpec(null); };
  const node = <ConfirmDialog spec={spec} open={Boolean(spec)} onCancel={() => close(false)} onConfirm={() => close(true)} />;
  return { confirm, node };
}

/* ── Toaster ────────────────────────────────────────────── */
const ICONS = { info: Info, success: CheckCircle2, error: XCircle, warn: AlertTriangle };
const TONES = {
  info: 'border-info/30 bg-info/12', success: 'border-ok/30 bg-ok/12',
  error: 'border-bad/35 bg-bad/12', warn: 'border-accent/35 bg-accent/10'
};
export function Toaster() {
  const toasts = useApp(s => s.toasts);
  const dismiss = useApp(s => s.dismiss);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[300] flex w-[340px] flex-col gap-2">
      <AnimatePresence initial={false}>
        {toasts.map((t: Toast) => {
          const Icon = ICONS[t.level];
          return (
            <motion.div key={t.id} layout initial={{ opacity: 0, x: 40, scale: 0.97 }} animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 30, scale: 0.97 }} transition={{ duration: 0.19, ease: [0.22, 0.61, 0.36, 1] }}
              className={cx('pointer-events-auto overflow-hidden rounded-lg border shadow-pop backdrop-blur-sm', TONES[t.level])}>
              <div className="flex items-start gap-2.5 px-3 py-2.5">
                <Icon size={14} className={cx('mt-[1px] shrink-0',
                  t.level === 'success' ? 'text-ok' : t.level === 'error' ? 'text-bad' : t.level === 'warn' ? 'text-accent-bright' : 'text-info')} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-semibold leading-snug text-ink">{t.title}</p>
                  {t.body && <p className="mt-0.5 text-[11px] leading-relaxed text-ink2">{t.body}</p>}
                  {t.action && (
                    <button type="button" onClick={() => { t.action?.run(); dismiss(t.id); }} className="mt-1.5 text-[11px] font-semibold text-accent-bright hover:underline">
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="icon-btn -mr-1 -mt-0.5 h-6 w-6 shrink-0" aria-label="Dismiss"><X size={12} /></button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

/* ── Popover ────────────────────────────────────────────── */
/**
 * Portal popover with viewport-aware placement.
 *
 * Same reasoning as `Tip`: anchored with `position: fixed` inside
 * document.body, so a menu opened near the bottom or right edge flips or
 * clamps instead of being clipped by an `overflow: hidden` ancestor.
 */
export function Popover({ trigger, children, align = 'right', width = 280, className }: {
  trigger: (p: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode; align?: 'left' | 'right'; width?: number; className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);

  const place = React.useCallback(() => {
    const a = anchorRef.current; const panel = panelRef.current;
    if (!a) return;
    const r = a.getBoundingClientRect();
    const h = panel?.offsetHeight ?? 200;
    const vw = window.innerWidth, vh = window.innerHeight;
    const gap = 6;
    let x = align === 'right' ? r.right - width : r.left;
    x = Math.max(8, Math.min(x, vw - width - 8));
    // flip above the trigger when there is no room below
    let y = r.bottom + gap;
    if (y + h > vh - 8 && r.top - gap - h >= 8) y = r.top - gap - h;
    y = Math.max(8, Math.min(y, vh - h - 8));
    setPos({ x, y });
  }, [align, width]);

  React.useEffect(() => {
    if (!open) { setPos(null); return; }
    place();
    const onScroll = () => place();
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current?.contains(e.target as Node)) return;
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, place]);

  // re-measure once content has rendered (heights are unknown before first paint)
  React.useLayoutEffect(() => { if (open) place(); }, [open, place]);

  return (
    <div ref={anchorRef} className={cx('relative', className)}>
      {trigger({ open, toggle: () => setOpen(o => !o) })}
      <AnimatePresence>
        {open && typeof document !== 'undefined' && createPortal(
          <motion.div ref={panelRef}
            initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.13 }}
            style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, width, visibility: pos ? 'visible' : 'hidden' }}
            className="fixed z-[500] overflow-hidden rounded-lg border border-line bg-pop p-1 shadow-pop">
            {children(() => setOpen(false))}
          </motion.div>,
          document.body
        )}
      </AnimatePresence>
    </div>
  );
}

export function MenuItem({ icon, label, hint, onClick, tone, disabled }: {
  icon?: React.ReactNode; label: React.ReactNode; hint?: string; onClick?: () => void; tone?: 'danger'; disabled?: boolean;
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-[12px] transition-colors disabled:opacity-40',
        tone === 'danger' ? 'text-bad hover:bg-bad/10' : 'text-ink2 hover:bg-white/[0.05] hover:text-ink')}>
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] text-ink3">{hint}</span>}
    </button>
  );
}
