import { registerHandler } from './index';
import { runMediaJob, synthesiseLocally } from '../pipeline/generate';
import {
  runStory, runScript, runCast, runWorld, runBreakdown, runSoundDesign,
  runDialogueExtract, runAssemble, runEditPlan, runCopilot, runAnalysis
} from '../pipeline/domain';
import { runExport } from '../pipeline/export';
import { execute, route } from '../ai/router';
import type { GenerationRequest } from '../ai/types';

/** Plain text generation (used by the AI Generator playground and utilities). */
async function runText(job: Parameters<typeof runMediaJob>[0], ctx: Parameters<typeof runMediaJob>[1]) {
  const input = job.input as { request?: Partial<GenerationRequest>; prompt?: string; modelId?: string | null; presetId?: string | null; temperature?: number; maxTokens?: number; system?: string; json?: boolean };
  const req: GenerationRequest = {
    kind: 'text',
    modelId: input.modelId ?? '',
    prompt: input.request?.prompt ?? input.prompt ?? '',
    referenceImages: input.request?.referenceImages,
    text: {
      system: input.system ?? input.request?.text?.system,
      temperature: input.temperature ?? input.request?.text?.temperature ?? 0.8,
      maxTokens: input.maxTokens ?? input.request?.text?.maxTokens ?? 4000,
      responseFormat: input.json ? 'json' : (input.request?.text?.responseFormat ?? 'text')
    },
    seed: input.request?.seed
  };
  const decision = await route({ userId: job.userId, kind: 'text', modelId: input.modelId, presetId: input.presetId ?? undefined, strategy: 'quality', allowDemo: true, req });
  await ctx.update({ modelId: decision.model.id, providerId: decision.provider.id, demo: decision.demo });
  await ctx.log('info', decision.reason);
  const res = await execute(req, {
    jobId: job.id, userId: job.userId, signal: ctx.signal, route: decision,
    onProgress: (p, s) => void ctx.progress(p, s), onLog: (l, m) => void ctx.log(l, m)
  });
  return { output: { text: res.text ?? '', json: res.json ?? null, demo: res.demo, model: res.modelId, provider: res.providerId, usage: res.usage ?? null }, assetIds: [], creditsUsed: 0 };
}

/** Idempotent, and stored on globalThis so it survives bundle boundaries. */
const gh = globalThis as unknown as { afsHandlersInstalled?: boolean };
export function installHandlers() {
  if (gh.afsHandlersInstalled) return;
  gh.afsHandlersInstalled = true;

  // media
  registerHandler('image', (j, c) => runMediaJob(j, c));
  registerHandler('video', (j, c) => runMediaJob(j, c));
  registerHandler('voice', (j, c) => ((j.input as any)?.localSynth ? synthesiseLocally(j, c) : runMediaJob(j, c)));
  registerHandler('music', (j, c) => ((j.input as any)?.localSynth ? synthesiseLocally(j, c) : runMediaJob(j, c)));
  registerHandler('sfx', (j, c) => ((j.input as any)?.localSynth ? synthesiseLocally(j, c) : runMediaJob(j, c)));
  registerHandler('upscale', (j, c) => runMediaJob(j, c));
  registerHandler('lipsync', (j, c) => runMediaJob(j, c));

  // text + domain
  registerHandler('text', runText);
  registerHandler('analysis', (j, c) => runAnalysis(j, c));
  registerHandler('story', (j, c) => runStory(j, c));
  registerHandler('script', (j, c) => runScript(j, c));
  registerHandler('cast', (j, c) => runCast(j, c));
  registerHandler('world', (j, c) => runWorld(j, c));
  registerHandler('breakdown', (j, c) => runBreakdown(j, c));
  registerHandler('sound-design', (j, c) => runSoundDesign(j, c));
  registerHandler('dialogue', (j, c) => runDialogueExtract(j, c));
  registerHandler('assembly', (j, c) => runAssemble(j, c));
  registerHandler('edit-plan', (j, c) => runEditPlan(j, c));
  registerHandler('copilot', (j, c) => runCopilot(j, c));

  // export family
  registerHandler('export', (j, c) => runExport(j, c));
  registerHandler('stems', (j, c) => runExport(j, c));
  registerHandler('bundle', (j, c) => runExport(j, c));
}

export const HANDLED_KINDS = [
  'image','video','voice','music','sfx','upscale','lipsync','text','analysis',
  'story','script','cast','world','breakdown','sound-design','dialogue','assembly',
  'edit-plan','copilot','export','stems','bundle'
] as const;
