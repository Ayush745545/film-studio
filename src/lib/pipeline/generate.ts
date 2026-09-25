import { getDb } from '../db';
import { execute, route } from '../ai/router';
import { saveAsset, getAsset } from '../assets';
import { spendCredits, refundCredits, InsufficientCredits } from '../credits';
import { setStageState } from '../project';
import { peaksFromWav, synth, presetFromPrompt } from '../media/wav';
import { uid, nowIso, hashSeed } from '../ids';
import type { GenerationRequest } from '../ai/types';
import type { JobContext } from '../queue';
import type { Asset, Character, GenerationJob, Location, Shot, SoundCue, VoiceLine, StageId } from '@/types';

/**
 * Media generation workers.
 *
 * Charge model: credits are reserved when the job starts and refunded if it
 * fails or is cancelled, so a rate-limited provider never costs the user
 * anything. Demo-engine jobs are always 0 credits.
 */

export interface TargetRef {
  kind: 'shot-frame' | 'shot-video' | 'character-look' | 'location' | 'asset' | 'voice-line' | 'sound-cue' | 'storyboard';
  id: string;
  field?: string;
}
export interface MediaJobInput {
  projectId?: string | null;
  request: GenerationRequest;
  modelId?: string | null;
  presetId?: string | null;
  strategy?: 'quality' | 'speed' | 'cost' | 'explicit';
  target?: TargetRef | null;
  name?: string;
  tags?: string[];
  stage?: StageId | null;
  useFallback?: boolean;
  /** Sound design jobs may synthesise locally even when a provider is configured. */
  forceDemo?: boolean;
}

export interface MediaJobResult {
  assets: Asset[];
  jobId: string;
  demo: boolean;
  model: string;
  provider: string;
  creditsCharged: number;
  target?: TargetRef | null;
}

export async function runMediaJob(job: GenerationJob, ctx: JobContext): Promise<{ output: Record<string, unknown>; assetIds: string[]; creditsUsed: number }> {
  const input = (job.input ?? {}) as unknown as MediaJobInput;
  const req: GenerationRequest = { ...(input.request ?? {}), kind: job.kind as GenerationRequest['kind'] };
  if (!req.prompt && job.kind !== 'upscale') req.prompt = input.name ?? job.label;
  req.seed = req.seed ?? hashSeed(`${job.id}-${req.prompt ?? ''}`);
  const projectId = input.projectId ?? job.projectId ?? null;

  const decision = input.forceDemo
    ? await route({ userId: job.userId, kind: job.kind, modelId: 'demo-' + (job.kind === 'sfx' ? 'sfx' : job.kind === 'music' ? 'music' : job.kind === 'voice' ? 'voice' : job.kind), allowDemo: true, req })
    : await route({ userId: job.userId, kind: job.kind, modelId: input.modelId, presetId: input.presetId ?? undefined, strategy: input.strategy, req });

  await ctx.update({ modelId: decision.model.id, providerId: decision.provider.id, demo: decision.demo });
  await ctx.log('info', decision.reason);

  /* ── credits: reserve up front, refund on failure ───────── */
  const est = decision.adapter.estimateCost(req, decision.model);
  const cost = decision.demo ? 0 : est.credits;
  let charged = 0;
  if (cost > 0) {
    try {
      await spendCredits(job.userId, cost, { type: 'job', id: job.id, description: `${job.label} · ${decision.model.name}` });
      charged = cost;
    } catch (err) {
      if (err instanceof InsufficientCredits) {
        throw Object.assign(new Error(`Not enough credits: this needs ${err.required}, you have ${err.balance}`), {
          code: 'insufficient_credits', retryable: false,
          suggestion: 'Top up in Settings → Billing, switch to a cheaper model, or use the Demo engine.'
        });
      }
      throw err;
    }
  }

  const assets: Asset[] = [];
  try {
    if (input.stage && projectId) await setStageState(projectId, input.stage, 'generating');

    const result = await execute(req, {
      jobId: job.id, userId: job.userId, signal: ctx.signal, route: decision,
      useFallback: input.useFallback !== false,
      onProgress: (p, stage) => void ctx.progress(p, stage),
      onLog: (level, msg) => void ctx.log(level, msg)
    });

    /* ── persist images ────────────────────────────────────── */
    const images = result.images ?? [];
    for (let i = 0; i < images.length; i++) {
      const im = images[i];
      const mime = im.mime || 'image/png';
      const name = input.name ? (images.length > 1 ? `${input.name} · v${i + 1}` : input.name) : `${job.label}${images.length > 1 ? ` ${i + 1}` : ''}`;
      const asset = await saveAsset({
        userId: job.userId, projectId, kind: imageKindFor(input.target),
        name, data: im.data, mime,
        prompt: im.revisedPrompt ?? req.prompt, negativePrompt: req.negativePrompt,
        seed: im.seed ?? req.seed ?? 0, modelId: result.modelId, providerId: result.providerId,
        generationId: job.id, demo: result.demo, width: im.width, height: im.height,
        tags: input.tags ?? [], refIds: refIdsFor(input.target),
        meta: { jobKind: job.kind, shotSize: req.meta?.shotSize, lens: req.meta?.lens, variation: i }
      });
      assets.push(asset);
    }

    /* ── persist video (real file or demo motion plate) ────── */
    for (const v of result.video ?? []) {
      let motion = v.motion;
      // Demo motion plates reference the stills we just saved.
      if (motion && !motion.frames.length && assets.length) motion = { ...motion, frames: assets.map(a => a.url) };
      const name = input.name ?? `${job.label}`;
      if (v.data && v.mime && v.mime !== 'application/x-demo-motion') {
        const asset = await saveAsset({
          userId: job.userId, projectId, kind: 'video', name, data: v.data, mime: v.mime,
          prompt: req.prompt, negativePrompt: req.negativePrompt, seed: req.seed ?? 0,
          modelId: result.modelId, providerId: result.providerId, generationId: job.id,
          demo: result.demo, width: v.width, height: v.height, durationSec: v.durationSec,
          tags: input.tags ?? [], refIds: refIdsFor(input.target),
          meta: { camera: req.camera, motion: req.motion, resolution: req.resolution }
        });
        assets.push(asset);
      } else if (motion) {
        const asset = await saveAsset({
          userId: job.userId, projectId, kind: 'video', name: `${name} (demo motion plate)`,
          data: JSON.stringify(motion), mime: 'application/json',
          prompt: req.prompt, seed: req.seed ?? 0, modelId: result.modelId, providerId: result.providerId,
          generationId: job.id, demo: true, durationSec: v.durationSec,
          tags: [...(input.tags ?? []), 'demo', 'motion-plate'], refIds: refIdsFor(input.target),
          meta: { motion, camera: req.camera, frames: motion.frames.length }
        });
        assets.push(asset);
      } else if (v.url) {
        const asset = await saveAsset({
          userId: job.userId, projectId, kind: 'video', name, mime: 'video/mp4',
          storageKey: '', prompt: req.prompt, seed: req.seed ?? 0,
          modelId: result.modelId, providerId: result.providerId, generationId: job.id,
          demo: result.demo, durationSec: v.durationSec, tags: input.tags ?? [],
          refIds: refIdsFor(input.target), meta: { remoteUrl: v.url }
        });
        assets.push(asset);
      }
    }

    /* ── persist audio ─────────────────────────────────────── */
    for (const a of result.audio ?? []) {
      const wav = Buffer.from(a.data);
      const asset = await saveAsset({
        userId: job.userId, projectId,
        kind: job.kind === 'voice' ? 'voice' : job.kind === 'music' ? 'music' : job.kind === 'sfx' ? 'sfx' : 'audio',
        name: input.name ?? (a.label ? `${job.label} · ${a.label}` : job.label),
        data: new Uint8Array(wav), mime: a.mime || 'audio/wav',
        prompt: req.prompt, seed: req.seed ?? 0, modelId: result.modelId, providerId: result.providerId,
        generationId: job.id, demo: result.demo || Boolean(a.scratch), durationSec: a.durationSec,
        tags: [...(input.tags ?? []), ...(a.scratch ? ['scratch', 'placeholder'] : [])],
        refIds: refIdsFor(input.target),
        meta: { peaks: peaksFromWav(wav), scratch: Boolean(a.scratch), emotion: req.voice?.emotion, voiceId: req.voice?.voiceId, preset: a.label }
      });
      assets.push(asset);
    }

    if (!assets.length && !result.text) {
      throw Object.assign(new Error('Provider returned no media'), { code: 'empty_output', retryable: true });
    }

    /* ── link back to the entity that asked for it ─────────── */
    // For video jobs the *motion* asset is the deliverable; the stills that were
    // rendered alongside it are demo key plates, not the shot's video.
    const primaryAsset = job.kind === 'video' || job.kind === 'lipsync'
      ? (assets.find(a => a.kind === 'video') ?? assets[0])
      : assets[0];
    if (input.target && primaryAsset) {
      await linkTarget(input.target, [primaryAsset, ...assets.filter(a => a.id !== primaryAsset.id)], result.demo, req);
    }

    if (input.stage && projectId) await setStageState(projectId, input.stage, 'ready');
    await maybeSetCover(projectId, assets.find(a => a.kind === 'storyboard') ?? assets[0] ?? null);
    await bumpProject(projectId, charged);

    return {
      output: {
        assetIds: assets.map(a => a.id), text: result.text ?? null, json: result.json ?? null,
        demo: result.demo, model: result.modelId, provider: result.providerId,
        usage: result.usage ?? null, route: decision.reason, credits: charged,
        attempts: result.attempts ?? []
      },
      assetIds: assets.map(a => a.id),
      creditsUsed: charged
    };
  } catch (err) {
    if (charged > 0) await refundCredits(job.userId, charged, { type: 'job', id: job.id, description: `Refund — ${job.label} failed` }).catch(() => {});
    if (input.stage && projectId) await setStageState(projectId, input.stage, 'error');
    throw err;
  }
}

function imageKindFor(target?: TargetRef | null): Asset['kind'] {
  switch (target?.kind) {
    case 'shot-frame': case 'storyboard': return 'storyboard';
    case 'character-look': return 'character';
    case 'location': return 'location';
    default: return 'image';
  }
}
function refIdsFor(target?: TargetRef | null): Asset['refIds'] {
  if (!target) return {};
  switch (target.kind) {
    case 'character-look': return { characters: [target.id] };
    case 'location': return { locations: [target.id] };
    case 'shot-frame': case 'shot-video': return { shots: [target.id] };
    case 'voice-line': return {};
    case 'sound-cue': return {};
    default: return {};
  }
}

async function linkTarget(target: TargetRef, assets: Asset[], demo: boolean, req: GenerationRequest) {
  const db = await getDb();
  const primary = assets[0];
  switch (target.kind) {
    case 'shot-frame': case 'storyboard': {
      const shot = await db.repo('shots').findUnique(target.id) as unknown as Shot | null;
      if (!shot) return;
      await db.repo('shots').update(target.id, {
        frameAssetId: primary.id, frameStatus: 'ready',
        variations: [...(shot.variations ?? []), ...assets.slice(1).map(a => a.id)].slice(-12),
        prompt: req.prompt, seed: primary.seed, take: (shot.take ?? 1)
      } as never);
      await db.repo('storyboards').upsert(target.id, {
        id: uid('sb'), shotId: target.id, projectId: shot.projectId, prompt: req.prompt,
        seed: primary.seed, approved: false, rejected: false, createdAt: nowIso()
      } as never);
      break;
    }
    case 'shot-video': {
      const shot = await db.repo('shots').findUnique(target.id) as unknown as Shot | null;
      if (!shot) return;
      await db.repo('shots').update(target.id, { videoAssetId: primary.id, videoStatus: 'ready' } as never);
      break;
    }
    case 'character-look': {
      const ch = await db.repo('characters').findUnique(target.id) as unknown as Character | null;
      if (!ch) return;
      const looks = [...(ch.looks ?? []), { id: uid('look'), assetId: primary.id, prompt: req.prompt, seed: primary.seed, status: 'ready' as const, createdAt: nowIso() }];
      await db.repo('characters').update(target.id, { lookAssetId: primary.id, looks } as never);
      break;
    }
    case 'location': {
      const loc = await db.repo('locations').findUnique(target.id) as unknown as Location | null;
      if (!loc) return;
      await db.repo('locations').update(target.id, {
        assetId: primary.id,
        referenceAssetIds: [...new Set([...(loc.referenceAssetIds ?? []), ...assets.map(a => a.id)])]
      } as never);
      break;
    }
    case 'voice-line': {
      const line = await db.repo('voices').findUnique(target.id) as unknown as VoiceLine | null;
      if (!line) return;
      await db.repo('voices').update(target.id, { assetId: primary.id, status: 'ready', demo, durationSec: primary.durationSec ?? 0 } as never);
      break;
    }
    case 'sound-cue': {
      const cue = await db.repo('sounds').findUnique(target.id) as unknown as SoundCue | null;
      if (!cue) return;
      await db.repo('sounds').update(target.id, { assetId: primary.id, status: 'ready', demo } as never);
      break;
    }
    default: break;
  }
  void demo;
}

/**
 * Give the project a cover the first time real visual media exists, so project
 * cards show an actual frame from the film rather than a placeholder.
 * Prefers an approved storyboard plate, then any image.
 */
async function maybeSetCover(projectId: string | null, asset: Asset | null) {
  if (!projectId || !asset) return;
  if (!['storyboard', 'image', 'character', 'location', 'video'].includes(asset.kind)) return;
  const db = await getDb();
  const p = await db.repo('projects').findUnique(projectId) as unknown as { coverAssetId: string | null } | null;
  if (!p || p.coverAssetId) return;
  await db.repo('projects').update(projectId, { coverAssetId: asset.id } as never);
}

async function bumpProject(projectId: string | null, credits: number) {
  if (!projectId) return;
  const db = await getDb();
  const p = await db.repo('projects').findUnique(projectId) as unknown as { creditsSpent: number; generationsCount: number } | null;
  if (!p) return;
  await db.repo('projects').update(projectId, {
    creditsSpent: Math.round(((p.creditsSpent ?? 0) + credits) * 100) / 100,
    generationsCount: (p.generationsCount ?? 0) + 1
  } as never);
}

/** Local synthesis path used by the sound designer when no audio provider exists. */
export async function synthesiseLocally(job: GenerationJob, ctx: JobContext): Promise<{ output: Record<string, unknown>; assetIds: string[]; creditsUsed: number }> {
  const input = (job.input ?? {}) as unknown as MediaJobInput;
  const projectId = input.projectId ?? job.projectId ?? null;
  const preset = String(input.request?.audio?.preset ?? '') || presetFromPrompt(input.request?.prompt ?? job.label);
  const dur = Math.max(1, Math.min(120, input.request?.durationSec ?? (job.kind === 'music' ? 30 : 4)));
  await ctx.progress(0.2, `Synthesising ${preset}`);
  const wav = synth(preset as never, dur, {
    seed: input.request?.seed ?? hashSeed(job.id),
    intensity: input.request?.audio?.intensity,
    bpm: input.request?.audio?.bpm,
    words: input.request?.audio?.words
  });
  await ctx.progress(0.75, 'Encoding WAV');
  const asset = await saveAsset({
    userId: job.userId, projectId,
    kind: job.kind === 'music' ? 'music' : job.kind === 'voice' ? 'voice' : 'sfx',
    name: input.name ?? job.label, data: new Uint8Array(wav), mime: 'audio/wav',
    prompt: input.request?.prompt ?? preset, seed: input.request?.seed ?? 0,
    modelId: 'demo-synth', providerId: 'demo', generationId: job.id, demo: true, durationSec: dur,
    tags: ['demo', 'synthesised', preset], refIds: refIdsFor(input.target ?? null),
    meta: { peaks: peaksFromWav(wav), preset, synthesised: true }
  });
  if (input.target) await linkTarget(input.target, [asset], true, input.request ?? ({ kind: job.kind, modelId: '', prompt: '' } as GenerationRequest));
  await ctx.progress(1, 'Done');
  return { output: { assetIds: [asset.id], preset, demo: true, synthesised: true }, assetIds: [asset.id], creditsUsed: 0 };
}

/** Re-read an asset so callers can build requests referencing stored media. */
export async function assetRef(id: string) {
  const a = await getAsset(id);
  return a ? { key: a.storageKey, url: a.url, mime: a.mimeType, name: a.name } : null;
}
