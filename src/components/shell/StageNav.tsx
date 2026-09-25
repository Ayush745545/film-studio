'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Check, Loader2, AlertTriangle, Circle, ArrowRight, Compass } from 'lucide-react';
import { STAGES, STAGE_META, type StageId, type StageState } from '@/types';
import { cx, Tip, Badge } from '@/components/ui/primitives';
import { useProject } from '@/store/project';

const STATE_STYLE: Record<StageState, { icon: React.ReactNode; cls: string; label: string }> = {
  empty:      { icon: <Circle size={7} className="text-ink3" />, cls: 'text-ink3', label: 'Not started' },
  pending:    { icon: <Circle size={7} className="text-ink3" />, cls: 'text-ink3', label: 'Pending' },
  generating: { icon: <Loader2 size={11} className="animate-spin text-accent-bright" />, cls: 'text-accent-bright', label: 'Generating' },
  ready:      { icon: <Check size={11} className="text-ok" />, cls: 'text-ink2', label: 'Ready for review' },
  approved:   { icon: <Check size={11} className="text-ok" />, cls: 'text-ink', label: 'Approved' },
  error:      { icon: <AlertTriangle size={11} className="text-bad" />, cls: 'text-bad', label: 'Needs attention' }
};

/**
 * Production stage rail.
 *
 * The whole pipeline at a glance: where you are, what is done, what is
 * generating, and what failed. Every stage is clickable so work is never
 * trapped behind a linear wizard — generated state is always preserved.
 */
export function StageNav() {
  const stage = useProject(s => s.stage);
  const states = useProject(s => s.project?.stageStates) as Partial<Record<StageId, StageState>> | undefined;
  const setStage = useProject(s => s.setStage);
  const counts = useProject(s => s.counts);
  const [overflow, setOverflow] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = ref.current; if (!el) return;
    const check = () => setOverflow(el.scrollWidth > el.clientWidth + 4);
    check();
    const ro = new ResizeObserver(check); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const activeIndex = STAGES.indexOf(stage);
  const groups = React.useMemo(() => {
    const out: { name: string; stages: StageId[] }[] = [];
    for (const s of STAGES) {
      const g = STAGE_META[s].group;
      const last = out[out.length - 1];
      if (last && last.name === g) last.stages.push(s);
      else out.push({ name: g, stages: [s] });
    }
    return out;
  }, []);

  const completed = STAGES.filter(s => { const st = states?.[s]; return st === 'ready' || st === 'approved'; }).length;

  const countFor = (s: StageId): string | null => {
    if (!counts) return null;
    const map: Partial<Record<StageId, number>> = {
      characters: counts.characters, world: counts.locations, scenes: counts.scenes,
      shots: counts.shots, storyboard: counts.frames, video: counts.videos,
      voice: counts.voices, sound: counts.sounds, export: counts.exports
    };
    const n = map[s];
    return n ? String(n) : null;
  };

  return (
    <div className="relative z-20 shrink-0 border-b border-line bg-well">
      <div ref={ref} className="scroll-thin flex items-stretch gap-0 overflow-x-auto no-scrollbar">
        {groups.map((g, gi) => (
          <React.Fragment key={g.name}>
            {gi > 0 && <div className="mx-1 my-2 w-px shrink-0 bg-line-soft" />}
            <div className="flex shrink-0 items-stretch">
              <div className="flex items-center px-2">
                <span className="label whitespace-nowrap text-[9px] text-ink3/70">{g.name}</span>
              </div>
              {g.stages.map(s => {
                const st = (states?.[s] ?? 'empty') as StageState;
                const meta = STATE_STYLE[st] ?? STATE_STYLE.empty;
                const active = s === stage;
                const done = st === 'approved' || st === 'ready';
                const idx = STAGES.indexOf(s);
                const n = countFor(s);
                return (
                  <Tip key={s} label={`${STAGE_META[s].label} — ${meta.label}`} side="bottom">
                    <button type="button" onClick={() => setStage(s)}
                      className={cx('relative flex h-[38px] shrink-0 items-center gap-1.5 border-r border-line-soft/60 px-2.5 text-[11.5px] transition-colors',
                        active ? 'text-ink' : done ? 'text-ink2 hover:text-ink' : 'text-ink3 hover:text-ink2')}
                      aria-current={active ? 'step' : undefined}>
                      {active && (
                        <motion.span layoutId="stage-active" className="absolute inset-0 bg-stage-active"
                          transition={{ type: 'spring', stiffness: 520, damping: 42 }} />
                      )}
                      <span className="relative z-10 flex items-center">{meta.icon}</span>
                      <span className={cx('relative z-10 whitespace-nowrap font-medium', active && 'text-ink', meta.cls)}>{STAGE_META[s].short}</span>
                      {n && <span className="relative z-10 rounded bg-white/[0.06] px-1 text-[9px] font-bold text-ink3 tnum">{n}</span>}
                      {active && <motion.span layoutId="stage-underline" className="absolute inset-x-0 bottom-0 z-10 h-[2px]"
                        style={{ background: 'linear-gradient(90deg,#B87F22,#F0B347)', boxShadow: '0 0 10px rgba(217,154,50,.6)' }} />}
                      <span className="sr-only">Stage {idx + 1} of {STAGES.length}</span>
                    </button>
                  </Tip>
                );
              })}
            </div>
          </React.Fragment>
        ))}
        <div className="flex-1" />
      </div>

      {/* context strip: where am I / what's next */}
      <div className="flex items-center gap-2 border-t border-line-soft bg-deep px-3 py-1.5 text-[10.5px]">
        <Compass size={11} className="shrink-0 text-accent/70" />
        <span className="shrink-0 font-medium text-ink2">{STAGE_META[stage].label}</span>
        <span className="hidden truncate text-ink3 md:inline">{STAGE_META[stage].blurb}</span>
        <div className="flex-1" />
        <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
          <span className="h-1 w-16 overflow-hidden rounded-full bg-card">
            <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright transition-[width] duration-500 ease-cine"
              style={{ width: `${(completed / STAGES.length) * 100}%` }} />
          </span>
          <span className="tnum text-ink3">{completed}/{STAGES.length} complete</span>
        </span>
        {overflow && <Badge tone="mut" className="hidden lg:inline-flex">Scroll the stage rail →</Badge>}
        {activeIndex < STAGES.length - 1 && (
          <button type="button" onClick={() => setStage(STAGES[activeIndex + 1])}
            className="flex shrink-0 items-center gap-1 rounded border border-line bg-pop px-2 py-0.5 text-[10.5px] text-ink2 transition-colors hover:border-accent/30 hover:text-accent-bright">
            Next: {STAGE_META[STAGES[activeIndex + 1]].label}<ArrowRight size={10} />
          </button>
        )}
      </div>
    </div>
  );
}
