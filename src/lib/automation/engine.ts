import { getDb } from '../db';
import { enqueue, waitForJob } from '../queue';
import { bus } from '../events';
import { uid, nowIso } from '../ids';
import { spendCredits } from '../credits';
import { estimate } from '../ai/router';
import { createProject } from '../project';
import type { Automation, AutomationEdge, AutomationNode, AutomationRun, GenKind, StageId } from '@/types';

/**
 * Node types that run without any project context. Everything else — generation,
 * breakdown, batch, assemble, export, timeline, transform — reads or writes a
 * project, so a run containing one of those must resolve a project id first.
 */
const PROJECT_FREE_NODES = new Set<string>([
  'start', 'end', 'delay', 'human-review', 'approve', 'reject',
  'condition', 'webhook', 'http-request', 'note', 'set-var', 'wait'
]);

/**
 * Automation engine.
 *
 * A run walks the node graph from `start`, executing each node and following
 * its output edges. Human-review nodes suspend the run (status `waiting`) and
 * are resumed by an explicit approve/reject/edit decision — credits are never
 * spent on a large batch without the user seeing the plan first.
 *
 * Node execution is delegated to the same job queue the UI uses, so automation
 * and manual work share one scheduler, one credit ledger and one audit trail.
 */

export interface RunContext {
  projectId: string | null;
  userId: string;
  runId: string;
  vars: Record<string, unknown>;
  outputs: Record<string, unknown>;
}

const MAX_STEPS = 500;

type Log = { t: string; nodeId: string | null; level: 'info' | 'warn' | 'error'; msg: string };

export async function startRun(automationId: string, userId: string, projectId?: string | null, vars: Record<string, unknown> = {}): Promise<AutomationRun> {
  const db = await getDb();
  const a = await db.repo('automations').findUnique(automationId) as unknown as Automation | null;
  if (!a) throw new Error('Automation not found');
  if (!a.enabled) throw new Error('Automation is disabled');

  // Resolve a project so project-scoped nodes never die with "Project not found".
  // Precedence: explicit argument → the automation's bound project → the user's
  // most recently opened project → a freshly created scratch project. Whatever we
  // land on is bound back onto the automation, so re-runs reuse the same project
  // and the run always has somewhere to read a script from and write media to.
  let pid: string | null = projectId || a.projectId || null;
  const needsProject = (a.nodes ?? []).some(n => !PROJECT_FREE_NODES.has(n.type));
  if (needsProject && !pid) {
    const recent = await db.repo('projects').findMany({ where: { userId }, orderBy: { lastOpenedAt: 'desc' }, take: 1 }) as unknown as { id: string }[];
    pid = recent[0]?.id ?? null;
    if (!pid) {
      const seedText = (a.description || a.name || '').trim();
      const created = await createProject(userId, {
        name: (a.name || 'Automation project').trim().slice(0, 120),
        description: a.description ?? '',
        idea: seedText ? { text: seedText } : {}
      });
      pid = created.id;
    }
    await db.repo('automations').update(automationId, { projectId: pid } as never);
    a.projectId = pid;
  }

  const run = await db.repo('runs').create({
    id: uid('run'), automationId, projectId: pid, userId,
    status: 'running', currentNodeId: null, visited: [], progress: 0, creditsUsed: 0,
    error: null, review: null,
    logs: [{ t: nowIso(), nodeId: null, level: 'info', msg: `Run started — ${a.name}` }],
    startedAt: nowIso(), finishedAt: null
  } as never) as unknown as AutomationRun;
  await db.repo('automations').update(automationId, { lastRunId: run.id } as never);
  bus.publish({ type: 'automation:update', run });
  void execute(run, a, vars).catch(err => void fail(run.id, (err as Error).message));
  return run;
}

async function persist(runId: string, patch: Partial<AutomationRun>) {
  const db = await getDb();
  const updated = await db.repo('runs').update(runId, patch as never) as unknown as AutomationRun | null;
  if (updated) bus.publish({ type: 'automation:update', run: updated });
  return updated;
}

async function log(runId: string, nodeId: string | null, level: Log['level'], msg: string) {
  const db = await getDb();
  const r = await db.repo('runs').findUnique(runId) as unknown as AutomationRun | null;
  if (!r) return;
  const logs = [...(r.logs ?? []), { t: nowIso(), nodeId, level, msg }].slice(-300);
  await persist(runId, { logs });
}

async function fail(runId: string, message: string) {
  await log(runId, null, 'error', message);
  await persist(runId, { status: 'failed', error: message, finishedAt: nowIso() });
}

async function execute(run: AutomationRun, a: Automation, vars: Record<string, unknown>, resumeFromNodeId?: string | null) {
  const ctx: RunContext = { projectId: run.projectId, userId: run.userId, runId: run.id, vars, outputs: {} };
  const nodeById = new Map(a.nodes.map(n => [n.id, n]));
  const outEdges = new Map<string, AutomationEdge[]>();
  for (const e of a.edges) {
    const arr = outEdges.get(e.from) ?? []; arr.push(e); outEdges.set(e.from, arr);
  }
  // A fresh run starts at `start`; a run resumed after a review gate picks up at
  // the node immediately following the gate so it never re-runs (and re-suspends
  // on) the stages it already completed.
  const start = resumeFromNodeId
    ? nodeById.get(resumeFromNodeId) ?? null
    : a.nodes.find(n => n.type === 'start') ?? a.nodes.find(n => !a.edges.some(e => e.to === n.id)) ?? a.nodes[0];
  if (!start) { await fail(run.id, 'This workflow has no nodes.'); return; }

  let current: AutomationNode | null = start;
  let port = 'out';
  let steps = 0;
  // Carry the already-visited nodes forward on resume so progress and the
  // step-guard reflect the whole run, not just the resumed tail.
  const visited: string[] = resumeFromNodeId ? [...(run.visited ?? [])] : [];

  while (current && steps++ < MAX_STEPS) {
    const db = await getDb();
    const fresh = await db.repo('runs').findUnique(run.id) as unknown as AutomationRun | null;
    if (!fresh) return;
    if (fresh.status === 'cancelled') { await log(run.id, current.id, 'warn', 'Run cancelled'); return; }
    if (fresh.status === 'paused') { await log(run.id, current.id, 'info', 'Run paused — waiting for resume'); return; }

    visited.push(current.id);
    await persist(run.id, { currentNodeId: current.id, visited, progress: Math.min(0.99, visited.length / Math.max(1, a.nodes.length)) });
    await setNodeStatus(a.id, current.id, 'running');
    await log(run.id, current.id, 'info', `▸ ${current.label || current.type}`);

    try {
      const res = await runNode(current, ctx, a);
      if (res.suspend) {
        await setNodeStatus(a.id, current.id, 'waiting');
        await persist(run.id, { status: 'waiting', review: res.review ?? null });
        bus.publish({ type: 'review:requested', run: (await (await getDb()).repo('runs').findUnique(run.id)) as unknown as AutomationRun });
        return;
      }
      if (res.skip) { await setNodeStatus(a.id, current.id, 'skipped'); }
      else { await setNodeStatus(a.id, current.id, 'done'); ctx.outputs[current.id] = res.output ?? null; }
      if (res.credits) await persist(run.id, { creditsUsed: Math.round((((await db.repo('runs').findUnique(run.id) as unknown as AutomationRun)?.creditsUsed ?? 0) + res.credits) * 100) / 100 });
      port = res.port ?? 'out';
    } catch (err) {
      const e = err as Error & { retryable?: boolean };
      await setNodeStatus(a.id, current.id, 'error');
      await log(run.id, current.id, 'error', e.message);
      if (current.retry > 0) {
        await log(run.id, current.id, 'warn', `Retrying (${current.retry} attempt(s) left)`);
        current = { ...current, retry: current.retry - 1 };
        continue;
      }
      await fail(run.id, `Node "${current.label || current.type}" failed: ${e.message}`);
      return;
    }

    const edges: AutomationEdge[] = outEdges.get(current.id) ?? [];
    const next: AutomationEdge | undefined = edges.find(e => e.fromPort === port) ?? edges[0];
    current = next ? nodeById.get(next.to) ?? null : null;
    if (current?.type === 'end') {
      await setNodeStatus(a.id, current.id, 'done');
      visited.push(current.id);
      break;
    }
  }

  await persist(run.id, { status: 'succeeded', progress: 1, currentNodeId: null, finishedAt: nowIso(), visited });
  await log(run.id, null, 'info', 'Run complete');
}

async function setNodeStatus(automationId: string, nodeId: string, status: AutomationNode['status']) {
  const db = await getDb();
  const a = await db.repo('automations').findUnique(automationId) as unknown as Automation | null;
  if (!a) return;
  const nodes = a.nodes.map(n => n.id === nodeId ? { ...n, status } : n);
  await db.repo('automations').update(automationId, { nodes } as never);
}

interface NodeResult { output?: unknown; port?: string; suspend?: boolean; skip?: boolean; credits?: number; review?: AutomationRun['review'] }

async function runNode(node: AutomationNode, ctx: RunContext, a: Automation): Promise<NodeResult> {
  const cfg = node.config ?? {};
  const str = (k: string, d = '') => String(cfg[k] ?? d);
  const num = (k: string, d = 0) => Number(cfg[k] ?? d);
  const prompt = interpolate(node.prompt || str('prompt'), ctx);

  switch (node.type) {
    case 'start': return { output: { startedAt: nowIso(), vars: ctx.vars } };
    case 'end': return { output: { finishedAt: nowIso() } };

    case 'delay': {
      const ms = Math.max(0, Math.min(10 * 60_000, num('ms', num('seconds', 1) * 1000)));
      await log(ctx.runId, node.id, 'info', `Waiting ${(ms / 1000).toFixed(1)}s`);
      await new Promise(r => setTimeout(r, ms));
      return { output: { waitedMs: ms } };
    }

    case 'human-review': case 'approve': case 'reject': {
      const gateCost = num('estimatedCredits', 0);
      const nextLabel = str('nextLabel', 'the next stage');
      return {
        suspend: true,
        review: {
          nodeId: node.id,
          prompt: prompt || `Review before continuing to ${nextLabel}.`,
          requestedAt: nowIso(),
          payload: {
            estimatedCredits: gateCost,
            requiresApproval: a.requireApproval,
            maxCostCredits: a.maxCostCredits,
            summary: str('summary', ''),
            context: ctx.outputs
          }
        }
      };
    }

    case 'condition': {
      const expr = str('expression', 'true');
      const truthy = evaluateCondition(expr, ctx);
      await log(ctx.runId, node.id, 'info', `Condition "${expr}" → ${truthy}`);
      return { output: { result: truthy }, port: truthy ? 'true' : 'false', skip: !truthy && Boolean(cfg.skipOnFalse) };
    }

    case 'batch': case 'loop': {
      const items = await resolveItems(str('source', 'shots'), ctx);
      const limit = Math.min(items.length, num('limit', 500));
      const kind = (str('kind', 'image') as GenKind);
      if (a.requireApproval && limit > num('autoApproveBelow', 4)) {
        const est0 = await estimateCreditsFor(kind, prompt, ctx, limit);
        return {
          suspend: true,
          review: {
            nodeId: node.id, requestedAt: nowIso(),
            prompt: `This batch will run ${limit} ${kind} generation(s) over "${str('source', 'shots')}".`,
            payload: { estimatedCredits: est0, count: limit, kind, source: str('source', 'shots'), prompt }
          }
        };
      }
      const ids: string[] = [];
      let credits = 0;
      for (let i = 0; i < limit; i++) {
        const item = items[i] as Record<string, unknown>;
        const jobPrompt = interpolate(prompt, { ...ctx, vars: { ...ctx.vars, item, index: i } });
        const est0 = await estimateCreditsFor(kind, jobPrompt, ctx, 1);
        credits += est0;
        if (a.maxCostCredits && credits > a.maxCostCredits) {
          await log(ctx.runId, node.id, 'warn', `Stopped at ${i}/${limit}: workflow credit cap (${a.maxCostCredits}) reached`);
          break;
        }
        const job = await enqueue({
          userId: ctx.userId, projectId: ctx.projectId, kind,
          label: `${node.label || 'Batch'} ${i + 1}/${limit}`,
          sublabel: String(item?.name ?? item?.heading ?? `item ${i + 1}`),
          automationRunId: ctx.runId, batchId: node.id,
          input: { projectId: ctx.projectId, request: { kind, modelId: node.modelId ?? '', prompt: jobPrompt, ...(cfg.request as object ?? {}) }, modelId: node.modelId, presetId: str('presetId') || null, target: item?.target ?? null, name: String(item?.name ?? ''), stage: (cfg.stage as StageId) ?? null },
          credits: est0, priority: num('priority', 0)
        });
        ids.push(job.id);
        await log(ctx.runId, node.id, 'info', `Queued ${i + 1}/${limit} — ${job.label}`);
      }
      if (str('waitFor', 'true') === 'true') {
        for (const id of ids.slice(0, 40)) {
          try { await waitForJob(id, 20 * 60_000); } catch (e) { await log(ctx.runId, node.id, 'warn', `Job ${id} did not finish: ${(e as Error).message}`); }
        }
      }
      return { output: { jobIds: ids, count: ids.length }, credits };
    }

    case 'upload': case 'save-asset': {
      const assetId = str('assetId');
      return { output: { assetId }, skip: !assetId };
    }

    case 'transform': {
      const value = cfg.value ?? ctx.vars;
      const op = str('operation', 'passthrough');
      const out = op === 'uppercase' ? JSON.stringify(value).toUpperCase() : op === 'count' ? (Array.isArray(value) ? value.length : Object.keys(value as object).length) : value;
      return { output: { op, value: out } };
    }

    case 'webhook': case 'http-request': {
      const url = str('url');
      if (!url) throw new Error('This node needs a URL');
      const method = str('method', 'POST').toUpperCase();
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json', ...(cfg.headers as Record<string, string> ?? {}) },
        body: method === 'GET' || method === 'HEAD' ? undefined : JSON.stringify(cfg.body ?? { runId: ctx.runId, outputs: ctx.outputs })
      });
      const text = await res.text();
      if (res.status >= 400) throw Object.assign(new Error(`${method} ${url} → HTTP ${res.status}`), { retryable: res.status >= 500 });
      let json: unknown; try { json = JSON.parse(text); } catch { json = text.slice(0, 2000); }
      return { output: { status: res.status, body: json } };
    }

    case 'timeline': case 'assemble': {
      const job = await enqueue({
        userId: ctx.userId, projectId: ctx.projectId, kind: 'assembly',
        label: node.label || 'Assemble timeline', sublabel: str('mode', 'full'),
        automationRunId: ctx.runId, stage: 'aiedit',
        input: { projectId: ctx.projectId, mode: str('mode', 'full'), grade: str('grade', 'cinematic'), addCaptions: cfg.addCaptions === true }
      });
      const done = await waitForJob(job.id, 10 * 60_000);
      if (done.status !== 'succeeded') throw Object.assign(new Error(done.error?.message ?? 'Assembly failed'), { retryable: true });
      return { output: done.output };
    }

    case 'export': {
      const job = await enqueue({
        userId: ctx.userId, projectId: ctx.projectId, kind: 'export',
        label: node.label || 'Export', sublabel: `${str('format', 'mp4')} ${str('resolution', '1080p')}`,
        automationRunId: ctx.runId, stage: 'export',
        input: { projectId: ctx.projectId, engine: str('engine', 'stems') === 'stems' ? 'stems' : str('engine', 'ffmpeg'), format: str('format', 'mp4'), codec: str('codec', 'h264'), resolution: str('resolution', '1080p'), fps: num('fps', 24), aspectRatio: str('aspectRatio', '16:9'), quality: str('quality', 'high'), bitrate: num('bitrate', 12) }
      });
      const done = await waitForJob(job.id, 40 * 60_000);
      if (done.status !== 'succeeded') throw Object.assign(new Error(done.error?.message ?? 'Export failed'), { retryable: true });
      return { output: done.output };
    }

    /* ── generation nodes ───────────────────────────────────── */
    default: {
      const kindMap: Record<string, GenKind> = {
        'generate-story': 'story', 'generate-script': 'script', 'extract-characters': 'cast',
        'extract-locations': 'world', 'breakdown-scenes': 'breakdown', 'generate-storyboard': 'image',
        'text-generate': 'text', 'image-generate': 'image', 'video-generate': 'video',
        'voice-generate': 'voice', 'music-generate': 'music', 'sfx-generate': 'sfx', 'upscale': 'upscale'
      };
      const kind = kindMap[node.type] ?? (str('kind') as GenKind) ?? 'text';
      const credits = await estimateCreditsFor(kind, prompt, ctx, 1);
      if (a.requireApproval && credits > num('autoApproveBelow', 20)) {
        return {
          suspend: true,
          review: { nodeId: node.id, requestedAt: nowIso(), prompt: `"${node.label || node.type}" will spend about ${credits} credits.`, payload: { estimatedCredits: credits, prompt, kind } }
        };
      }
      const job = await enqueue({
        userId: ctx.userId, projectId: ctx.projectId, kind,
        label: node.label || defaultLabel(kind), sublabel: prompt.slice(0, 60),
        modelId: node.modelId, automationRunId: ctx.runId,
        stage: (cfg.stage as StageId) ?? stageFor(kind), credits,
        input: {
          projectId: ctx.projectId,
          modelId: node.modelId, presetId: str('presetId') || null,
          request: { kind, modelId: node.modelId ?? '', prompt, ...(cfg.request as object ?? {}) },
          target: cfg.target ?? null, name: str('name'), tags: str('tags') ? str('tags').split(',').map(s => s.trim()) : ['automation'],
          stage: (cfg.stage as StageId) ?? stageFor(kind)
        }
      });
      await log(ctx.runId, node.id, 'info', `Queued job ${job.id} (${kind})`);
      const done = await waitForJob(job.id, kind === 'video' ? 30 * 60_000 : 12 * 60_000);
      if (done.status === 'failed') throw Object.assign(new Error(done.error?.message ?? 'Generation failed'), { retryable: Boolean(done.error?.retryable) });
      if (done.status === 'cancelled') throw new Error('Run cancelled during generation');
      return { output: done.output, credits: done.credits };
    }
  }
}

async function estimateCreditsFor(kind: GenKind, prompt: string, ctx: RunContext, count: number): Promise<number> {
  try {
    const est0 = await estimate({ kind, modelId: '', prompt }, { userId: ctx.userId, kind, allowDemo: true });
    return Math.max(0, Math.round(est0.credits * count * 100) / 100);
  } catch { return 0; }
}

function stageFor(kind: GenKind): StageId | null {
  return ({ story: 'story', script: 'script', cast: 'characters', world: 'world', breakdown: 'scenes', image: 'storyboard', video: 'video', voice: 'voice', music: 'sound', sfx: 'sound', assembly: 'editor', export: 'export' } as Record<string, StageId>)[kind] ?? null;
}
function defaultLabel(kind: GenKind): string {
  return ({ text: 'Text generation', image: 'Image generation', video: 'Video generation', voice: 'Voice generation', music: 'Music generation', sfx: 'Sound generation', story: 'Story generation', script: 'Script generation', cast: 'Character extraction', world: 'Location extraction', breakdown: 'Scene breakdown', assembly: 'Timeline assembly', export: 'Export' } as Record<string, string>)[kind] ?? 'Generation';
}

/** Fetch the collection a batch node iterates over. */
async function resolveItems(source: string, ctx: RunContext): Promise<unknown[]> {
  const db = await getDb();
  const pid = ctx.projectId;
  if (!pid) return [];
  switch (source) {
    case 'scenes': return db.repo('scenes').findMany({ where: { projectId: pid } });
    case 'characters': return db.repo('characters').findMany({ where: { projectId: pid } });
    case 'locations': return db.repo('locations').findMany({ where: { projectId: pid } });
    case 'voices': return db.repo('voices').findMany({ where: { projectId: pid } });
    case 'sounds': return db.repo('sounds').findMany({ where: { projectId: pid } });
    case 'shots': {
      const shots = await db.repo('shots').findMany({ where: { projectId: pid } }) as unknown as { id: string; sceneId: string; index: number; prompt: string; size: string; lens: string }[];
      return shots.sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.index - b.index)
        .map(s => ({ ...s, name: `Shot ${s.index} · ${s.size} ${s.lens}`, target: { kind: 'shot-frame', id: s.id } }));
    }
    case 'shots-with-frames': {
      const shots = await db.repo('shots').findMany({ where: { projectId: pid } }) as unknown as { id: string; sceneId: string; index: number; frameAssetId: string | null; prompt: string }[];
      return shots.filter(s => s.frameAssetId).map(s => ({ ...s, name: `Shot ${s.index}`, target: { kind: 'shot-video', id: s.id } }));
    }
    default: return Array.isArray(ctx.vars[source]) ? ctx.vars[source] as unknown[] : [];
  }
}

function interpolate(tpl: string, ctx: RunContext): string {
  return String(tpl ?? '').replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, p: string) => {
    const v = p.startsWith('vars.') ? ctx.vars[p.slice(5)]
      : p.startsWith('outputs.') ? ctx.outputs[p.slice(8)]
      : p === 'projectId' ? ctx.projectId : ctx.vars[p];
    return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  });
}

/** Small, safe condition language: `x.y == 3`, `count > 0`, `a && b`, `!flag`. */
export function evaluateCondition(expr: string, ctx: RunContext): boolean {
  const env: Record<string, unknown> = { ...ctx.vars, outputs: ctx.outputs, projectId: ctx.projectId };
  const resolve = (tok: string): unknown => {
    const t = tok.trim();
    if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    if (t === 'true') return true;
    if (t === 'false') return false;
    if (/^["'].*["']$/.test(t)) return t.slice(1, -1);
    return t.split('.').reduce<unknown>((acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]), env);
  };
  const parts = expr.split('&&');
  return parts.every(part => {
    const ors = part.split('||');
    return ors.some(or => {
      let s = or.trim(); let negate = false;
      while (s.startsWith('!')) { negate = !negate; s = s.slice(1).trim(); }
      const m = s.match(/^(.*?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/);
      let truthy: boolean;
      if (m) {
        const l = resolve(m[1]); const r = resolve(m[3]); const op = m[2];
        truthy = op === '==' ? String(l) === String(r) : op === '!=' ? String(l) !== String(r)
          : op === '>' ? Number(l) > Number(r) : op === '<' ? Number(l) < Number(r)
          : op === '>=' ? Number(l) >= Number(r) : Number(l) <= Number(r);
      } else {
        const v = resolve(s);
        truthy = Array.isArray(v) ? v.length > 0 : Boolean(v);
      }
      return negate ? !truthy : truthy;
    });
  });
}

/* ── review gate resolution ───────────────────────────────── */
export async function resolveReview(runId: string, userId: string, decision: 'approve' | 'reject' | 'regenerate', editedVars?: Record<string, unknown>) {
  const db = await getDb();
  const r = await db.repo('runs').findUnique(runId) as unknown as AutomationRun | null;
  if (!r || r.userId !== userId) throw new Error('Run not found');
  if (r.status !== 'waiting' || !r.review) throw new Error('This run is not waiting for review');
  const a = await db.repo('automations').findUnique(r.automationId) as unknown as Automation | null;
  if (!a) throw new Error('Automation not found');

  await log(runId, r.review.nodeId, 'info', `Human review: ${decision.toUpperCase()}`);
  if (decision === 'reject') {
    await setNodeStatus(a.id, r.review.nodeId, 'skipped');
    await persist(runId, { status: 'cancelled', review: null, error: 'Rejected at a review gate', finishedAt: nowIso() });
    return { status: 'cancelled' };
  }
  const gateCredits = Number((r.review.payload as any)?.estimatedCredits ?? 0);
  if (gateCredits > 0) {
    try { await spendCredits(userId, Math.min(gateCredits, a.maxCostCredits || gateCredits), { type: 'automation-run', id: runId, description: `Review gate — ${a.name}` }); }
    catch { /* the individual jobs charge themselves; the gate reservation is best-effort */ }
  }
  await setNodeStatus(a.id, r.review.nodeId, 'done');
  const gateId = r.review.nodeId;
  // Resume at the node immediately after the gate — following the gate's `out`
  // edge — so approving never re-runs the stages before it.
  const gateEdge = a.edges.find(e => e.from === gateId && (e.fromPort === 'out' || !e.fromPort)) ?? a.edges.find(e => e.from === gateId);
  const nextNodeId = gateEdge?.to ?? null;
  const nodesDone = a.nodes.map(n => n.id === gateId ? { ...n, status: 'done' as const } : n);
  if (!nextNodeId) {
    await persist(runId, { status: 'succeeded', review: null, progress: 1, currentNodeId: null, finishedAt: nowIso() });
    await log(runId, null, 'info', 'Run complete');
    return { status: 'succeeded' };
  }
  await persist(runId, { status: 'running', review: null });
  const vars = { ...(r.review.payload as any)?.vars, ...(editedVars ?? {}) };
  void execute({ ...r, status: 'running', visited: r.visited ?? [] } as AutomationRun, { ...a, nodes: nodesDone }, vars, nextNodeId)
    .catch(err => void fail(runId, (err as Error).message));
  return { status: 'running' };
}

export async function cancelRun(runId: string, userId: string) {
  const db = await getDb();
  const r = await db.repo('runs').findUnique(runId) as unknown as AutomationRun | null;
  if (!r || r.userId !== userId) return false;
  await persist(runId, { status: 'cancelled', finishedAt: nowIso(), review: null });
  return true;
}

/* ── workflow templates ───────────────────────────────────── */
export function templateNodes(kind: 'full-film' | 'storyboard-only' | 'social-cut'): { nodes: AutomationNode[]; edges: AutomationEdge[] } {
  const aid = 'NEW';
  const mk = (type: AutomationNode['type'], label: string, x: number, y: number, config: Record<string, unknown> = {}, extra: Partial<AutomationNode> = {}): AutomationNode => ({
    id: uid('node'), automationId: aid, type, label, x, y, config,
    modelId: null, prompt: '', enabled: true, retry: 1, timeoutSec: 900,
    reviewGate: type === 'human-review', inputPort: 'in',
    outputPorts: type === 'condition' ? [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }] : [{ id: 'out', label: 'out' }],
    status: 'idle', logs: [], ...extra
  });
  const link = (from: AutomationNode, to: AutomationNode, fromPort = 'out'): AutomationEdge => ({
    id: uid('edge'), automationId: aid, from: from.id, fromPort, to: to.id, toPort: 'in'
  });

  if (kind === 'storyboard-only') {
    const n = [
      mk('start', 'Start', 60, 200),
      mk('breakdown-scenes', 'Break into scenes', 300, 200),
      mk('human-review', 'Review shot list', 540, 200, { nextLabel: 'storyboard generation', summary: 'Check shot sizes, lenses and durations before spending credits.' }),
      mk('batch', 'Generate storyboard frames', 780, 200, { source: 'shots', kind: 'image', waitFor: 'true', stage: 'storyboard' }, { prompt: '{{item.prompt}}' }),
      mk('human-review', 'Approve frames', 1020, 200, { nextLabel: 'video generation' }),
      mk('end', 'End', 1260, 200)
    ];
    return { nodes: n, edges: [link(n[0], n[1]), link(n[1], n[2]), link(n[2], n[3]), link(n[3], n[4]), link(n[4], n[5])] };
  }
  if (kind === 'social-cut') {
    const n = [
      mk('start', 'Start', 60, 180),
      mk('assemble', 'Assemble social cut', 300, 180, { mode: 'social', grade: 'cinematic', addCaptions: true }),
      mk('human-review', 'Review cut', 540, 180, { nextLabel: 'export' }),
      mk('export', 'Export 9:16', 780, 180, { engine: 'ffmpeg', format: 'mp4', codec: 'h264', resolution: '1080p', aspectRatio: '9:16', fps: 30, quality: 'high' }),
      mk('webhook', 'Notify', 1020, 180, { url: '', method: 'POST' }, { enabled: false }),
      mk('end', 'End', 1260, 180)
    ];
    return { nodes: n, edges: [link(n[0], n[1]), link(n[1], n[2]), link(n[2], n[3]), link(n[3], n[4]), link(n[4], n[5])] };
  }
  const n = [
    mk('start', 'Idea', 40, 260),
    mk('generate-story', 'Generate story', 250, 260, { stage: 'story' }),
    mk('human-review', 'Review story', 460, 260, { nextLabel: 'script generation', summary: 'Approve the story before the screenplay is written from it.' }),
    mk('generate-script', 'Generate script', 670, 260, { stage: 'script' }),
    mk('human-review', 'Review script', 880, 260, { nextLabel: 'character extraction' }),
    mk('extract-characters', 'Extract characters', 1090, 260, { stage: 'characters' }),
    mk('extract-locations', 'Extract locations', 1090, 420, { stage: 'world' }),
    mk('breakdown-scenes', 'Break into scenes', 1300, 260, { stage: 'scenes' }),
    mk('human-review', 'Review shot list', 1510, 260, { nextLabel: 'storyboard generation' }),
    mk('batch', 'Generate storyboard', 1720, 260, { source: 'shots', kind: 'image', waitFor: 'true', stage: 'storyboard' }, { prompt: '{{item.prompt}}' }),
    mk('human-review', 'Approve frames', 1930, 260, { nextLabel: 'video generation', summary: 'Frames become the start frame for each video generation.' }),
    mk('batch', 'Generate videos', 2140, 260, { source: 'shots-with-frames', kind: 'video', waitFor: 'true', stage: 'video' }, { prompt: '{{item.prompt}}' }),
    mk('voice-generate', 'Generate dialogue', 2350, 180, { stage: 'voice' }),
    mk('sfx-generate', 'Design sound', 2350, 340, { stage: 'sound' }),
    mk('assemble', 'Assemble timeline', 2560, 260, { mode: 'full', grade: 'cinematic' }),
    mk('human-review', 'Review the cut', 2770, 260, { nextLabel: 'export' }),
    mk('export', 'Export master', 2980, 260, { engine: 'ffmpeg', format: 'mp4', codec: 'h264', resolution: '1080p', aspectRatio: '16:9', fps: 24, quality: 'master' }),
    mk('end', 'Done', 3190, 260)
  ];
  const edges = [
    link(n[0], n[1]), link(n[1], n[2]), link(n[2], n[3]), link(n[3], n[4]), link(n[4], n[5]),
    link(n[5], n[6]), link(n[5], n[7]), link(n[6], n[7]), link(n[7], n[8]), link(n[8], n[9]),
    link(n[9], n[10]), link(n[10], n[11]), link(n[11], n[12]), link(n[12], n[14]),
    link(n[11], n[13]), link(n[13], n[14]), link(n[14], n[15]), link(n[15], n[16]), link(n[16], n[17])
  ];
  return { nodes: n, edges };
}
