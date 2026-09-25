import { badRequest, notFound } from './api';
import { getDb } from './db';
import { createProject, listProjects, getProject, updateProject, deleteProject } from './project';
import { listAssets } from './assets';
import { enqueue } from './queue';
import { estimate } from './ai/router';
import { hashSeed } from './ids';
import { audit } from './security/audit';
import { PROJECT_TYPES } from '@/types';
import type { AspectRatio, AssetKind, GenKind, GenerationJob, ModelDescriptor, Resolution } from '@/types';
import type { GenerationRequest } from './ai/types';

/**
 * Behaviour shared by the session API (`/api/*`) and the public API
 * (`/api/open/*`).
 *
 * The two surfaces differ in how they authenticate and nothing else, so the
 * logic lives here once. A route file under either prefix should stay thin
 * enough to read in one screen — if it grows a `if (isOpen)` branch, the branch
 * belongs here instead.
 */

export interface Caller { userId: string; ip: string }

/* ── projects ──────────────────────────────────────────── */

export async function coreListProjects(caller: Caller, q?: string | null) {
  const projects = await listProjects(caller.userId, q ?? undefined);
  return { projects, types: PROJECT_TYPES };
}

export interface CreateProjectInput {
  name?: string; type?: string; description?: string; tags?: string[];
  idea?: Record<string, unknown>; settings?: Record<string, unknown>;
}

export async function coreCreateProject(caller: Caller, body: CreateProjectInput) {
  const name = (body.name ?? '').trim();
  if (!name) throw badRequest('Project name is required', 'Give the project a working title — you can rename it later.');
  if (name.length > 120) throw badRequest('Project name is too long', 'Keep it under 120 characters.');

  const typeIds = PROJECT_TYPES.map(t => t.id as string);
  if (body.type !== undefined && !typeIds.includes(body.type)) {
    throw badRequest(`Unknown project type "${body.type}"`, `Expected one of: ${typeIds.join(', ')}.`);
  }
  if (body.tags !== undefined && !Array.isArray(body.tags)) throw badRequest('tags must be an array');

  const project = await createProject(caller.userId, {
    name,
    type: body.type as never,
    settings: body.settings as never,
    idea: body.idea as never,
    description: body.description,
    tags: body.tags?.slice(0, 30).map(String)
  });
  await audit({
    userId: caller.userId, action: 'project.create', entity: 'project',
    entityId: project.id, ip: caller.ip, meta: { type: project.type }
  });
  return project;
}

export async function coreGetProject(caller: Caller, id: string) {
  const project = await getProject(id, caller.userId);
  if (!project) throw notFound('Project not found');
  return project;
}

export async function coreUpdateProject(caller: Caller, id: string, body: Record<string, unknown>) {
  const existing = await getProject(id, caller.userId);
  if (!existing) throw notFound('Project not found');

  // Allowlist, mirroring the session route: an open caller must not be able to
  // write fields the UI does not expose either.
  const allowed: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) allowed.name = body.name.trim().slice(0, 120);
  if (typeof body.description === 'string') allowed.description = body.description.slice(0, 2000);
  if (Array.isArray(body.tags)) allowed.tags = body.tags.slice(0, 30).map(String);
  if (body.settings && typeof body.settings === 'object') allowed.settings = { ...existing.settings, ...(body.settings as object) };
  if (body.idea && typeof body.idea === 'object') allowed.idea = { ...existing.idea, ...(body.idea as object) };
  if (!Object.keys(allowed).length) throw badRequest('Nothing to update', 'Send at least one of: name, description, tags, settings, idea.');

  return updateProject(id, allowed as never, {
    userId: caller.userId, reason: 'Updated via API', snapshot: Boolean(body.idea)
  });
}

export async function coreDeleteProject(caller: Caller, id: string) {
  const done = await deleteProject(id, caller.userId);
  if (!done) throw notFound('Project not found');
  await audit({ userId: caller.userId, action: 'project.delete', entity: 'project', entityId: id, ip: caller.ip });
  return { deleted: true };
}

/* ── assets ────────────────────────────────────────────── */

export async function coreListAssets(
  caller: Caller,
  opts: { projectId?: string | null; kinds?: string | null; q?: string | null; scope?: string | null }
) {
  const kinds = opts.kinds?.split(',').filter(Boolean) as AssetKind[] | undefined;
  const assets = await listAssets(caller.userId, {
    projectId: opts.scope === 'all' ? undefined : (opts.projectId ?? undefined),
    kinds, q: opts.q ?? undefined, take: 800
  });
  return { assets };
}

/* ── models ────────────────────────────────────────────── */

/**
 * Read-only model registry.
 *
 * Deliberately narrower than the session `GET /api/models`: the public surface
 * does not return `readyProviders`, which is derived from the caller's stored
 * credential rows and would disclose which vendors this install has keys for.
 */
export async function coreListModels(kind?: string | null, capability?: string | null) {
  const db = await getDb();
  let models = await db.repo('models').findMany({}) as unknown as ModelDescriptor[];
  if (kind) models = models.filter(m => m.kind === kind || m.capabilities.includes(kind as never));
  if (capability) models = models.filter(m => m.capabilities.includes(capability as never));
  const providers = await db.repo('providers').findMany({}) as unknown as { id: string; name: string; driver: string; enabled: boolean }[];
  return {
    models: models
      .filter(m => m.enabled)
      .sort((a, b) => a.kind.localeCompare(b.kind) || b.quality - a.quality)
      .map(m => ({
        id: m.id, name: m.name, kind: m.kind, capabilities: m.capabilities,
        providerId: m.providerId, driverModel: m.driverModel, quality: m.quality,
        speed: m.speed, unit: m.unit, demo: m.demo, isDefault: m.isDefault,
        supportedRatios: m.supportedRatios, supportedResolutions: m.supportedResolutions
      })),
    providers: providers.filter(p => p.enabled).map(p => ({ id: p.id, name: p.name, driver: p.driver }))
  };
}

/* ── generation ────────────────────────────────────────── */

const GEN_KINDS = ['image', 'video', 'voice', 'music', 'sfx', 'upscale', 'lipsync', 'text'] as const;
const RATIOS = ['16:9', '9:16', '1:1', '4:5', '4:3', '2.39:1', '21:9'] as const;
const RESOLUTIONS = ['480p', '720p', '1080p', '1440p', '4k'] as const;

export interface GenerateInput {
  kind?: string; prompt?: string; modelId?: string | null; projectId?: string | null;
  count?: number; durationSec?: number; aspectRatio?: string; resolution?: string;
  seed?: number; negativePrompt?: string; name?: string; dryRun?: boolean;
}

/**
 * Enqueue a generation.
 *
 * Validates the enum-shaped fields explicitly. The session route casts them
 * (`aspectRatio?: any`), which is survivable when a first-party UI is the only
 * caller; on a public surface a bad enum would otherwise reach the provider
 * adapters and fail somewhere unhelpful.
 */
export async function coreGenerate(caller: Caller, body: GenerateInput) {
  const kind = (body.kind ?? '').trim();
  if (!kind) throw badRequest('kind is required', `One of: ${GEN_KINDS.join(', ')}.`);
  if (!(GEN_KINDS as readonly string[]).includes(kind)) {
    throw badRequest(`Unknown kind "${kind}"`, `Expected one of: ${GEN_KINDS.join(', ')}.`);
  }
  const prompt = (body.prompt ?? '').trim();
  if (!prompt && kind !== 'upscale') throw badRequest('prompt is required', 'Describe what to generate. Only "upscale" may omit it.');
  if (prompt.length > 8000) throw badRequest('prompt is too long', 'Keep it under 8000 characters.');

  if (body.aspectRatio && !(RATIOS as readonly string[]).includes(body.aspectRatio)) {
    throw badRequest(`Unknown aspectRatio "${body.aspectRatio}"`, `Expected one of: ${RATIOS.join(', ')}.`);
  }
  if (body.resolution && !(RESOLUTIONS as readonly string[]).includes(body.resolution)) {
    throw badRequest(`Unknown resolution "${body.resolution}"`, `Expected one of: ${RESOLUTIONS.join(', ')}.`);
  }
  const count = body.count ?? 1;
  if (!Number.isInteger(count) || count < 1 || count > 8) {
    throw badRequest('count must be an integer between 1 and 8');
  }
  if (body.durationSec !== undefined && (!Number.isFinite(body.durationSec) || body.durationSec <= 0 || body.durationSec > 120)) {
    throw badRequest('durationSec must be between 0 and 120 seconds');
  }
  if (body.seed !== undefined && (!Number.isInteger(body.seed) || body.seed < 0)) {
    throw badRequest('seed must be a non-negative integer');
  }

  // A projectId, if given, must belong to the caller — otherwise a key could
  // attach assets to someone else's project.
  if (body.projectId) {
    const owned = await getProject(body.projectId, caller.userId);
    if (!owned) throw notFound('Project not found');
  }
  if (body.modelId) {
    const db = await getDb();
    const model = await db.repo('models').findUnique(body.modelId);
    if (!model) throw badRequest(`Unknown modelId "${body.modelId}"`, 'List available models with GET /api/open/models.');
  }

  const request = {
    kind: kind as GenKind, modelId: body.modelId ?? '', prompt,
    negativePrompt: body.negativePrompt,
    aspectRatio: (body.aspectRatio ?? '16:9') as AspectRatio,
    resolution: (body.resolution ?? '1080p') as Resolution,
    durationSec: body.durationSec, count,
    seed: body.seed ?? hashSeed(prompt + Date.now())
  } as GenerationRequest;

  const est = await estimate(request, {
    userId: caller.userId, kind: kind as GenKind, modelId: body.modelId ?? undefined,
    allowDemo: true, req: request
  });
  if (body.dryRun) return { estimate: est, request };

  const job = await enqueue({
    userId: caller.userId, projectId: body.projectId ?? null, kind: kind as GenKind,
    label: body.name ?? `${kind[0].toUpperCase()}${kind.slice(1)} generation (API)`,
    sublabel: prompt.slice(0, 60), modelId: body.modelId ?? null,
    credits: est.credits,
    input: { projectId: body.projectId ?? null, request, modelId: body.modelId ?? null, name: body.name, tags: ['open-api'] }
  });
  await audit({
    userId: caller.userId, action: 'open.generate', entity: 'job', entityId: job.id,
    ip: caller.ip, meta: { kind, modelId: body.modelId ?? null, credits: est.credits }
  });
  return { job, estimate: est };
}

/* ── jobs ──────────────────────────────────────────────── */

/** Strip anything a public caller has no business seeing from a job row. */
export function publicJob(job: GenerationJob) {
  const { input: _input, logs: _logs, ...rest } = job as GenerationJob & { input?: unknown; logs?: unknown };
  void _input; void _logs;
  return rest;
}

export async function coreListJobs(caller: Caller, opts: { status?: string | null; projectId?: string | null }) {
  const db = await getDb();
  let rows = await db.repo('jobs').findMany({
    where: { userId: caller.userId }, orderBy: { createdAt: 'desc' }, take: 200
  }) as unknown as GenerationJob[];
  if (opts.status) rows = rows.filter(j => j.status === opts.status);
  if (opts.projectId) rows = rows.filter(j => j.projectId === opts.projectId);
  return {
    active: rows.filter(r => ['queued', 'running', 'paused'].includes(r.status)).map(publicJob),
    recent: rows.filter(r => !['queued', 'running', 'paused'].includes(r.status)).slice(0, 60).map(publicJob)
  };
}

export async function coreGetJob(caller: Caller, id: string) {
  const db = await getDb();
  const job = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  // Ownership is part of the lookup, not a separate check that can be skipped.
  if (!job || job.userId !== caller.userId) throw notFound('Job not found');
  return publicJob(job);
}
