'use client';
import * as React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2 } from 'lucide-react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/* ── Button ─────────────────────────────────────────────── */
type Variant = 'default' | 'primary' | 'ghost' | 'outline' | 'danger' | 'premium';
type Size = 'xs' | 'sm' | 'md' | 'lg';
const VAR: Record<Variant, string> = {
  default: 'btn', primary: 'btn btn-primary', ghost: 'btn btn-ghost',
  outline: 'btn btn-outline', danger: 'btn btn-danger', premium: 'btn btn-premium'
};
const SZ: Record<Size, string> = { xs: 'btn-xs', sm: 'btn-sm', md: '', lg: 'btn-lg' };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: Size; loading?: boolean; icon?: React.ReactNode; iconRight?: React.ReactNode;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'default', size = 'md', loading, icon, iconRight, className, children, disabled, ...rest }, ref
) {
  return (
    <button ref={ref} className={cx(VAR[variant], SZ[size], className)} disabled={disabled || loading} {...rest}>
      {loading ? <Loader2 size={size === 'xs' ? 11 : 13} className="animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});

/* ── Tooltip ────────────────────────────────────────────── */
/**
 * Portal tooltip with viewport-aware placement.
 *
 * Rendered into document.body with `position: fixed` so it can never be clipped
 * by an ancestor's overflow (timeline, drawers, scroll panels) and always flips
 * or clamps to stay on screen. Hidden until measured, so it never flashes in
 * the wrong place.
 */
export interface TipPos { x: number; y: number; placement: 'top' | 'bottom' | 'left' | 'right' }

export function useFloating(triggerRef: React.RefObject<HTMLElement | null>, prefer: 'top' | 'bottom' | 'left' | 'right', size: { w: number; h: number }, gap = 7): TipPos | null {
  const [pos, setPos] = React.useState<TipPos | null>(null);
  React.useLayoutEffect(() => {
    const el = triggerRef.current;
    if (!el) { setPos(null); return; }
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const fits = (p: string) =>
      p === 'top' ? r.top - size.h - gap >= 4
      : p === 'bottom' ? r.bottom + size.h + gap <= vh - 4
      : p === 'left' ? r.left - size.w - gap >= 4
      : r.right + size.w + gap <= vw - 4;
    const order = [prefer, prefer === 'top' || prefer === 'bottom' ? 'bottom' : 'right', 'top', 'left', 'right', 'bottom'];
    const placement = (order.find(fits) ?? prefer) as TipPos['placement'];
    let x = 0, y = 0;
    if (placement === 'top' || placement === 'bottom') {
      x = r.left + r.width / 2 - size.w / 2;
      y = placement === 'top' ? r.top - size.h - gap : r.bottom + gap;
    } else {
      x = placement === 'left' ? r.left - size.w - gap : r.right + gap;
      y = r.top + r.height / 2 - size.h / 2;
    }
    x = Math.max(6, Math.min(x, vw - size.w - 6));
    y = Math.max(6, Math.min(y, vh - size.h - 6));
    setPos({ x, y, placement });
  }, [prefer, size.w, size.h, gap]);
  return pos;
}

export function Tip({ label, side = 'bottom', children }: { label: React.ReactNode; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactNode }) {
  const triggerRef = React.useRef<HTMLSpanElement>(null);
  const tipRef = React.useRef<HTMLDivElement>(null);
  const [shown, setShown] = React.useState(false);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  const pos = useFloating(triggerRef, side, size);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const open = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setShown(true), 320); };
  const close = () => { if (timer.current) clearTimeout(timer.current); setShown(false); };
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  if (!label) return <>{children}</>;
  return (
    <span ref={triggerRef} className="relative inline-flex"
      onMouseEnter={open} onMouseLeave={close} onFocus={open} onBlur={close} onPointerDown={close}>
      {children}
      {shown && typeof document !== 'undefined' && createPortal(
        <div ref={tipRef}
          onTransitionEnd={() => { const r = tipRef.current?.getBoundingClientRect(); if (r && (r.width !== size.w || r.height !== size.h)) setSize({ w: r.width, h: r.height }); }}
          style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, visibility: pos && size.w ? 'visible' : 'hidden' }}
          role="tooltip"
          className="pointer-events-none fixed z-[900] max-w-[280px] rounded-md border border-line bg-pop px-2 py-1 text-[10.5px] font-medium leading-snug text-ink shadow-pop">
          {label}
        </div>,
        document.body
      )}
      {/* measure pass: rendered off-screen once so we know the size before positioning */}
      {shown && !size.w && typeof document !== 'undefined' && createPortal(
        <div ref={el => { if (el) { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); } }}
          style={{ position: 'fixed', left: -9999, top: -9999 }}
          className="pointer-events-none max-w-[280px] rounded-md px-2 py-1 text-[10.5px] font-medium leading-snug">{label}</div>,
        document.body
      )}
    </span>
  );
}
/** Tooltip with an optional secondary hint. */
export function Tooltip({ label, side = 'bottom', children, hint }: { label: string; side?: 'top' | 'bottom' | 'left' | 'right'; children: React.ReactNode; hint?: string }) {
  return <Tip label={hint ? `${label} · ${hint}` : label} side={side}>{children}</Tip>;
}

export function IconButton({ label, active, className, size = 15, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; size?: number }) {
  return (
    <Tip label={label}>
      <button className={cx('icon-btn', className)} data-on={active || undefined} aria-label={label} {...rest}>
        {children ?? <span style={{ width: size, height: size }} />}
      </button>
    </Tip>
  );
}

/* ── Badge / Chip ───────────────────────────────────────── */
export type Tone = 'default' | 'accent' | 'ok' | 'bad' | 'info' | 'mut';
const TONE: Record<Tone, string> = { default: 'badge', accent: 'badge badge-accent', ok: 'badge badge-ok', bad: 'badge badge-bad', info: 'badge badge-info', mut: 'badge badge-mut' };
export function Badge({ tone = 'default', className, children, ...rest }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cx(TONE[tone], className)} {...rest}>{children}</span>;
}
export function Chip({ active, className, children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return <button type="button" className={cx('chip', className)} data-on={active || undefined} {...rest}>{children}</button>;
}

/* ── Surfaces ───────────────────────────────────────────── */
export function Panel({ className, children, flat, ...rest }: React.HTMLAttributes<HTMLDivElement> & { flat?: boolean }) {
  return <div className={cx(flat ? 'panel-flat' : 'panel', className)} {...rest}>{children}</div>;
}
export function Card({ className, children, hover = true, glow, ...rest }: React.HTMLAttributes<HTMLDivElement> & { hover?: boolean; glow?: boolean }) {
  return <div className={cx('card', hover && 'card-hover', glow && 'shadow-glow', className)} {...rest}>{children}</div>;
}
export function Divider({ className, vertical }: { className?: string; vertical?: boolean }) {
  return <div className={cx(vertical ? 'vdivider self-stretch' : 'divider w-full', className)} />;
}
export function SectionHeader({ title, sub, right, className }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-semibold tracking-tight text-ink">{title}</h2>
        {sub && <p className="mt-0.5 truncate text-[11.5px] text-ink2">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}

/* ── Progress ───────────────────────────────────────────── */
export function Progress({ value, className, tone = 'accent', indeterminate }: { value?: number; className?: string; tone?: 'accent' | 'ok' | 'bad'; indeterminate?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value ?? 0) * 100));
  const bg = tone === 'ok' ? 'linear-gradient(90deg,#2E8F5F,#4CCB8A)' : tone === 'bad' ? 'linear-gradient(90deg,#9A3E3E,#E96A6A)' : undefined;
  return (
    <div className={cx('progress-track h-1.5 w-full', className)}>
      <div className="progress-fill" style={{ width: indeterminate ? '38%' : `${pct}%`, ...(bg ? { background: bg } : {}), animation: indeterminate ? 'shimmer 1.1s linear infinite' : undefined }} />
    </div>
  );
}
export function Ring({ value, size = 26, stroke = 2.5, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#241F1B" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="url(#ringGrad)" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(1, value)))} strokeLinecap="round" />
        <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#B87F22" /><stop offset="100%" stopColor="#F0B347" />
        </linearGradient></defs>
      </svg>
      {label && <span className="absolute text-[8.5px] font-semibold text-ink2">{label}</span>}
    </span>
  );
}

/* ── Skeleton / Empty ───────────────────────────────────── */
export function Skeleton({ className }: { className?: string }) { return <div className={cx('skeleton', className)} />; }

export function EmptyState({ icon, title, body, action, secondary, compact, className }: {
  icon?: React.ReactNode; title: string; body?: React.ReactNode; action?: React.ReactNode; secondary?: React.ReactNode; compact?: boolean; className?: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}
      className={cx('flex flex-col items-center justify-center rounded-lg border border-dashed border-line bg-well/60 text-center', compact ? 'gap-2 px-5 py-7' : 'gap-3 px-8 py-14', className)}>
      {icon && <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-line bg-gradient-to-b from-elevated to-panel text-accent shadow-card">{icon}</div>}
      <div className="max-w-md space-y-1">
        <p className="text-[13.5px] font-semibold text-ink">{title}</p>
        {body && <div className="text-[12px] leading-relaxed text-ink2">{body}</div>}
      </div>
      {(action || secondary) && <div className="mt-1 flex items-center gap-2">{action}{secondary}</div>}
    </motion.div>
  );
}

/* ── Stat ───────────────────────────────────────────────── */
export function Stat({ label, value, sub, tone, className }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; className?: string }) {
  return (
    <div className={cx('rounded-md border border-line-soft bg-well2/60 px-3 py-2', className)}>
      <div className="label">{label}</div>
      <div className={cx('mt-1 text-[17px] font-semibold tracking-tight tnum', tone === 'accent' ? 'text-accent-bright' : tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : 'text-ink')}>{value}</div>
      {sub && <div className="mt-0.5 text-[10.5px] text-ink3">{sub}</div>}
    </div>
  );
}

/* ── Segmented control ──────────────────────────────────── */
export function Segmented<T extends string>({ value, onChange, options, size = 'md', className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; title?: string }[]; size?: 'sm' | 'md'; className?: string;
}) {
  return (
    <div className={cx('inline-flex items-center gap-0.5 rounded-md border border-line bg-well p-0.5', className)}>
      {options.map(o => (
        <button key={o.value} type="button" title={o.title} onClick={() => onChange(o.value)}
          className={cx('relative rounded-[5px] font-medium transition-colors',
            size === 'sm' ? 'h-[22px] px-2 text-[10.5px]' : 'h-[26px] px-2.5 text-[11.5px]',
            value === o.value ? 'text-accent-on' : 'text-ink2 hover:text-ink')}>
          {value === o.value && <motion.span layoutId={`seg-${options.map(x => x.value).join('')}`} className="absolute inset-0 rounded-[5px]"
            style={{ background: 'linear-gradient(180deg,#F0B347,#D99A32)', boxShadow: '0 1px 0 rgba(255,255,255,.4) inset' }} transition={{ type: 'spring', stiffness: 520, damping: 38 }} />}
          <span className="relative z-10 flex items-center gap-1">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Tabs ───────────────────────────────────────────────── */
export function Tabs<T extends string>({ value, onChange, tabs, className }: {
  value: T; onChange: (v: T) => void; tabs: { value: T; label: React.ReactNode; badge?: React.ReactNode }[]; className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-line-soft', className)}>
      {tabs.map(t => (
        <button key={t.value} type="button" onClick={() => onChange(t.value)} data-on={value === t.value}
          className="tab-underline -mb-px flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium text-ink3 transition-colors hover:text-ink2 data-[on=true]:text-ink">
          {t.label}{t.badge}
        </button>
      ))}
    </div>
  );
}

/* ── Status dot ─────────────────────────────────────────── */
export function Dot({ tone = 'mut', pulse, className }: { tone?: 'ok' | 'bad' | 'accent' | 'info' | 'mut'; pulse?: boolean; className?: string }) {
  const c = { ok: '#4CCB8A', bad: '#E96A6A', accent: '#D99A32', info: '#63A9E9', mut: '#625D55' }[tone];
  return <span className={cx('inline-block h-1.5 w-1.5 shrink-0 rounded-full', pulse && 'animate-pulseDot', className)} style={{ background: c, boxShadow: `0 0 8px ${c}66` }} />;
}

/* ── Kbd ────────────────────────────────────────────────── */
export function Kbd({ children }: { children: React.ReactNode }) { return <kbd className="kbd">{children}</kbd>; }

/* ── Meter (audio level) ────────────────────────────────── */
export function Meter({ value, vertical, className }: { value: number; vertical?: boolean; className?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className={cx('overflow-hidden rounded-sm bg-deep', vertical ? 'w-1.5' : 'h-1.5 w-full', className)}>
      <div className={cx('transition-[width,height] duration-75', vertical ? 'w-full' : 'h-full')}
        style={{
          height: vertical ? `${pct * 100}%` : undefined, width: vertical ? undefined : `${pct * 100}%`,
          background: pct > 0.92 ? 'linear-gradient(90deg,#D99A32,#E96A6A)' : 'linear-gradient(90deg,#3F8F5F,#4CCB8A)',
          marginTop: vertical ? 'auto' : undefined
        }} />
    </div>
  );
}

/* ── Collapsible section ────────────────────────────────── */
export function Collapsible({ title, children, defaultOpen = true, right, className }: {
  title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean; right?: React.ReactNode; className?: string;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <div className={cx('border-b border-line-soft last:border-0', className)}>
      <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.02]">
        <span className="label-2 flex items-center gap-2">
          <svg width="9" height="9" viewBox="0 0 24 24" className={cx('text-ink3 transition-transform duration-200', open && 'rotate-90')} fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="m9 6 6 6-6 6" /></svg>
          {title}
        </span>
        {right}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 0.61, 0.36, 1] }} className="overflow-hidden">
            <div className="px-3 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ── TextInput / TextArea ──────────────────────────────────── */
export function NativeTextInput({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement> & { className?: string }) {
  return <input className={cx('input', className)} {...rest} />;
}

export function NativeTextArea({ className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { className?: string }) {
  return <textarea className={cx('input', className)} {...rest} />;
}

/* ── Select ───────────────────────────────────────────────── */
export function NativeSelect({ className, children, placeholder, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement> & { className?: string; placeholder?: string }) {
  return (
    <select className={cx('input', className)} {...rest}>
      {placeholder && <option value="" disabled hidden>{placeholder}</option>}
      {children}
    </select>
  );
}

/* ── Provenance badge ─────────────────────────────────────── */
/**
 * Marks media that came from the built-in Studio Engine rather than an external
 * model. Rendered as "PREVIS" — the real production term for previsualisation
 * plates — so provenance stays honest without labelling the product a demo.
 */
export function PrevisBadge({ label = 'PREVIS', className }: { label?: string; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-1.5 py-[1px] text-[9px] font-bold tracking-[0.1em] text-accent-bright', className)}>
      <span className="h-1 w-1 rounded-full bg-accent" />{label}
    </span>
  );
}
