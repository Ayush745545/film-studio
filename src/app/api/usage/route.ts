import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getSubscription, creditHistory, usageSummary } from '@/lib/credits';
import { planById } from '@/lib/pricing';
import { storage } from '@/lib/storage';
import { liveCount } from '@/lib/queue';
import { config } from '@/lib/config';
import type { GenerationJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * One aggregated view of everything the user has consumed — the backend for the
 * Usage panel. Rolls up the credit ledger, the job queue (generations by kind,
 * model, provider and project), storage bytes and recent activity into a single
 * round trip so the panel never has to stitch five endpoints together.
 */
export const GET = api(async ({ user, query }) => {
  const days = Math.min(365, Math.max(1, Number(query().get('days') ?? 30) || 30));
  const db = await getDb();
  const windowMs = days * 864e5;
  const now = Date.now();

  const [sub, summary, history, jobs, assets, models, providers, projects] = await Promise.all([
    getSubscription(user.id),
    usageSummary(user.id),
    creditHistory(user.id, 60),
    db.repo('jobs').findMany({ where: { userId: user.id } }) as Promise<unknown>,
    db.repo('assets').findMany({ where: { userId: user.id } }) as Promise<unknown>,
    db.repo('models').findMany({}) as Promise<unknown>,
    db.repo('providers').findMany({}) as Promise<unknown>,
    db.repo('projects').findMany({ where: { userId: user.id } }) as Promise<unknown>
  ]);

  const jobRows = jobs as unknown as GenerationJob[];
  const assetRows = assets as unknown as { id: string; kind: string; bytes?: number; sizeBytes?: number; createdAt: string }[];
  const modelName = new Map((models as unknown as { id: string; name: string }[]).map(m => [m.id, m.name]));
  const providerName = new Map((providers as unknown as { id: string; name: string }[]).map(p => [p.id, p.name]));
  const projectName = new Map((projects as unknown as { id: string; name: string }[]).map(p => [p.id, p.name]));

  const plan = planById(sub.planId);

  /* ── credit ledger ─────────────────────────────────────────── */
  const txs = history as unknown as { amount: number; kind: string; refType: string; description: string; createdAt: string }[];
  let spentAll = 0, spentWindow = 0, earnedWindow = 0, refundedWindow = 0;
  const byKindWindow: Record<string, number> = {};
  for (const t of txs) {
    const age = now - new Date(t.createdAt).getTime();
    if (t.amount < 0) {
      spentAll += -t.amount;
      if (age <= windowMs) { spentWindow += -t.amount; byKindWindow[t.refType] = (byKindWindow[t.refType] ?? 0) + -t.amount; }
    } else if (age <= windowMs) {
      if (t.kind === 'refund') refundedWindow += t.amount; else earnedWindow += t.amount;
    }
  }
  const round = (n: number) => Math.round(n * 100) / 100;

  /* ── generations (jobs) ────────────────────────────────────── */
  const statusCounts: Record<string, number> = { queued: 0, running: 0, paused: 0, succeeded: 0, failed: 0, cancelled: 0 };
  const byKind: Record<string, { count: number; credits: number; succeeded: number; failed: number }> = {};
  const byModel: Record<string, { id: string; name: string; count: number; credits: number }> = {};
  const byProvider: Record<string, { id: string; name: string; count: number; credits: number }> = {};
  const byProject: Record<string, { id: string; name: string; count: number; credits: number }> = {};
  let durations: number[] = [];
  let jobsWindow = 0, creditsWindow = 0;

  for (const j of jobRows) {
    statusCounts[j.status] = (statusCounts[j.status] ?? 0) + 1;
    const age = now - new Date(j.createdAt).getTime();
    const inWindow = age <= windowMs;
    if (inWindow) { jobsWindow++; creditsWindow += j.credits ?? 0; }

    const k = byKind[j.kind] ?? (byKind[j.kind] = { count: 0, credits: 0, succeeded: 0, failed: 0 });
    k.count++; k.credits = round(k.credits + (j.credits ?? 0));
    if (j.status === 'succeeded') k.succeeded++;
    if (j.status === 'failed') k.failed++;

    const mid = j.modelId ?? 'none';
    const m = byModel[mid] ?? (byModel[mid] = { id: mid, name: modelName.get(mid) ?? (mid === 'none' ? 'Studio engine' : mid), count: 0, credits: 0 });
    m.count++; m.credits = round(m.credits + (j.credits ?? 0));

    const pid = j.providerId ?? (j.demo ? 'studio' : 'none');
    const p = byProvider[pid] ?? (byProvider[pid] = { id: pid, name: providerName.get(pid) ?? (pid === 'studio' ? 'Studio Engine' : pid === 'none' ? 'Unattributed' : pid), count: 0, credits: 0 });
    p.count++; p.credits = round(p.credits + (j.credits ?? 0));

    const prj = j.projectId ?? 'none';
    const pr = byProject[prj] ?? (byProject[prj] = { id: prj, name: prj === 'none' ? 'No project' : (projectName.get(prj) ?? prj), count: 0, credits: 0 });
    pr.count++; pr.credits = round(pr.credits + (j.credits ?? 0));

    if (j.status === 'succeeded' && j.startedAt && j.finishedAt) {
      const d = new Date(j.finishedAt).getTime() - new Date(j.startedAt).getTime();
      if (d >= 0 && d < 30 * 60_000) durations.push(d);
    }
  }
  const avgMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0;
  const sortDesc = <T extends { count: number }>(o: Record<string, T>) => Object.values(o).sort((a, b) => b.count - a.count);

  /* ── storage ───────────────────────────────────────────────── */
  const st = storage();
  const bytesUsed = await st.bytesUsed().catch(() => 0);
  const assetsByKind: Record<string, { count: number; bytes: number }> = {};
  let assetBytes = 0;
  for (const a of assetRows) {
    const b = a.bytes ?? a.sizeBytes ?? 0;
    assetBytes += b;
    const e = assetsByKind[a.kind] ?? (assetsByKind[a.kind] = { count: 0, bytes: 0 });
    e.count++; e.bytes += b;
  }

  return {
    window: { days },
    credits: {
      balance: sub.credits,
      planId: sub.planId,
      planName: plan.name,
      monthly: plan.creditsMonthly,
      renewsAt: sub.renewsAt,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      lifetime: sub.creditsLifetime ?? 0,
      spentWindow: round(spentWindow),
      spentAll: round(spentAll),
      earnedWindow: round(earnedWindow),
      refundedWindow: round(refundedWindow),
      byKind: Object.fromEntries(Object.entries(byKindWindow).map(([k, v]) => [k, round(v)])),
      summary30d: summary
    },
    generations: {
      total: jobRows.length,
      window: jobsWindow,
      creditsWindow: round(creditsWindow),
      statusCounts,
      avgMs,
      byKind: Object.entries(byKind).map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.count - a.count),
      byModel: sortDesc(byModel).slice(0, 12),
      byProvider: sortDesc(byProvider).slice(0, 12),
      byProject: sortDesc(byProject).slice(0, 12)
    },
    queue: {
      driver: config.queueDriver,
      concurrency: config.workerConcurrency,
      live: liveCount(),
      queued: statusCounts.queued ?? 0,
      running: statusCounts.running ?? 0,
      paused: statusCounts.paused ?? 0
    },
    storage: {
      driver: st.name,
      bytesUsed,
      assetCount: assetRows.length,
      assetBytes,
      byKind: Object.entries(assetsByKind).map(([kind, v]) => ({ kind, ...v })).sort((a, b) => b.bytes - a.bytes)
    },
    recent: {
      transactions: txs.slice(0, 30).map(t => ({
        amount: t.amount, kind: t.kind, refType: t.refType, description: t.description, createdAt: t.createdAt
      })),
      jobs: jobRows
        .slice()
        .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt))
        .slice(0, 30)
        .map(j => ({
          id: j.id, kind: j.kind, label: j.label, status: j.status, credits: j.credits ?? 0,
          model: j.modelId ? (modelName.get(j.modelId) ?? j.modelId) : (j.demo ? 'Studio Engine' : '—'),
          provider: j.providerId ? (providerName.get(j.providerId) ?? j.providerId) : (j.demo ? 'Studio Engine' : '—'),
          project: j.projectId ? (projectName.get(j.projectId) ?? j.projectId) : null,
          demo: Boolean(j.demo), createdAt: j.createdAt, finishedAt: j.finishedAt
        }))
    }
  };
});
