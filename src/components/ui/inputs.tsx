'use client';
import * as React from 'react';
import { X, ChevronDown, Plus } from 'lucide-react';
import { cx, Tip } from './primitives';

/* ── Field wrapper ──────────────────────────────────────── */
export function Field({ label, hint, children, className, required, right }: {
  label?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string; required?: boolean; right?: React.ReactNode;
}) {
  return (
    <label className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 flex items-center justify-between gap-2">
          <span className="field-label mb-0">{label}{required && <span className="ml-1 text-accent">*</span>}</span>
          {right}
        </span>
      )}
      {children}
      {hint && <span className="mt-1.5 block text-[10.5px] leading-snug text-ink3">{hint}</span>}
    </label>
  );
}

/* ── Text ───────────────────────────────────────────────── */
export const TextInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return <input ref={ref} className={cx('input', invalid && 'border-bad/60 focus:border-bad', className)} {...rest} />;
  }
);

export const TextArea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function TextArea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('textarea', className)} {...rest} />;
  }
);

/* ── Select ─────────────────────────────────────────────── */
export interface Option { value: string; label: string; group?: string; disabled?: boolean; hint?: string }
export function Select({ value, onChange, options, className, placeholder, size, disabled }: {
  value: string; onChange: (v: string) => void; options: Option[] | readonly string[]; className?: string; placeholder?: string; size?: 'sm' | 'md'; disabled?: boolean;
}) {
  const opts: Option[] = options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
  const groups = [...new Set(opts.map(o => o.group).filter(Boolean))] as string[];
  return (
    <div className={cx('relative', className)}>
      <select className={cx('select', size === 'sm' && 'h-[28px] text-[11.5px]')} value={value} disabled={disabled}
        onChange={e => onChange(e.target.value)}>
        {placeholder && <option value="">{placeholder}</option>}
        {groups.length === 0 && opts.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
        {groups.map(g => (
          <optgroup key={g} label={g}>
            {opts.filter(o => o.group === g).map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          </optgroup>
        ))}
        {!groups.length && !opts.length && <option value="">No options</option>}
      </select>
    </div>
  );
}

/** Custom dropdown with rich rows (models, presets) — keyboard accessible. */
export function Dropdown<T extends string>({ value, onChange, items, className, width = 260, placeholder, renderItem }: {
  value: T | ''; onChange: (v: T) => void; items: { value: T; label: string; sub?: string; badge?: React.ReactNode; disabled?: boolean; group?: string }[];
  className?: string; width?: number; placeholder?: string; renderItem?: (i: typeof items[number]) => React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const ref = React.useRef<HTMLDivElement>(null);
  const current = items.find(i => i.value === value);
  React.useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', h); document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, []);
  const filtered = q ? items.filter(i => `${i.label} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase())) : items;
  const row = (i: { value: T; label: string; sub?: string; badge?: React.ReactNode; disabled?: boolean; group?: string }) => (
    <button key={i.value} type="button" disabled={i.disabled}
      onClick={() => { onChange(i.value); setOpen(false); setQ(''); }}
      className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
        i.value === value ? 'bg-accent/12 text-ink' : 'text-ink2 hover:bg-white/[0.045] hover:text-ink',
        i.disabled && 'cursor-not-allowed opacity-40')}>
      {renderItem ? renderItem(i) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{i.label}</span>
            {i.sub && <span className="block truncate text-[10.5px] text-ink3">{i.sub}</span>}
          </span>
          {i.badge}
        </>
      )}
    </button>
  );
  const groups = [...new Set(filtered.map(i => i.group).filter(Boolean))] as string[];

  return (
    <div ref={ref} className={cx('relative', className)}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={cx('select flex w-full items-center justify-between gap-2 text-left', !current && 'text-ink3')}>
        <span className="min-w-0 flex-1 truncate text-ink">{current?.label ?? placeholder ?? 'Select…'}</span>
        <ChevronDown size={13} className="shrink-0 text-ink3" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 overflow-hidden rounded-lg border border-line bg-pop shadow-pop animate-floatUp" style={{ width }}>
          {items.length > 8 && (
            <div className="border-b border-line-soft p-1.5">
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Filter…" className="input h-[28px] text-[11.5px]" />
            </div>
          )}
          <div className="scroll-thin max-h-72 overflow-y-auto p-1">
            {(groups.length ? groups.map(g => (
              <div key={g}>
                <div className="label px-2 pb-1 pt-2">{g}</div>
                {filtered.filter(i => i.group === g).map(row)}
              </div>
            )) : filtered.map(row)) as React.ReactNode}
            {!filtered.length && <div className="px-3 py-4 text-center text-[11.5px] text-ink3">No matches</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Slider ─────────────────────────────────────────────── */
export function Slider({ value, onChange, min = 0, max = 100, step = 1, label, unit, bipolar, onCommit, className, disabled, format }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number;
  label?: string; unit?: string; bipolar?: boolean; onCommit?: (v: number) => void; className?: string; disabled?: boolean;
  format?: (v: number) => string;
}) {
  const pct = ((value - min) / Math.max(1e-9, max - min)) * 100;
  const zeroPct = bipolar ? ((0 - min) / (max - min)) * 100 : 0;
  const text = format ? format(value) : `${Math.round(value * 100) / 100}${unit ?? ''}`;
  return (
    <div className={cx('select-none', className)}>
      {label && (
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="truncate text-[11px] text-ink2">{label}</span>
          <input type="number" value={Math.round(value * 1000) / 1000} min={min} max={max} step={step} disabled={disabled}
            onChange={e => onChange(Math.max(min, Math.min(max, Number(e.target.value))))}
            onBlur={() => onCommit?.(value)}
            className="inset w-14 rounded px-1 py-0 text-right text-[10.5px] text-ink tnum focus:outline-none focus:ring-1 focus:ring-accent/40" />
        </div>
      )}
      <div className="relative h-[18px]">
        {bipolar && <span className="pointer-events-none absolute left-0 right-0 top-[7.5px] h-px bg-line" />}
        {bipolar && <span className="pointer-events-none absolute top-[3px] h-3 w-px bg-line" style={{ left: `${zeroPct}%` }} />}
        <input type="range" className="rng absolute inset-0 w-full" min={min} max={max} step={step} value={value} disabled={disabled}
          style={{ ['--pct' as never]: `${pct}%` }}
          onChange={e => onChange(Number(e.target.value))}
          onMouseUp={() => onCommit?.(value)} onTouchEnd={() => onCommit?.(value)}
          onDoubleClick={() => { onChange(bipolar ? 0 : min); onCommit?.(bipolar ? 0 : min); }} />
      </div>
      {!label && <span className="sr-only">{text}</span>}
    </div>
  );
}

/* ── Toggle ─────────────────────────────────────────────── */
export function Toggle({ checked, onChange, label, hint, disabled, className }: {
  checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; hint?: string; disabled?: boolean; className?: string;
}) {
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('group flex w-full items-center justify-between gap-3 text-left', disabled && 'cursor-not-allowed opacity-50', className)}>
      {label && (
        <span className="min-w-0">
          <span className="block truncate text-[12px] text-ink2 group-hover:text-ink">{label}</span>
          {hint && <span className="mt-0.5 block text-[10.5px] leading-snug text-ink3">{hint}</span>}
        </span>
      )}
      <span className={cx('relative h-[18px] w-[32px] shrink-0 rounded-full border transition-colors duration-150',
        checked ? 'border-accent/60 bg-accent/25' : 'border-line bg-well')}>
        <span className={cx('absolute top-[2px] h-[12px] w-[12px] rounded-full transition-all duration-150',
          checked ? 'left-[16px] bg-accent-bright shadow-[0_0_8px_rgba(240,179,71,.6)]' : 'left-[2px] bg-ink3')} />
      </span>
    </button>
  );
}

/* ── Tag input ──────────────────────────────────────────── */
export function TagInput({ tags, onChange, placeholder = 'Add and press Enter', max = 24 }: {
  tags: string[]; onChange: (t: string[]) => void; placeholder?: string; max?: number;
}) {
  const [v, setV] = React.useState('');
  const add = () => {
    const t = v.trim();
    if (!t || tags.includes(t) || tags.length >= max) { setV(''); return; }
    onChange([...tags, t]); setV('');
  };
  return (
    <div className="inset flex min-h-[34px] flex-wrap items-center gap-1.5 p-1.5">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-1 rounded border border-line bg-card px-1.5 py-0.5 text-[10.5px] text-ink2">
          {t}
          <button type="button" onClick={() => onChange(tags.filter(x => x !== t))} className="text-ink3 hover:text-bad"><X size={10} /></button>
        </span>
      ))}
      <input value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); } if (e.key === 'Backspace' && !v && tags.length) onChange(tags.slice(0, -1)); }}
        onBlur={add} placeholder={tags.length ? '' : placeholder} className="min-w-[80px] flex-1 bg-transparent px-1 text-[11.5px] text-ink outline-none placeholder:text-ink3" />
    </div>
  );
}

/* ── Colour swatch input ────────────────────────────────── */
export function ColorInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="relative h-[26px] w-[34px] shrink-0 cursor-pointer overflow-hidden rounded border border-line bg-well">
        <span className="absolute inset-[3px] rounded-[3px]" style={{ background: value }} />
        <input type="color" value={value} onChange={e => onChange(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" />
      </label>
      <span className="mono truncate text-[10.5px] uppercase text-ink3">{value}</span>
      {label && <span className="text-[10.5px] text-ink3">{label}</span>}
    </div>
  );
}

/* ── Add button (icon + label) ──────────────────────────── */
export function AddButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('btn btn-xs gap-1', className)}>
      <Plus size={11} />{label}
    </button>
  );
}

/* ── Copy field ─────────────────────────────────────────── */
export function CopyField({ value, label, className }: { value: string; label?: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  return (
    <div className={cx('flex items-center gap-2', className)}>
      {label && <span className="field-label mb-0 shrink-0">{label}</span>}
      <code className="inset mono min-w-0 flex-1 truncate px-2 py-1.5 text-[11px] text-ink2">{value}</code>
      <Tip label={done ? 'Copied' : 'Copy'}>
        <button type="button" className="icon-btn" onClick={() => { void navigator.clipboard?.writeText(value); setDone(true); setTimeout(() => setDone(false), 1400); }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
        </button>
      </Tip>
    </div>
  );
}
