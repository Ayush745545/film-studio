'use client';
import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Pause, Play, RotateCcw, Ban, ArrowUp, ChevronDown, ChevronRight, FileText, Terminal, Wand2 } from 'lucide-react';
import { cx, Badge, Dot, Progress, EmptyState, Tip } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/overlays';
import { useApp, jobAction, useBoot } from '@/store/app';
import { describeError } from '@/lib/client/api';
import type { GenerationJob } from '@/types';

/**
 * Global generation queue.
 *
 * Every AI operation in the app becomes a job here — visible, cancellable,
 * retryable, with real progress from the worker and the provider's own error
 * translated into something actionable.
 */
export function QueuePanel() {
  const open = useApp(s => s.ui.queue);
  const setUi = useApp(s => s.setUi);
  const jobs = useApp(s => s.jobs);
  const toast = useApp(s => s.toast);
  const boot = useBoot();
  const [tab, setTab] = React.useState<'active' | 'done' | 'failed'>('active');
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [recent, setRecent] = React.useState<GenerationJob[]>([]);

  React.useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch('/api/jobs').then(x => x.json());
        if (alive && r.ok) setRecent(r.data.recent ?? []);
      } catch { /* offline */ }
    };
    void load();
    const i = setInterval(load, 8000);
    return () => { alive = false; clearInterval(i); };
  }, [open, jobs.length]);

  const active = jobs.filter(j => ['queued', 'running', 'paused', 'review'].includes(j.status));
  const failed = [...jobs.filter(j => j.status === 'failed'), ...recent.filter(j => j.status === 'failed')].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
  const done = [...jobs.filter(j => j.status === 'succeeded'), ...recent.filter(j => j.status === 'succeeded')].filter((v, i, a) => a.findIndex(x => x.id === v.id) === i);
  const list = tab === 'active' ? active : tab === 'failed' ? failed : done;

  const act = async (j: GenerationJob, action: 'cancel' | 'retry' | 'pause' | 'resume' | 'priority') => {
    try {
      await jobAction(j.id, action, action === 'priority' ? (j.priority ?? 0) + 2 : undefined);
      toast({ level: 'info', title: action === 'priority' ? 'Priority raised' : `${action[0].toUpperCase()}${action.slice(1)} requested`, body: j.label });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <Drawer open={open} onClose={() => setUi('queue', false)} width={430}
      title="Generation Queue"
      sub={boot?.queue ? `${active.length} active · ${boot.queue.counts.running ?? 0} running · concurrency ${'—'}` : `${active.length} active`}>
      <div className="sticky top-0 z-10 flex items-center gap-1 border-b border-line-soft bg-panel/95 px-3 py-2 backdrop-blur">
        {(['active', 'done', 'failed'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cx('rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
              tab === t ? 'bg-accent/12 text-accent-bright' : 'text-ink3 hover:bg-white/[0.04] hover:text-ink2')}>
            {t === 'active' ? `Active ${active.length ? `(${active.length})` : ''}` : t === 'done' ? `Completed${done.length ? ` (${done.length})` : ''}` : `Failed${failed.length ? ` (${failed.length})` : ''}`}
          </button>
        ))}
        <div className="flex-1" />
        <Tip label="Jobs are durable — a restart requeues anything interrupted">
          <span className="icon-btn"><FileText size={13} /></span>
        </Tip>
      </div>

      <div className="space-y-1.5 p-2.5">
        <AnimatePresence initial={false}>
          {list.map(j => (
            <JobRow key={j.id} job={j} expanded={expanded === j.id} onToggle={() => setExpanded(expanded === j.id ? null : j.id)} onAction={act} />
          ))}
        </AnimatePresence>
        {!list.length && (
          <EmptyState compact icon={<Wand2 size={16} />}
            title={tab === 'active' ? 'Nothing running' : tab === 'failed' ? 'No failures' : 'No completed jobs yet'}
            body={tab === 'active'
              ? 'Generation jobs from every stage appear here with live progress. Start one from Storyboard, Video, Voice or Sound.'
              : tab === 'failed' ? 'When a provider fails you will see the reason and a retry or switch-provider action here.'
              : 'Finished jobs land here and their media appears in the Asset Library automatically.'} />
        )}
      </div>
    </Drawer>
  );
}

function JobRow({ job, expanded, onToggle, onAction }: {
  job: GenerationJob; expanded: boolean; onToggle: () => void; onAction: (j: GenerationJob, a: 'cancel' | 'retry' | 'pause' | 'resume' | 'priority') => void;
}) {
  const st = job.status;
  const tone = st === 'succeeded' ? 'ok' : st === 'failed' ? 'bad' : st === 'cancelled' ? 'mut' : st === 'review' ? 'accent' : 'info';
  return (
    <motion.div layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.16 }}
      className={cx('overflow-hidden rounded-lg border bg-well2/70',
        st === 'failed' ? 'border-bad/30' : st === 'running' ? 'border-accent/25' : 'border-line-soft')}>
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors hover:bg-white/[0.02]">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-line bg-pop text-[10px]">
          {st === 'running' ? <motion.span animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}><Dot tone="accent" /></motion.span>
            : st === 'succeeded' ? <Check size={11} className="text-ok" />
            : st === 'failed' ? <X size={11} className="text-bad" />
            : <Dot tone={st === 'queued' ? 'info' : 'mut'} pulse={st === 'queued'} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[12px] font-medium text-ink">{job.label}</span>
            {job.demo && <Badge tone="mut" className="shrink-0">previs</Badge>}
            {job.credits > 0 && <Badge tone="mut" className="shrink-0 tnum">{job.credits} cr</Badge>}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[10.5px] text-ink3">
            {job.sublabel && <span className="truncate">{job.sublabel}</span>}
            {job.queuePosition > 0 && st === 'queued' && <span className="shrink-0">· position {job.queuePosition}</span>}
          </span>
          {(st === 'running' || st === 'queued' || st === 'paused') && (
            <span className="mt-1.5 flex items-center gap-2">
              <Progress value={st === 'queued' ? 0 : job.progress} className="h-1 flex-1" tone={st === 'paused' ? 'bad' : 'accent'} indeterminate={st === 'queued'} />
              <span className="shrink-0 text-[9.5px] font-semibold text-ink3 tnum">{Math.round((st === 'queued' ? 0 : job.progress) * 100)}%</span>
            </span>
          )}
        </span>
        {expanded ? <ChevronDown size={13} className="mt-1 shrink-0 text-ink3" /> : <ChevronRight size={13} className="mt-1 shrink-0 text-ink3" />}
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
            <div className="space-y-2 border-t border-line-soft px-2.5 py-2.5">
              {job.error && (
                <div className="rounded-md border border-bad/30 bg-bad/[0.07] px-2.5 py-2">
                  <p className="text-[11.5px] font-semibold text-bad">{job.error.message}</p>
                  {job.error.suggestion && <p className="mt-1 text-[10.5px] leading-relaxed text-ink2">{job.error.suggestion}</p>}
                  {job.error.providerMessage && <p className="mono mt-1.5 max-h-20 overflow-y-auto whitespace-pre-wrap rounded bg-black/40 p-1.5 text-[9.5px] text-ink3">{job.error.providerMessage}</p>}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10.5px]">
                <Row k="Kind" v={job.kind} />
                <Row k="Status" v={<Badge tone={tone as never}>{st}</Badge>} />
                <Row k="Attempts" v={`${job.attempts}/${job.maxAttempts}`} />
                <Row k="Priority" v={String(job.priority ?? 0)} />
                <Row k="Credits" v={job.credits ? String(job.credits) : '—'} />
                <Row k="Stage" v={job.stage ?? '—'} />
                <Row k="Created" v={new Date(job.createdAt).toLocaleTimeString()} />
                <Row k="Finished" v={job.finishedAt ? new Date(job.finishedAt).toLocaleTimeString() : '—'} />
              </dl>
              {job.assetIds?.length > 0 && (
                <p className="text-[10.5px] text-ink3">{job.assetIds.length} asset(s) added to the library.</p>
              )}
              <div className="flex flex-wrap items-center gap-1">
                {st === 'failed' && <button className="btn btn-xs gap-1" onClick={() => onAction(job, 'retry')}><RotateCcw size={11} />Retry</button>}
                {st === 'failed' && <Tip label="Retry with the router's next-best provider"><span className="text-[10px] text-ink3 underline decoration-dotted">switch provider</span></Tip>}
                {(st === 'queued') && <button className="btn btn-xs gap-1" onClick={() => onAction(job, 'pause')}><Pause size={11} />Pause</button>}
                {(st === 'paused') && <button className="btn btn-xs gap-1" onClick={() => onAction(job, 'resume')}><Play size={11} />Resume</button>}
                {['queued', 'running', 'paused'].includes(st) && <button className="btn btn-xs gap-1" onClick={() => onAction(job, 'priority')}><ArrowUp size={11} />Prioritise</button>}
                {['queued', 'running', 'paused'].includes(st) && <button className="btn btn-xs btn-danger gap-1" onClick={() => onAction(job, 'cancel')}><Ban size={11} />Cancel</button>}
              </div>
              {job.logs?.length > 0 && (
                <details className="group rounded-md border border-line-soft bg-black/30">
                  <summary className="flex cursor-pointer items-center gap-1.5 px-2 py-1.5 text-[10.5px] text-ink3 hover:text-ink2">
                    <Terminal size={11} />Worker log ({job.logs.length})
                  </summary>
                  <div className="scroll-thin max-h-40 overflow-y-auto border-t border-line-soft px-2 py-1.5">
                    {job.logs.slice(-40).map((l, i) => (
                      <p key={i} className={cx('mono text-[9.5px] leading-relaxed', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-accent-bright' : 'text-ink3')}>
                        <span className="opacity-50">{new Date(l.t).toLocaleTimeString()}</span> {l.msg}
                      </p>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (<><dt className="text-ink3">{k}</dt><dd className="truncate text-right text-ink2">{v}</dd></>);
}
function Check({ size, className }: { size: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M20 6 9 17l-5-5" /></svg>;
}
