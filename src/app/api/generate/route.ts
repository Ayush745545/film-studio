import { api, badRequest } from '@/lib/api';
import { enqueue } from '@/lib/queue';
import { estimate } from '@/lib/ai/router';
import { hashSeed } from '@/lib/ids';
import type { GenerationRequest } from '@/lib/ai/types';
import type { GenKind } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Standalone AI Generator (no project required) — the "AI" section of the nav. */
export const POST = api(async ({ user, json }) => {
  const body = await json<{
    kind: GenKind; prompt: string; projectId?: string | null; modelId?: string | null; presetId?: string | null;
    count?: number; durationSec?: number; aspectRatio?: any; resolution?: any; seed?: number;
    negativePrompt?: string; name?: string; dryRun?: boolean;
    voice?: any; audio?: any; referenceImages?: any[]; startFrame?: any; endFrame?: any; text?: any;
  }>();
  if (!body.kind) throw badRequest('kind is required');
  if (!body.prompt?.trim() && !['upscale'].includes(body.kind)) throw badRequest('prompt is required');
  const request: GenerationRequest = {
    kind: body.kind, modelId: body.modelId ?? '', prompt: body.prompt,
    negativePrompt: body.negativePrompt, aspectRatio: body.aspectRatio ?? '16:9',
    resolution: body.resolution ?? '1080p', durationSec: body.durationSec, count: body.count ?? 1,
    seed: body.seed ?? hashSeed(body.prompt + Date.now()), voice: body.voice, audio: body.audio,
    referenceImages: body.referenceImages, startFrame: body.startFrame, endFrame: body.endFrame, text: body.text
  };
  const est = await estimate(request, { userId: user.id, kind: body.kind, modelId: body.modelId, presetId: body.presetId, allowDemo: true, req: request });
  if (body.dryRun) return { estimate: est, request };
  const job = await enqueue({
    userId: user.id, projectId: body.projectId ?? null, kind: body.kind,
    label: body.name ?? `${body.kind[0].toUpperCase()}${body.kind.slice(1)} generation`,
    sublabel: body.prompt.slice(0, 60), modelId: body.modelId ?? null, presetId: body.presetId ?? null,
    credits: est.credits, input: { projectId: body.projectId ?? null, request, modelId: body.modelId ?? null, presetId: body.presetId ?? null, name: body.name, tags: ['generator'] }
  });
  return { job, estimate: est };
}, { strict: true });
