'use client';
import * as React from 'react';
import { Coins, RefreshCw, Gauge, HardDrive, Activity, Wallet, Cpu, Layers, FolderKanban, Building2, ChevronRight, Zap, CheckCircle2, XCircle, Clock, Loader2 } from 'lucide-react';
import { cx, Badge, Dot, Progress, Stat, SectionHeader, EmptyState, Skeleton, Button } from '@/components/ui/primitives';
import { Drawer } from '@/components/ui/overlays';
import { useApp } from '@/store/app';
import { get } from '@/lib/client/api';

/* ── payload shape (mirrors /api/usage) ─────────────────────── */
interface Usage {
  window: { days: number };
  credits: {
    balance: number; planId: string; planName: string; monthly: number; renewsAt: string | null;
    cancelAtPeriodEnd: boolean; lifetime: number; spentWindow: number; spentAll: number;
    earnedWindow: number; refundedWindow: number; byKind: Record<string, number>;
    summary30d: { spent30d: number; byKind: Record<string, number>; totalTx: number };
  };
  generations: {
    total: number; window: number; creditsWindow: number;
    statusCounts: Record<string, number>; avgMs: number;
    byKind: { kind: string; count: number; credits: number; succeeded: number; failed: number }[];
    byModel: { id: string; name: string; count: number; credits: number }[];
    byProvider: { id: string; name: string; count: number; credits: number }[];
    byProject: { id: string; name: string; count: number; credits: number }[];
  };
  queue: { driver: string; concurrency: number; live: number; queued: number; running: number; paused: number };
  storage: { driver: string; bytesUsed: number; assetCount: number; assetBytes: number; byKind: { kind: string; count: number; bytes: number }[] };
  recent: {
    transactions: { amount: number; kind: string; refType: string; description: string; createdAt: string }[];
    jobs: { id: string; kind: string; label: string; status: string; credits: number; model: string; provider: string; project: string | null; demo: boolean; createdAt: string; finishedAt: string | null }[];
  };
}

const fmtBytes = (n: number) => {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
};
const fmtDur = (ms: number) => ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
const fmtNum = (n: number) => (Math.round(n * 100) / 100).toLocaleString();
const ago = (iso: string | null) => {
  if (!iso) return '—';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`;
};
const KIND_TONE: Record<string, 'ok' | 'bad' | 'accent' | 'info' | 'mut'> = { succeeded: 'ok', failed: 'bad', running: 'accent', queued: 'info', cancelled: 'mut', paused: 'mut' };

/** Global usage drawer — credits, generations, queue, storage and recent activity in one place. */
export function UsagePanel() {
  const open = useApp(s => s.ui.usage);
  const setUi = useApp(s => s.setUi);
  const [days, setDays] = React.useState(30);
  const [data, setData] = React.useState<Usage | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'jobs' | 'ledger'>('jobs');

  const load = React.useCallback(async () => {
    setLoading(true); setErr(null);
    try { setData(await get<Usage>(`/api/usage?days=${days}`)); }
    catch (e) { setErr((e as Error).message); }
    finally { setLoading(false); }
  }, [days]);

  React.useEffect(() => { if (open) void load(); }, [open, load]);
  React.useEffect(() => {
    if (!open) return;
    const i = setInterval(() => { void load(); }, 15000);
    return () => clearInterval(i);
  }, [open, load]);

  const c = data?.credits;
  const planPct = c && c.monthly > 0 ? Math.min(100, (c.spentWindow / c.monthly) * 100) : 0;
  const g = data?.generations;
  const done = g?.statusCounts.succeeded ?? 0;
  const failedN = g?.statusCounts.failed ?? 0;

  return (
    <Drawer open={open} onClose={() => setUi('usage', false)} width={470}
      title={<span className="flex items-center gap-2"><Gauge size={15} className="text-accent" />Usage &amp; credits</span>}
      sub={<span className="text-ink3">Everything you've consumed — live from the ledger, queue and storage.</span>}
      footer={
        <div className="flex items-center gap-2">
          <Button size="xs" variant="ghost" onClick={() => void load()} loading={loading}><RefreshCw size={11} />Refresh</Button>
          <div className="flex-1" />
          <a href="/billing" className="btn btn-outline h-[26px] gap-1 px-2.5 text-[11px]"><Wallet size={11} />Billing<ChevronRight size={11} /></a>
        </div>
      }>

      {/* window selector */}
      <div className="mb-3 flex items-center gap-1.5">
        <span className="label mr-1">Window</span>
        {[7, 30, 90].map(d => (
          <button key={d} type="button" onClick={() => setDays(d)}
            className={cx('rounded-md border px-2 py-0.5 text-[11px] transition-colors', days === d ? 'border-accent/40 bg-accent/12 text-accent-bright' : 'border-line-soft bg-well text-ink3 hover:text-ink')}>
            {d}d
          </button>
        ))}
        {loading && <Loader2 size={12} className="ml-auto animate-spin text-ink3" />}
      </div>

      {err && <div className="mb-3 rounded-md border border-bad/30 bg-bad/10 px-3 py-2 text-[11.5px] text-bad">{err}</div>}

      {!data && loading && <div className="space-y-3">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>}

      {data && c && (
        <div className="space-y-4">
          {/* ── credits ── */}
          <section>
            <SectionHeader title={<span className="flex items-center gap-1.5"><Coins size={13} className="text-accent" />Credits</span>}
              right={<Badge tone="accent">{c.planName}</Badge>} />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Stat label="Balance" value={<span className="tnum">{fmtNum(c.balance)}</span>} sub={`${fmtNum(c.monthly)} / month`} tone="accent" />
              <Stat label={`Spent · ${days}d`} value={<span className="tnum">{fmtNum(c.spentWindow)}</span>} sub={`All-time ${fmtNum(c.spentAll)}`} />
              <Stat label="Lifetime earned" value={<span className="tnum">{fmtNum(c.lifetime)}</span>} sub={c.renewsAt ? `Renews ${ago(c.renewsAt) === '—' ? '—' : new Date(c.renewsAt).toLocaleDateString()}` : '—'} />
              <Stat label="Refunded · window" value={<span className="tnum">{fmtNum(c.refundedWindow)}</span>} sub={`Granted ${fmtNum(c.earnedWindow)}`} tone={c.refundedWindow ? 'ok' : undefined} />
            </div>
            {c.monthly > 0 && (
              <div className="mt-2 rounded-md border border-line-soft bg-well px-3 py-2">
                <div className="mb-1 flex items-center justify-between text-[10.5px]"><span className="text-ink3">Plan usage this window</span><span className="tnum text-ink2">{fmtNum(c.spentWindow)} / {fmtNum(c.monthly)}</span></div>
                <Progress value={planPct} tone={planPct > 90 ? 'bad' : planPct > 70 ? 'accent' : 'ok'} />
                {c.cancelAtPeriodEnd && <p className="mt-1.5 text-[10px] text-warn">Cancels at period end</p>}
              </div>
            )}
            {Object.keys(c.byKind).length > 0 && (
              <div className="mt-2 space-y-1">
                {Object.entries(c.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
                  const max = Math.max(...Object.values(c.byKind), 1);
                  return (
                    <div key={k} className="flex items-center gap-2 text-[11px]">
                      <span className="w-24 shrink-0 truncate capitalize text-ink3">{k}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-accent/70" style={{ width: `${(v / max) * 100}%` }} /></div>
                      <span className="w-14 shrink-0 text-right tnum text-ink2">{fmtNum(v)} cr</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── generations ── */}
          {g && (
            <section>
              <SectionHeader title={<span className="flex items-center gap-1.5"><Zap size={13} className="text-accent" />Generations</span>}
                right={<span className="text-[10.5px] text-ink3">{g.total} total · {g.window} in window</span>} />
              <div className="mt-2 grid grid-cols-4 gap-1.5 text-center">
                <MiniStat icon={<CheckCircle2 size={12} />} tone="ok" value={done} label="Done" />
                <MiniStat icon={<XCircle size={12} />} tone="bad" value={failedN} label="Failed" />
                <MiniStat icon={<Loader2 size={12} />} tone="accent" value={g.statusCounts.running ?? 0} label="Running" />
                <MiniStat icon={<Clock size={12} />} tone="info" value={g.statusCounts.queued ?? 0} label="Queued" />
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-line-soft bg-well px-3 py-1.5 text-[10.5px] text-ink3">
                <Activity size={11} />Avg completion <span className="tnum text-ink2">{g.avgMs ? fmtDur(g.avgMs) : '—'}</span>
                <span className="ml-auto">Credits in window <span className="tnum text-ink2">{fmtNum(g.creditsWindow)}</span></span>
              </div>

              {g.byKind.length > 0 && <Breakdown title="By kind" rows={g.byKind.map(k => ({ label: k.kind, count: k.count, meta: `${fmtNum(k.credits)} cr · ${k.succeeded}✓ ${k.failed}✗` }))} />}
              {g.byModel.length > 0 && <Breakdown icon={<Cpu size={11} />} title="By model" rows={g.byModel.map(m => ({ label: m.name, count: m.count, meta: `${fmtNum(m.credits)} cr` }))} />}
              {g.byProvider.length > 0 && <Breakdown icon={<Building2 size={11} />} title="By provider" rows={g.byProvider.map(p => ({ label: p.name, count: p.count, meta: `${fmtNum(p.credits)} cr` }))} />}
              {g.byProject.length > 0 && <Breakdown icon={<FolderKanban size={11} />} title="By project" rows={g.byProject.map(p => ({ label: p.name, count: p.count, meta: `${fmtNum(p.credits)} cr` }))} />}
            </section>
          )}

          {/* ── queue + storage ── */}
          <div className="grid grid-cols-2 gap-3">
            <section>
              <SectionHeader title={<span className="flex items-center gap-1.5"><Layers size={13} className="text-accent" />Queue</span>} />
              <div className="mt-2 space-y-1 rounded-md border border-line-soft bg-well px-3 py-2 text-[11px]">
                <Row k="Driver" v={data.queue.driver} />
                <Row k="Concurrency" v={String(data.queue.concurrency)} />
                <Row k="Live" v={String(data.queue.live)} />
                <Row k="Queued" v={String(data.queue.queued)} />
                <Row k="Running" v={String(data.queue.running)} />
              </div>
            </section>
            <section>
              <SectionHeader title={<span className="flex items-center gap-1.5"><HardDrive size={13} className="text-accent" />Storage</span>} />
              <div className="mt-2 space-y-1 rounded-md border border-line-soft bg-well px-3 py-2 text-[11px]">
                <Row k="Driver" v={data.storage.driver} />
                <Row k="Used" v={fmtBytes(data.storage.bytesUsed)} />
                <Row k="Assets" v={String(data.storage.assetCount)} />
                <Row k="Tracked" v={fmtBytes(data.storage.assetBytes)} />
              </div>
            </section>
          </div>

          {data.storage.byKind.length > 0 && (
            <Breakdown icon={<HardDrive size={11} />} title="Storage by asset kind"
              rows={data.storage.byKind.map(s => ({ label: s.kind, count: s.count, meta: fmtBytes(s.bytes) }))} />
          )}

          {/* ── recent activity ── */}
          <section>
            <SectionHeader title={<span className="flex items-center gap-1.5"><Activity size={13} className="text-accent" />Recent activity</span>}
              right={
                <div className="flex gap-1">
                  {(['jobs', 'ledger'] as const).map(t => (
                    <button key={t} type="button" onClick={() => setTab(t)}
                      className={cx('rounded px-1.5 py-0.5 text-[10px] capitalize', tab === t ? 'bg-accent/15 text-accent-bright' : 'text-ink3 hover:text-ink')}>{t}</button>
                  ))}
                </div>
              } />
            <div className="mt-2 space-y-1">
              {tab === 'jobs' && (data.recent.jobs.length === 0
                ? <EmptyState compact title="No generations yet" body="Run a generation or workflow and it will show up here." />
                : data.recent.jobs.map(j => (
                  <div key={j.id} className="flex items-center gap-2 rounded-md border border-line-soft bg-well px-2.5 py-1.5">
                    <Dot tone={KIND_TONE[j.status] ?? 'mut'} pulse={j.status === 'running'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11.5px] text-ink">{j.label || j.kind}</p>
                      <p className="truncate text-[10px] text-ink3">{j.kind} · {j.model}{j.project ? ` · ${j.project}` : ''}{j.demo ? ' · PREVIS' : ''}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10.5px] tnum text-ink2">{j.credits ? `${fmtNum(j.credits)} cr` : '—'}</p>
                      <p className="text-[9.5px] text-ink3">{ago(j.finishedAt ?? j.createdAt)}</p>
                    </div>
                  </div>
                )))}
              {tab === 'ledger' && (data.recent.transactions.length === 0
                ? <EmptyState compact title="No ledger entries" body="Credit movements will appear here." />
                : data.recent.transactions.map((t, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-line-soft bg-well px-2.5 py-1.5">
                    <span className={cx('w-14 shrink-0 text-right text-[11.5px] font-semibold tnum', t.amount < 0 ? 'text-bad' : 'text-ok')}>{t.amount < 0 ? '−' : '+'}{fmtNum(Math.abs(t.amount))}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[11px] text-ink">{t.description || t.kind}</p>
                      <p className="truncate text-[10px] text-ink3 capitalize">{t.kind} · {t.refType}</p>
                    </div>
                    <span className="shrink-0 text-[9.5px] text-ink3">{ago(t.createdAt)}</span>
                  </div>
                )))}
            </div>
          </section>
        </div>
      )}
    </Drawer>
  );
}

function MiniStat({ icon, value, label, tone }: { icon: React.ReactNode; value: number; label: string; tone: 'ok' | 'bad' | 'accent' | 'info' }) {
  const color = tone === 'ok' ? 'text-ok' : tone === 'bad' ? 'text-bad' : tone === 'accent' ? 'text-accent-bright' : 'text-info';
  return (
    <div className="rounded-md border border-line-soft bg-well px-1 py-1.5">
      <p className={cx('flex items-center justify-center gap-1 text-[14px] font-semibold tnum', color)}>{icon}{value}</p>
      <p className="mt-0.5 text-[9px] uppercase tracking-wide text-ink3">{label}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex items-center justify-between gap-2"><span className="text-ink3">{k}</span><span className="truncate tnum text-ink2">{v}</span></div>;
}

function Breakdown({ title, rows, icon }: { title: string; icon?: React.ReactNode; rows: { label: string; count: number; meta?: string }[] }) {
  const max = Math.max(...rows.map(r => r.count), 1);
  return (
    <div className="mt-2">
      <p className="mb-1 flex items-center gap-1 text-[10px] uppercase tracking-wide text-ink3">{icon}{title}</p>
      <div className="space-y-1">
        {rows.slice(0, 8).map((r, i) => (
          <div key={i} className="flex items-center gap-2 text-[11px]">
            <span className="w-28 shrink-0 truncate text-ink2">{r.label}</span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-accent/60" style={{ width: `${(r.count / max) * 100}%` }} /></div>
            <span className="w-8 shrink-0 text-right tnum text-ink">{r.count}</span>
            {r.meta && <span className="w-28 shrink-0 truncate text-right text-[10px] text-ink3">{r.meta}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
