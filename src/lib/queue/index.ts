import { getDb } from '../db';
import { bus } from '../events';
import { uid, nowIso } from '../ids';
import { config } from '../config';
import type { GenKind, GenerationJob, StageId } from '@/types';

/**
 * Generation queue.
 *
 * Jobs are durable records in the database; the scheduler is an in-process
 * worker pool (AFS_QUEUE_DRIVER=memory). Every job survives a restart: on boot
 * we requeue anything left `running`/`queued` and respect its attempt budget.
 * Point AFS_QUEUE_DRIVER=redis + REDIS_URL to hand scheduling to BullMQ
 * workers instead — the enqueue/observe surface is identical.
 *
 * Long video generations never run inside an HTTP request: the route enqueues
 * and returns the job id, and progress reaches the UI over SSE.
 */

export interface JobContext {
  job: GenerationJob;
  signal: AbortSignal;
  progress(p: number, stage?: string): Promise<void>;
  log(level: 'info' | 'warn' | 'error', msg: string): Promise<void>;
  update(patch: Partial<GenerationJob>): Promise<void>;
}

/** Job kinds that belong in a separate process when AFS_WORKER_MODE=external. */
export const HEAVY_KINDS = new Set(['export', 'stems', 'bundle']);

export type JobHandler = (job: GenerationJob, ctx: JobContext) => Promise<{
  output?: Record<string, unknown>;
  assetIds?: string[];
  creditsUsed?: number;
}>;

/**
 * All mutable scheduler state lives on globalThis.
 *
 * Module state lives on globalThis so the registry and scheduler are genuine
 * process-wide singletons even when more than one bundle references this file.
 */
interface Runtime {
  controller: AbortController;
  timer?: NodeJS.Timeout;
  startedAt: number;
}
interface QueueGlobals {
  afsQueueStarted?: boolean;
  afsHandlers?: Map<string, JobHandler>;
  afsLive?: Map<string, Runtime>;
  afsPumping?: boolean;
  afsInitialised?: boolean;
}
const g = globalThis as unknown as QueueGlobals;
const handlers: Map<string, JobHandler> = (g.afsHandlers ??= new Map());
const live: Map<string, Runtime> = (g.afsLive ??= new Map());

export function registerHandler(kind: string, fn: JobHandler) { handlers.set(kind, fn); }
export function handlerFor(kind: string) { return handlers.get(kind); }
export function registeredHandlers() { return [...handlers.keys()]; }

async function patch(id: string, p: Partial<GenerationJob>, publish = true) {
  const db = await getDb();
  const updated = await db.repo('jobs').update(id, { ...p, updatedAt: nowIso() } as never) as unknown as GenerationJob | null;
  if (updated && publish) bus.publish({ type: 'job:update', job: sanitise(updated) });
  return updated;
}

/** Strip anything we never want on the wire. */
export function sanitise(job: GenerationJob): GenerationJob {
  const { ...safe } = job;
  if (safe.input && typeof safe.input === 'object') {
    const i = safe.input as Record<string, unknown>;
    for (const k of Object.keys(i)) if (/key|token|secret|authorization/i.test(k)) delete i[k];
  }
  return safe;
}

export interface EnqueueSpec {
  userId: string;
  projectId?: string | null;
  kind: GenKind;
  label: string;
  sublabel?: string;
  stage?: StageId | null;
  modelId?: string | null;
  presetId?: string | null;
  input?: Record<string, unknown>;
  credits?: number;
  priority?: number;
  maxAttempts?: number;
  demo?: boolean;
  automationRunId?: string | null;
  batchId?: string | null;
  parentJobId?: string | null;
}

export async function enqueue(spec: EnqueueSpec): Promise<GenerationJob> {
  const db = await getDb();
  const job = await db.repo('jobs').create({
    id: uid('job'), userId: spec.userId, projectId: spec.projectId ?? null,
    kind: spec.kind, label: spec.label, sublabel: spec.sublabel ?? '',
    status: 'queued', progress: 0,
    modelId: spec.modelId ?? null, presetId: spec.presetId ?? null, providerId: null,
    input: spec.input ?? {}, output: {}, assetIds: [], error: null,
    credits: spec.credits ?? 0, priority: spec.priority ?? 0,
    attempts: 0, maxAttempts: spec.maxAttempts ?? 2, queuePosition: 0,
    stage: spec.stage ?? null, automationRunId: spec.automationRunId ?? null,
    logs: [], demo: spec.demo ?? false, parentJobId: spec.parentJobId ?? null,
    batchId: spec.batchId ?? null,
    createdAt: nowIso(), startedAt: null, finishedAt: null
  } as never) as unknown as GenerationJob;

  await renumber();
  bus.publish({ type: 'job:created', job: sanitise(job) });
  ensureStarted();
  void pump();
  return job;
}

async function renumber() {
  const db = await getDb();
  const queued = await db.repo('jobs').findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } }) as unknown as GenerationJob[];
  const sorted = queued.slice().sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt));
  let i = 0;
  for (const j of sorted) { i++; if (j.queuePosition !== i) await db.repo('jobs').update(j.id, { queuePosition: i } as never); }
}

/** Crash recovery: nothing stays stuck in `running` across a restart. */
export async function recover() {
  const db = await getDb();
  const stuck = await db.repo('jobs').findMany({ where: { status: 'running' } }) as unknown as GenerationJob[];
  for (const j of stuck) {
    const retryable = j.attempts < j.maxAttempts;
    await db.repo('jobs').update(j.id, {
      status: retryable ? 'queued' : 'failed',
      progress: 0,
      error: retryable ? null : { message: 'Interrupted by a server restart', code: 'interrupted', retryable: true, suggestion: 'Retry the job — nothing was charged twice.' }
    } as never);
  }
  if (stuck.length) console.log(`[queue] recovered ${stuck.length} interrupted job(s)`);
  await renumber();
}

function ensureStarted() {
  if (g.afsQueueStarted || g.afsInitialised) return;
  g.afsInitialised = true; g.afsQueueStarted = true;
  // NOTE: no `import('./handlers')` here. A dynamic import is still statically
  // traced by webpack, and this module can be reached from bundle targets that
  // must not see node: builtins. `ensureBooted()` installs handlers instead.
  void recover().then(() => pump()).catch(err => console.warn('[queue] recovery failed', (err as Error).message));
}

/** Kick the scheduler (called from ensureBooted() and after every enqueue). */
export function startQueue() { ensureStarted(); }

async function pump() {
  if (g.afsPumping) return;
  g.afsPumping = true;
  try {
    for (;;) {
      const db = await getDb();
      const queued = await db.repo('jobs').findMany({ where: { status: 'queued' } }) as unknown as GenerationJob[];
      if (!queued.length) break;
      const running = await db.repo('jobs').count({ where: { status: 'running' } });
      const slots = Math.max(1, config.workerConcurrency) - running;
      if (slots <= 0) break;
      const eligible = config.workerMode === 'external'
        ? queued.filter(j => !HEAVY_KINDS.has(j.kind))   // a separate worker owns those
        : queued;
      if (!eligible.length) break;
      const sorted = eligible.sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt));
      const next = sorted.slice(0, slots);
      for (const job of next) void runJob(job);
      break;
    }
  } finally {
    g.afsPumping = false;
  }
}

async function runJob(job: GenerationJob) {
  const handler = handlerFor(job.kind);
  if (!handler) {
    await patch(job.id, {
      status: 'failed', finishedAt: nowIso(),
      error: { message: `No worker registered for job kind "${job.kind}"`, code: 'no_handler', retryable: false, suggestion: 'This is a server configuration problem — restart the app or check the worker bundle.' }
    });
    void pump();
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), job.kind === 'video' ? 30 * 60_000 : 10 * 60_000);
  live.set(job.id, { controller, timer: timeout, startedAt: Date.now() });

  const db = await getDb();
  const attempts = job.attempts + 1;
  const started = await db.repo('jobs').update(job.id, { status: 'running', attempts, startedAt: nowIso(), progress: 0, error: null, queuePosition: 0 } as never) as unknown as GenerationJob;
  bus.publish({ type: 'job:update', job: sanitise(started ?? job) });

  let lastProgressWrite = 0;
  const ctx: JobContext = {
    job: started ?? job,
    signal: controller.signal,
    async progress(p, stage) {
      const now = Date.now();
      const clamped = Math.max(0, Math.min(1, p));
      const logs = await appendLog(job.id, 'info', stage ?? `progress ${Math.round(clamped * 100)}%`, now - lastProgressWrite > 4000);
      lastProgressWrite = now;
      const updated = await db.repo('jobs').update(job.id, { progress: clamped, ...(logs ? { logs } : {}) } as never) as unknown as GenerationJob;
      if (updated) bus.publish({ type: 'job:update', job: sanitise(updated) });
    },
    async log(level, msg) {
      const logs = await appendLog(job.id, level, msg, true);
      if (logs) {
        const updated = await db.repo('jobs').update(job.id, { logs } as never) as unknown as GenerationJob;
        if (updated) bus.publish({ type: 'job:update', job: sanitise(updated) });
      }
    },
    async update(p) { await patch(job.id, p); }
  };

  try {
    const res = await handler(started ?? job, ctx);
    if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'cancelled' });
    const final = await db.repo('jobs').update(job.id, {
      status: 'succeeded', progress: 1, finishedAt: nowIso(),
      output: res?.output ?? {}, assetIds: res?.assetIds ?? [],
      credits: res?.creditsUsed ?? job.credits
    } as never) as unknown as GenerationJob;
    if (final) bus.publish({ type: 'job:update', job: sanitise(final) });
  } catch (err) {
    const e = err as { message?: string; code?: string; retryable?: boolean; suggestion?: string; providerMessage?: string };
    const cancelled = e?.code === 'cancelled' || controller.signal.aborted;
    const canRetry = !cancelled && (e?.retryable ?? false) && attempts < job.maxAttempts;
    const final = await db.repo('jobs').update(job.id, {
      status: cancelled ? 'cancelled' : canRetry ? 'queued' : 'failed',
      finishedAt: cancelled ? nowIso() : null,
      progress: canRetry ? 0 : (await db.repo('jobs').findUnique(job.id) as unknown as GenerationJob | null)?.progress ?? 0,
      error: cancelled ? null : {
        message: e?.message ?? 'Generation failed',
        code: e?.code ?? 'error',
        retryable: Boolean(e?.retryable),
        suggestion: e?.suggestion,
        providerMessage: e?.providerMessage
      }
    } as never) as unknown as GenerationJob;
    if (final) bus.publish({ type: 'job:update', job: sanitise(final) });
    if (canRetry) setTimeout(() => void pump(), 2000 * attempts);
  } finally {
    clearTimeout(timeout);
    live.delete(job.id);
    await renumber();
    void pump();
  }
}

async function appendLog(jobId: string, level: 'info' | 'warn' | 'error', msg: string, force: boolean) {
  if (!force) return undefined;
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(jobId) as unknown as GenerationJob | null;
  if (!j) return undefined;
  const logs = [...(j.logs ?? []), { t: nowIso(), level, msg }].slice(-120);
  return logs;
}

/* ── control surface ──────────────────────────────────────── */
export async function cancelJob(id: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j || j.userId !== userId) return false;
  const rt = live.get(id);
  if (rt) { rt.controller.abort(); return true; }
  if (j.status === 'queued' || j.status === 'paused') {
    const u = await db.repo('jobs').update(id, { status: 'cancelled', finishedAt: nowIso(), error: null } as never) as unknown as GenerationJob;
    if (u) bus.publish({ type: 'job:update', job: sanitise(u) });
    await renumber();
    return true;
  }
  return false;
}

export async function pauseJob(id: string, userId: string) {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j || j.userId !== userId || j.status !== 'queued') return false;
  const u = await db.repo('jobs').update(id, { status: 'paused' } as never) as unknown as GenerationJob;
  if (u) bus.publish({ type: 'job:update', job: sanitise(u) });
  await renumber();
  return true;
}

export async function resumeJob(id: string, userId: string) {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j || j.userId !== userId || j.status !== 'paused') return false;
  const u = await db.repo('jobs').update(id, { status: 'queued' } as never) as unknown as GenerationJob;
  if (u) bus.publish({ type: 'job:update', job: sanitise(u) });
  await renumber(); void pump();
  return true;
}

export async function retryJob(id: string, userId: string) {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j || j.userId !== userId) return false;
  if (!['failed', 'cancelled', 'paused'].includes(j.status)) return false;
  const u = await db.repo('jobs').update(id, { status: 'queued', attempts: 0, error: null, progress: 0, finishedAt: null } as never) as unknown as GenerationJob;
  if (u) bus.publish({ type: 'job:update', job: sanitise(u) });
  await renumber(); void pump();
  return true;
}

export async function setPriority(id: string, userId: string, priority: number) {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j || j.userId !== userId) return false;
  await db.repo('jobs').update(id, { priority } as never);
  await renumber();
  const u = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (u) bus.publish({ type: 'job:update', job: sanitise(u) });
  return true;
}

export async function queueSnapshot(userId: string) {
  const db = await getDb();
  const rows = await db.repo('jobs').findMany({ where: { userId } }) as unknown as GenerationJob[];
  const active = rows.filter(r => ['queued', 'running', 'paused'].includes(r.status));
  const recent = rows.filter(r => !['queued', 'running', 'paused'].includes(r.status))
    .sort((a, b) => (b.finishedAt ?? b.createdAt).localeCompare(a.finishedAt ?? a.createdAt)).slice(0, 40);
  return {
    active: active.sort((a, b) => (b.priority - a.priority) || a.createdAt.localeCompare(b.createdAt)).map(sanitise),
    recent: recent.map(sanitise),
    counts: {
      queued: active.filter(a => a.status === 'queued').length,
      running: active.filter(a => a.status === 'running').length,
      paused: active.filter(a => a.status === 'paused').length
    }
  };
}

export async function waitForJob(id: string, timeoutMs = 10 * 60_000): Promise<GenerationJob> {
  const db = await getDb();
  const started = Date.now();
  for (;;) {
    const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
    if (!j) throw new Error('Job disappeared');
    if (['succeeded', 'failed', 'cancelled'].includes(j.status)) return j;
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for job');
    await new Promise(r => setTimeout(r, 400));
  }
}

export function liveCount() { return live.size; }
