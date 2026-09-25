/**
 * Standalone media worker.
 *
 *   AFS_WORKER_MODE=external npm run worker
 *
 * Heavy, CPU-bound work (ffmpeg encodes, offline audio mixdowns, project
 * bundle zipping) should not share a process with HTTP request handling. In
 * `external` mode the web process leaves `export`, `stems` and `bundle` jobs
 * queued and this process claims and runs them against the same database and
 * the same object storage — so it works with both the embedded file driver and
 * PostgreSQL, with no extra broker.
 *
 * Claiming is a conditional status transition (`queued` → `running`), which is
 * atomic under PostgreSQL and safe for a single worker under the file driver.
 * Run more than one worker against PostgreSQL and add `FOR UPDATE SKIP LOCKED`
 * in a Prisma `$transaction` if you need multi-instance claiming.
 */
import { getDb } from '../lib/db';
import { handlerFor } from '../lib/queue';
import { ensureBooted } from '../lib/boot';
import { sanitise } from '../lib/queue';
import { bus } from '../lib/events';
import { nowIso } from '../lib/ids';
import type { GenerationJob as Job } from '../types';

const HEAVY = ['export', 'stems', 'bundle'];
const POLL_MS = Number(process.env.AFS_WORKER_POLL_MS ?? 1200);

async function claim(id: string): Promise<Job | null> {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as Job | null;
  if (!j || j.status !== 'queued') return null;
  const updated = await db.repo('jobs').update(id, {
    status: 'running', attempts: (j.attempts ?? 0) + 1, startedAt: nowIso(), progress: 0, queuePosition: 0, error: null
  } as never) as unknown as Job | null;
  if (updated) bus.publish({ type: 'job:update', job: sanitise(updated) });
  return updated;
}

async function finish(id: string, patch: Partial<Job>) {
  const db = await getDb();
  const updated = await db.repo('jobs').update(id, { ...patch, updatedAt: nowIso() } as never) as unknown as Job | null;
  if (updated) bus.publish({ type: 'job:update', job: sanitise(updated) });
  return updated;
}

async function tick(): Promise<number> {
  const db = await getDb();
  const queued = await db.repo('jobs').findMany({ where: { status: 'queued' } }) as unknown as Job[];
  const candidates = queued.filter(j => HEAVY.includes(j.kind))
    .sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt));
  if (!candidates.length) return 0;

  let ran = 0;
  for (const cand of candidates.slice(0, Number(process.env.AFS_WORKER_CONCURRENCY ?? 1))) {
    const job = await claim(cand.id);
    if (!job) continue;
    ran++;
    const handler = handlerFor(job.kind);
    console.log(`[worker] ▸ ${job.kind} · ${job.label} (${job.id})`);
    if (!handler) {
      await finish(job.id, { status: 'failed', finishedAt: nowIso(), error: { message: `No worker registered for "${job.kind}"`, code: 'no_handler', retryable: false } });
      continue;
    }
    const logs: Job['logs'] = [...(job.logs ?? [])];
    const started = Date.now();
    try {
      const res = await handler(job, {
        job,
        signal: new AbortController().signal,
        async progress(p, stage) {
          if (stage) logs.push({ t: nowIso(), level: 'info', msg: stage });
          const u = await finish(job.id, { progress: Math.max(0, Math.min(1, p)), logs: logs.slice(-120) });
          void u;
        },
        async log(level, msg) {
          logs.push({ t: nowIso(), level, msg });
          console.log(`[worker]   ${level === 'error' ? '✗' : level === 'warn' ? '!' : '·'} ${msg}`);
          await finish(job.id, { logs: logs.slice(-120) });
        },
        async update(p) { await finish(job.id, p); }
      });
      await finish(job.id, {
        status: 'succeeded', progress: 1, finishedAt: nowIso(),
        output: res?.output ?? {}, assetIds: res?.assetIds ?? [], credits: res?.creditsUsed ?? job.credits, logs: logs.slice(-120)
      });
      console.log(`[worker] ✓ ${job.label} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
    } catch (err) {
      const e = err as { message?: string; code?: string; retryable?: boolean; suggestion?: string; providerMessage?: string };
      const canRetry = (e?.retryable ?? false) && job.attempts < job.maxAttempts;
      logs.push({ t: nowIso(), level: 'error', msg: e?.message ?? String(err) });
      await finish(job.id, {
        status: canRetry ? 'queued' : 'failed',
        finishedAt: canRetry ? null : nowIso(),
        error: canRetry ? null : { message: e?.message ?? 'Worker failed', code: e?.code ?? 'worker_error', retryable: Boolean(e?.retryable), suggestion: e?.suggestion, providerMessage: e?.providerMessage },
        logs: logs.slice(-120)
      });
      console.error(`[worker] ✗ ${job.label}: ${e?.message ?? err}`);
    }
  }
  return ran;
}

async function main() {
  await ensureBooted();
  const db = await getDb();
  const info = db.info();
  console.log(`[worker] AI Film Studio media worker`);
  console.log(`[worker] database: ${info.driver} (${info.detail})`);
  console.log(`[worker] handling: ${HEAVY.join(', ')}`);
  console.log(`[worker] polling every ${POLL_MS}ms — Ctrl-C to stop`);
  if (process.env.AFS_WORKER_MODE !== 'external') {
    console.warn('[worker] AFS_WORKER_MODE is not "external": the web process is also running these jobs.');
    console.warn('[worker] Set AFS_WORKER_MODE=external on the web process so it defers them here.');
  }
  let idle = 0;
  for (;;) {
    try {
      const ran = await tick();
      idle = ran ? 0 : Math.min(idle + 1, 100);
      if (idle === 40) console.log('[worker] idle — waiting for export jobs');
    } catch (err) {
      console.error('[worker] tick failed:', (err as Error).message);
    }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
}

void main();
