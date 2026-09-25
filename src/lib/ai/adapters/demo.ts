import type { Capability, AspectRatio } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { ProviderError } from '../types';
import { synthFrame, synthCharacterSheet, frameDims } from '../../media/frame-synth';
import { synth, presetFromPrompt, type SoundPreset } from '../../media/wav';
import { demoStory, demoScript, demoLocations, demoEditPlan, demoReply, buildCast } from '../demo-engine';
import { scenesFromScript, titleCase } from '../../domain/script';

/** Rebuild the demo-engine's scene shape from a persisted Screenplay element list. */
function deriveSceneInfos(meta: Record<string, unknown> | undefined) {
  const sp = meta?.script as { elements?: unknown[] } | undefined;
  if (!sp?.elements?.length) return [];
  const scenes = scenesFromScript(sp as never);
  return scenes.map(sc => ({
    index: sc.index, heading: sc.heading, intExt: sc.intExt,
    location: titleCase(sc.locationName), timeOfDay: titleCase(sc.timeOfDay),
    characters: sc.characterIds, emotion: sc.emotion, lighting: sc.lighting,
    props: sc.props, action: sc.action,
    dialogue: sc.dialogue.split('\n').filter(Boolean).map(line => ({ speaker: 'CHARACTER', line }))
  }));
}
import { hashSeed, rng } from '../../ids';

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ProviderError('Cancelled', { code: 'cancelled', retryable: false })); }, { once: true });
});

/** Progression that feels like a real inference pass without wasting time. */
async function* paced(ctx: ProviderContext, steps: [number, string][], per = 110) {
  for (const [p, s] of steps) {
    if (ctx.signal.aborted) throw new ProviderError('Cancelled', { code: 'cancelled', retryable: false });
    yield { progress: p, stage: s } as ProviderEvent;
    await wait(per, ctx.signal);
  }
}

export const demoAdapter: ProviderAdapter = {
  driver: 'demo',
  capabilities: (): Capability[] => ['text','image','video','voice','music','sound','upscale','editing','vision'],

  estimateCost: () => ({ credits: 0, breakdown: 'Built-in Studio Engine — no provider spend, no credits consumed.' }),

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const seed = req.seed ?? hashSeed(req.prompt || 'demo');
    const base = { modelId: req.modelId, providerId: 'demo', demo: true } as const;

    switch (req.kind) {
      /* ── text ─────────────────────────────────────────────── */
      case 'text': {
        yield* paced(ctx, [[0.15,'Composing'],[0.5,'Structuring'],[0.85,'Polishing']], 90);
        const task = String(req.meta?.task ?? 'general');
        const idea = (req.meta?.idea ?? {}) as never;
        if (task === 'story') {
          const story = demoStory(idea as never, seed);
          return { ...base, ok: true, json: story, text: `${story.title}\n\n${story.logline}\n\n${story.premise}`, usage: { units: 1, unit: 'request' } };
        }
        if (task === 'script') {
          const script = demoScript(req.meta?.story as never, idea as never, seed, Number(req.meta?.sceneCount ?? 6));
          return { ...base, ok: true, json: script, text: script.elements.map(e => e.text).join('\n'), usage: { units: 1, unit: 'request' } };
        }
        if (task === 'characters') {
          const r = rng(seed);
          const cast = buildCast(idea as never, req.meta?.story as never, r);
          return { ...base, ok: true, json: { characters: cast }, text: cast.map(c => `${c.name} — ${c.role}`).join('\n') };
        }
        if (task === 'locations') {
          // Accept either a demo script bundle or a persisted Screenplay.
          const rawScript = req.meta?.script as { scenes?: unknown } | undefined;
          const scriptLike = rawScript && Array.isArray((rawScript as { scenes?: unknown }).scenes)
            ? rawScript
            : { scenes: deriveSceneInfos(req.meta) };
          const locs = demoLocations(scriptLike as never, seed);
          return { ...base, ok: true, json: { locations: locs }, text: locs.map(l => l.name).join('\n') };
        }
        if (task === 'edit-plan') {
          const plan = demoEditPlan(String(req.meta?.command ?? req.prompt), seed);
          return { ...base, ok: true, json: plan, text: plan.summary };
        }
        if (task === 'reply') {
          const reply = demoReply(String(req.meta?.command ?? req.prompt), (req.meta?.ctx ?? { projectName: 'this project', stage: 'idea', counts: {} }) as never, seed);
          return { ...base, ok: true, text: reply, json: { reply } };
        }
        // generic: echo a structured acknowledgement rather than pretending to be an LLM
        const text = `Demo engine received the request.\n\nTask: ${task}\nPrompt: ${req.prompt.slice(0, 400)}\n\nConfigure a text provider in Settings → AI Providers to generate real model output.`;
        return { ...base, ok: true, text, json: { note: 'demo', task } };
      }

      /* ── image ────────────────────────────────────────────── */
      case 'image': {
        const count = Math.max(1, Math.min(8, req.count ?? 1));
        const images = [];
        for (let i = 0; i < count; i++) {
          yield { progress: (i / count) * 0.9, stage: `Rendering plate ${i + 1}/${count}` } as ProviderEvent;
          await wait(120, ctx.signal);
          const s = count === 1 ? seed : seed + i * 7919;
          const isSheet = req.meta?.sheet === 'character';
          const svg = isSheet
            ? synthCharacterSheet(String(req.meta?.name ?? 'Character'), req.prompt, s, '#D99A32')
            : synthFrame({
              seed: s, prompt: req.prompt,
              shotSize: String(req.meta?.shotSize ?? ''), lens: String(req.meta?.lens ?? ''),
              lighting: String(req.meta?.lighting ?? ''), palette: req.meta?.palette as string[] | undefined,
              label: String(req.meta?.label ?? ''), sublabel: String(req.meta?.sublabel ?? ''),
              aspect: (req.aspectRatio ?? '16:9') as AspectRatio,
              characterSilhouette: req.meta?.characterSilhouette !== false
            });
          const dims = frameDims(req.aspectRatio ?? '16:9');
          images.push({ data: new TextEncoder().encode(svg), mime: 'image/svg+xml', seed: s, width: dims.w, height: dims.h, revisedPrompt: req.prompt });
        }
        yield { progress: 1, stage: 'Done' } as ProviderEvent;
        return { ...base, ok: true, images, usage: { units: count, unit: 'image' } };
      }

      /* ── video: real procedural motion plate ──────────────── */
      case 'video': {
        const dur = Math.max(1, Math.min(12, req.durationSec ?? 5));
        const fps = 12;
        const frameCount = Math.max(2, Math.min(24, Math.round(dur * 2)));
        yield* paced(ctx, [[0.1,'Planning motion'],[0.3,'Rendering key plates'],[0.7,'Interpolating'],[0.9,'Encoding']], 140);
        const images = [];
        for (let i = 0; i < frameCount; i++) {
          const s = seed + i * 104729;
          const svg = synthFrame({
            seed: s, prompt: req.prompt, shotSize: String(req.meta?.shotSize ?? ''),
            lens: String(req.meta?.lens ?? ''), lighting: String(req.meta?.lighting ?? ''),
            label: String(req.meta?.label ?? ''), sublabel: `t=${(i / frameCount * dur).toFixed(1)}s`,
            aspect: (req.aspectRatio ?? '16:9') as AspectRatio, demoBadge: i === 0
          });
          const dims = frameDims(req.aspectRatio ?? '16:9');
          images.push({ data: new TextEncoder().encode(svg), mime: 'image/svg+xml', seed: s, width: dims.w, height: dims.h });
        }
        const move = (req.camera ?? 'Slow Push') as never;
        const zoomIn = /in|push|zoom in/i.test(String(move));
        return {
          ...base, ok: true, images,
          video: [{
            durationSec: dur, mime: 'application/x-demo-motion',
            motion: {
              kind: 'demo-motion', frames: [], fps, move,
              zoomFrom: zoomIn ? 1.0 : 1.14, zoomTo: zoomIn ? 1.14 : 1.0,
              panX: /left|truck left|pan left/i.test(String(move)) ? -0.05 : /right|truck|pan right/i.test(String(move)) ? 0.05 : 0,
              panY: /up|crane/i.test(String(move)) ? -0.04 : /down/i.test(String(move)) ? 0.04 : 0,
              label: String(req.meta?.label ?? 'DEMO MOTION PLATE')
            }
          }],
          usage: { units: dur, unit: 'second' }
        };
      }

      /* ── voice: honest scratch track ──────────────────────── */
      case 'voice': {
        yield* paced(ctx, [[0.3,'Timing syllables'],[0.7,'Rendering scratch take']], 120);
        const words = (req.prompt || '').split(/\s+/).filter(Boolean).slice(0, 40);
        const est = Math.max(1.2, Math.min(30, words.length * 0.34 * (1 / (req.voice?.speed ?? 1))));
        const data = synth('scratch-voice', est, { seed, words, pitch: 1 + (req.voice?.pitch ?? 0) / 12 });
        return {
          ...base, ok: true,
          audio: [{ data: new Uint8Array(data), mime: 'audio/wav', durationSec: est, label: 'scratch take (timing reference, not speech)', scratch: true }],
          text: req.prompt, usage: { units: 1, unit: 'line' }
        };
      }

      /* ── music / sfx: real DSP ────────────────────────────── */
      case 'music': case 'sfx': {
        yield* paced(ctx, [[0.25,'Analysing cue'],[0.6,'Synthesising'],[0.9,'Mastering']], 130);
        const dur = Math.max(2, Math.min(120, req.durationSec ?? (req.kind === 'music' ? 30 : 4)));
        const preset = (String(req.meta?.preset ?? '') || presetFromPrompt(req.prompt)) as SoundPreset;
        const data = synth(preset, dur, {
          seed, intensity: req.audio?.intensity ?? 1, bpm: req.audio?.bpm,
          words: req.audio?.words
        });
        return {
          ...base, ok: true,
          audio: [{ data: new Uint8Array(data), mime: 'audio/wav', durationSec: dur, label: preset }],
          usage: { units: dur, unit: 'second' }
        };
      }

      /* ── upscale: vector sources upscale losslessly ───────── */
      case 'upscale': {
        yield* paced(ctx, [[0.4,'Resampling'],[0.9,'Sharpening']], 100);
        const ref = req.referenceImages?.[0] ?? req.startFrame;
        if (!ref) throw new ProviderError('Upscale needs a source image', { code: 'missing_input', suggestion: 'Attach a reference image first.' });
        const got = await ctx.fetchRef(ref);
        if (!got) throw new ProviderError('Source image could not be read', { code: 'input_unreadable', retryable: true });
        const factor = req.upscale?.factor ?? 2;
        let mime = got.mime; let data = got.data;
        if (got.mime === 'image/svg+xml') {
          const svg = new TextDecoder().decode(got.data);
          data = new TextEncoder().encode(svg.replace(/<svg([^>]*)>/, (m, attrs) => {
            const bumped = attrs
              .replace(/width="(\d+)"/, (_: string, n: string) => `width="${Number(n) * factor}"`)
              .replace(/height="(\d+)"/, (_: string, n: string) => `height="${Number(n) * factor}"`);
            return `<svg${bumped}>`;
          }));
        } else {
          // Raster sources: return the source untouched rather than claim a fake upscale.
          ctx.log('warn', `Demo engine cannot truly upscale ${got.mime}; configure an upscale model (Real-ESRGAN / ComfyUI) for raster sources.`);
        }
        return { ...base, ok: true, images: [{ data, mime, seed, width: undefined, height: undefined }], usage: { units: 1, unit: 'image' } };
      }

      default:
        throw new ProviderError(`The demo engine does not implement "${req.kind}"`, {
          code: 'unsupported_kind', retryable: false,
          suggestion: `Configure a provider that supports ${req.kind} in Settings → AI Providers.`
        });
    }
  },

  async testConnection() {
    return { ok: true, message: 'Demo engine is always available — no API key required.', detail: 'offline' };
  }
};
