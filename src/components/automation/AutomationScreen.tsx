'use client';
import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Workflow, Plus, Play, Trash2, Copy, Pencil, Clock, Check, X, AlertTriangle, Pause, ListChecks, Zap, ChevronRight } from 'lucide-react';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, Stat, Dot } from '@/components/ui/primitives';
import { Field, TextInput, Select, Toggle } from '@/components/ui/inputs';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { NodeCanvas } from './NodeCanvas';
import { get, post, del, describeError } from '@/lib/client/api';
import { useApp, useBoot } from '@/store/app';
import type { Automation, AutomationRun } from '@/types';

export function AutomationScreen() {
  const boot = useBoot();
  const toast = useApp(s => s.toast);
  const { confirm, node } = useConfirm();
  const [tab, setTab] = React.useState<'workflows' | 'runs' | 'queue'>('workflows');
  const [editing, setEditing] = React.useState<Automation | null>(null);
  const [creating, setCreating] = React.useState(false);
  const projects = boot?.projects ?? [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['automations'],
    refetchInterval: 6000,
    queryFn: () => get<{ automations: Automation[]; runs: AutomationRun[]; templates: { id: string; name: string; description: string; nodes: number }[] }>('/api/automations')
  });
  const automations = data?.automations ?? [];
  const runs = data?.runs ?? [];
  const waiting = runs.filter(r => r.status === 'waiting');

  React.useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    const t = sp?.get('tab');
    if (t === 'runs' || t === 'queue') setTab(t);
  }, []);

  const run = async (a: Automation, projectId?: string) => {
    try {
      const r = await post<AutomationRun>(`/api/automations/${a.id}/run`, { projectId: projectId ?? a.projectId });
      toast({ level: 'success', title: 'Workflow started', body: a.requireApproval ? 'It will pause at each review gate.' : undefined });
      setTab('runs'); setEditing(null);
      await refetch();
      void r;
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  const remove = async (a: Automation) => {
    const ok = await confirm({ title: `Delete "${a.name}"?`, tone: 'danger', confirmLabel: 'Delete workflow', body: 'Run history is deleted with it.' });
    if (!ok) return;
    try { await del(`/api/automations/${a.id}`); await refetch(); toast({ level: 'success', title: 'Workflow deleted' }); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="ambient" />
        <div className="mx-auto w-full max-w-[1360px] px-6 py-7 lg:px-10">
          <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink"><Workflow size={18} className="text-accent" />Automation</h1>
              <p className="mt-1 max-w-[80ch] text-[12.5px] leading-relaxed text-ink2">
                Node pipelines that run the production stages unattended — with human review gates before anything
                expensive. Runs share the same job queue, credit ledger and audit trail as manual work.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setTab('runs')}><ListChecks size={12} />Runs{waiting.length ? ` (${waiting.length} waiting)` : ''}</Button>
              <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={12} />New workflow</Button>
            </div>
          </header>

          <div className="mb-4 flex items-center gap-1 border-b border-line-soft">
            {(['workflows', 'runs', 'queue'] as const).map(t => (
              <button key={t} type="button" onClick={() => setTab(t)} data-on={tab === t}
                className="tab-underline -mb-px px-3 py-2 text-[12px] font-medium capitalize text-ink3 transition-colors hover:text-ink2 data-[on=true]:text-ink">
                {t}{t === 'runs' && waiting.length ? ` · ${waiting.length}` : ''}
              </button>
            ))}
          </div>

          {tab === 'workflows' && (
            <>
              {isLoading && <div className="grid gap-3 lg:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-[150px]" />)}</div>}
              {!isLoading && !automations.length && (
                <EmptyState icon={<Workflow size={17} />} title="No workflows yet"
                  body={<>Start from a template. <strong className="text-ink2">Idea → Finished Film</strong> wires the whole pipeline with four review gates; <strong className="text-ink2">Storyboard Only</strong> stops before video; <strong className="text-ink2">Social Cut</strong> assembles and exports a vertical version.</>}
                  action={<div className="flex flex-wrap justify-center gap-2">{(data?.templates ?? []).map(t => (
                    <Button key={t.id} size="sm" variant="primary" onClick={() => setCreating(t.id as never)}><Zap size={12} />{t.name}</Button>))}</div>} />
              )}
              <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {automations.map(a => {
                  const lastRun = runs.find(r => r.id === a.lastRunId);
                  const gates = a.nodes.filter(n => n.reviewGate || n.type === 'human-review').length;
                  return (
                    <Card key={a.id} hover className="flex flex-col p-4">
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-[13.5px] font-semibold text-ink">{a.name}</h3>
                          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-ink3">{a.description || 'No description'}</p>
                        </div>
                        <Badge tone={a.enabled ? 'ok' : 'mut'}>{a.enabled ? 'enabled' : 'disabled'}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
                        <Mini label="Nodes" value={a.nodes.length} />
                        <Mini label="Gates" value={gates} tone="accent" />
                        <Mini label="Cap" value={a.maxCostCredits} suffix="cr" />
                        <Mini label="Runs" value={runs.filter(r => r.automationId === a.id).length} />
                      </div>
                      {lastRun && (
                        <div className="mt-2.5 flex items-center gap-2 rounded-md border border-line-soft bg-well px-2 py-1.5 text-[10.5px]">
                          <Dot tone={lastRun.status === 'succeeded' ? 'ok' : lastRun.status === 'failed' ? 'bad' : lastRun.status === 'waiting' ? 'accent' : 'info'} pulse={['running', 'waiting'].includes(lastRun.status)} />
                          <span className="text-ink2">Last run {lastRun.status}</span>
                          <span className="ml-auto text-ink3">{new Date(lastRun.startedAt).toLocaleString()}</span>
                        </div>
                      )}
                      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
                        <Button size="xs" variant="primary" onClick={() => void run(a)}><Play size={11} />Run</Button>
                        <Button size="xs" variant="ghost" onClick={() => setEditing(a)}><Pencil size={11} />Edit graph</Button>
                        <div className="flex-1" />
                        <Tip label="Duplicate"><button type="button" className="icon-btn h-6 w-6" onClick={async () => { await post('/api/automations', { ...a, name: `${a.name} (copy)`, id: undefined }); await refetch(); }}><Copy size={11} /></button></Tip>
                        <Tip label="Delete"><button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={() => void remove(a)}><Trash2 size={11} /></button></Tip>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          )}

          {tab === 'runs' && <RunsList runs={runs} waiting={waiting} onRefresh={refetch} />}
          {tab === 'queue' && <QueueList />}
        </div>
      </div>

      {/* graph editor */}
      {editing && <NodeCanvas automation={editing} onClose={() => { setEditing(null); void refetch(); }} onRun={() => void run(editing)} />}

      {/* create */}
      <CreateModal open={creating} templates={data?.templates ?? []} projects={projects.map(p => ({ id: p.id, name: p.name }))}
        onClose={() => setCreating(false)} onCreated={async () => { await refetch(); }} />
      {node}
    </div>
  );
}

function Mini({ label, value, suffix, tone }: { label: string; value: number; suffix?: string; tone?: 'accent' }) {
  return (
    <div className="rounded border border-line-soft bg-well px-1 py-1.5">
      <p className={cx('text-[13px] font-semibold tnum', tone === 'accent' ? 'text-accent-bright' : 'text-ink')}>{value}{suffix && <span className="ml-0.5 text-[8px] font-normal text-ink3">{suffix}</span>}</p>
      <p className="text-[9px] uppercase tracking-wider text-ink3">{label}</p>
    </div>
  );
}

function RunsList({ runs, waiting, onRefresh }: { runs: AutomationRun[]; waiting: AutomationRun[]; onRefresh: () => void }) {
  const toast = useApp(s => s.toast);
  const [open, setOpen] = React.useState<string | null>(null);
  const decide = async (r: AutomationRun, decision: 'approve' | 'reject' | 'regenerate') => {
    try {
      await post(`/api/runs/${r.id}/review`, { decision });
      toast({ level: decision === 'reject' ? 'warn' : 'success', title: decision === 'approve' ? 'Gate approved — run continues' : decision === 'reject' ? 'Run stopped at the gate' : 'Regeneration requested' });
      onRefresh();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  if (!runs.length) return <EmptyState icon={<ListChecks size={17} />} title="No runs yet" body="Run a workflow and it will appear here with a live log, node statuses and any review gates waiting for you." />;
  return (
    <div className="space-y-2">
      {waiting.length > 0 && (
        <div className="mb-3 rounded-lg border border-accent/35 bg-accent/[0.07] p-3">
          <p className="flex items-center gap-2 text-[12.5px] font-semibold text-accent-bright"><AlertTriangle size={13} />{waiting.length} run(s) waiting for your review</p>
          <p className="mt-1 text-[11px] text-ink2">Nothing expensive runs until you approve the gate.</p>
        </div>
      )}
      {runs.map(r => (
        <Card key={r.id} hover={false} className={cx('overflow-hidden', r.status === 'waiting' && 'border-accent/40')}>
          <button type="button" onClick={() => setOpen(open === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.02]">
            <Dot tone={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : r.status === 'waiting' ? 'accent' : r.status === 'cancelled' ? 'mut' : 'info'} pulse={['running', 'waiting'].includes(r.status)} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-[12.5px] font-medium text-ink">{r.status === 'waiting' ? `Waiting · ${r.review?.prompt ?? 'review gate'}` : `Run ${r.id.slice(0, 8)}`}</span>
                <Badge tone={r.status === 'succeeded' ? 'ok' : r.status === 'failed' ? 'bad' : r.status === 'waiting' ? 'accent' : 'mut'}>{r.status}</Badge>
              </span>
              <span className="mt-0.5 flex items-center gap-2 text-[10.5px] text-ink3">
                <Clock size={9} />{new Date(r.startedAt).toLocaleString()}
                <span>· {r.visited?.length ?? 0} nodes</span>
                <span>· {r.creditsUsed} credits</span>
                {r.error && <span className="truncate text-bad">· {r.error}</span>}
              </span>
            </span>
            <span className="h-1 w-24 shrink-0 overflow-hidden rounded-full bg-well">
              <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright" style={{ width: `${Math.round((r.progress ?? 0) * 100)}%` }} />
            </span>
            <ChevronRight size={13} className={cx('shrink-0 text-ink3 transition-transform', open === r.id && 'rotate-90')} />
          </button>
          {open === r.id && (
            <div className="border-t border-line-soft p-3">
              {r.review && r.status === 'waiting' && (
                <div className="mb-3 rounded-md border border-accent/35 bg-accent/[0.06] p-3">
                  <p className="text-[12px] font-semibold text-accent-bright">Human review gate</p>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-ink2">{r.review.prompt}</p>
                  {typeof (r.review.payload as any)?.estimatedCredits === 'number' && (
                    <p className="mt-1.5 text-[11px] text-ink3">Estimated cost: <span className="text-accent-bright tnum">{(r.review.payload as any).estimatedCredits}</span> credits</p>
                  )}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <Button size="xs" variant="primary" onClick={() => void decide(r, 'approve')}><Check size={11} />Approve & continue</Button>
                    <Button size="xs" variant="ghost" onClick={() => void decide(r, 'regenerate')}><Play size={11} />Regenerate</Button>
                    <Button size="xs" variant="danger" onClick={() => void decide(r, 'reject')}><X size={11} />Reject & stop</Button>
                  </div>
                </div>
              )}
              <div className="scroll-thin max-h-64 overflow-y-auto rounded-md border border-line-soft bg-deep p-2">
                {(r.logs ?? []).slice(-80).map((l, i) => (
                  <p key={i} className={cx('mono text-[10px] leading-relaxed', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-accent-bright' : 'text-ink3')}>
                    <span className="opacity-50">{new Date(l.t).toLocaleTimeString()}</span>
                    {l.nodeId ? <span className="opacity-40"> [{l.nodeId.slice(0, 6)}]</span> : null} {l.msg}
                  </p>
                ))}
                {!(r.logs ?? []).length && <p className="px-2 py-3 text-center text-[11px] text-ink3">No log output yet.</p>}
              </div>
              <div className="mt-2 flex gap-1.5">
                {['running', 'waiting', 'paused'].includes(r.status) && (
                  <Button size="xs" variant="danger" onClick={async () => { await post(`/api/runs/${r.id}/cancel`, {}); onRefresh(); }}><Pause size={11} />Cancel run</Button>
                )}
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function QueueList() {
  const jobs = useApp(s => s.jobs);
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <Stat label="Running" value={jobs.filter(j => j.status === 'running').length} tone="accent" />
        <Stat label="Queued" value={jobs.filter(j => j.status === 'queued').length} />
        <Stat label="Failed" value={jobs.filter(j => j.status === 'failed').length} tone={jobs.some(j => j.status === 'failed') ? 'bad' : undefined} />
      </div>
      <EmptyState compact icon={<ListCounts />} title="Full queue view"
        body="The generation queue drawer shows every job from both manual work and automation, with progress, logs, retry and cancel. Press ⌘J."
        action={<Button size="sm" onClick={() => useApp.getState().setUi('queue', true)}>Open queue</Button>} />
    </div>
  );
}
function ListCounts() { return <ListChecks size={15} />; }

function CreateModal({ open, templates, projects, onClose, onCreated }: {
  open: boolean | string; templates: { id: string; name: string; description: string; nodes: number }[];
  projects: { id: string; name: string }[]; onClose: () => void; onCreated: () => Promise<void>;
}) {
  const toast = useApp(s => s.toast);
  const [template, setTemplate] = React.useState('');
  const [name, setName] = React.useState('');
  const [projectId, setProjectId] = React.useState('');
  const [maxCredits, setMaxCredits] = React.useState(500);
  const [requireApproval, setRequireApproval] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (open === true) { setTemplate(''); setName(''); setProjectId(projects[0]?.id ?? ''); }
    else if (typeof open === 'string' && open) {
      const t = templates.find(x => x.id === open);
      setTemplate(open); setName(t?.name ?? 'New workflow'); setProjectId(projects[0]?.id ?? '');
    }
  }, [open, templates, projects]);

  const submit = async () => {
    setBusy(true);
    try {
      await post('/api/automations', {
        name: name.trim() || templates.find(t => t.id === template)?.name || 'New workflow',
        description: templates.find(t => t.id === template)?.description ?? '',
        template: template || 'full-film', projectId: projectId || null,
        maxCostCredits: maxCredits, requireApproval
      });
      toast({ level: 'success', title: 'Workflow created' });
      await onCreated(); onClose();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(false); }
  };

  return (
    <Modal open={Boolean(open)} onClose={onClose} width={560} title="New workflow" icon={<Workflow size={14} />}
      sub="Templates lay out a node graph you can then edit, extend or rewire."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={submit}>Create workflow</Button></>}>
      <div className="space-y-3">
        <Field label="Template">
          <Select value={template} onChange={setTemplate} placeholder="Idea → Finished Film (default)"
            options={templates.map(t => ({ value: t.id, label: `${t.name} — ${t.nodes} nodes` }))} />
          {template && <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink3">{templates.find(t => t.id === template)?.description}</p>}
        </Field>
        <Field label="Name"><TextInput value={name} onChange={e => setName(e.target.value)} placeholder="My pipeline" /></Field>
        <Field label="Project" hint="Runs against this project's idea, script and media.">
          <Select value={projectId} onChange={setProjectId} placeholder="None (choose at run time)" options={projects.map(p => ({ value: p.id, label: p.name }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Credit cap" hint="A run stops before exceeding this.">
            <TextInput type="number" min={0} value={maxCredits} onChange={e => setMaxCredits(Number(e.target.value))} />
          </Field>
          <div className="flex items-end pb-1">
            <div className="w-full rounded-md border border-line-soft bg-well px-2.5 py-2">
              <Toggle checked={requireApproval} onChange={setRequireApproval} label="Require human review" hint="Gates pause the run before expensive batches." />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
