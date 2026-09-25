import { getDb } from '../db';
import { PROVIDERS, MODELS } from './registry';
import { nowIso, uid } from '../ids';
import type { ModelPreset, Provider, ModelDescriptor } from '@/types';

/**
 * Idempotent registry seeding.
 *
 * The catalogue lives in code (so it is versioned and reviewable) but is
 * mirrored into the database at boot, where users can then edit, disable,
 * re-price or extend it. Seeding never overwrites a user edit.
 */
const gseed = globalThis as unknown as { afsSeedDone?: boolean; afsSeedInflight?: Promise<void> };

export function seedRegistry(): Promise<void> {
  if (gseed.afsSeedDone) return Promise.resolve();
  if (gseed.afsSeedInflight) return gseed.afsSeedInflight;
  const inflight = (async () => {
    try {
      const db = await getDb();
      const providers = db.repo('providers');
      const models = db.repo('models');
      const presets = db.repo('presets');

      for (const p of PROVIDERS) {
        const existing = await providers.findUnique(p.id) as unknown as Provider | null;
        if (!existing) {
          await providers.create({
            id: p.id, name: p.name, driver: p.driver, baseUrl: p.baseUrl, enabled: true,
            builtIn: true, capabilities: p.capabilities, docsUrl: p.docsUrl, envKeyVar: p.envKeyVar,
            notes: p.notes, priority: p.priority, createdAt: nowIso()
          } as never);
        } else {
          // refresh catalogue metadata but keep user-controlled fields
          await providers.update(p.id, {
            name: p.name, driver: p.driver, capabilities: p.capabilities,
            docsUrl: p.docsUrl, envKeyVar: p.envKeyVar, notes: p.notes
          } as never);
        }
      }

      for (const m of MODELS) {
        const existing = await models.findUnique(m.id) as unknown as ModelDescriptor | null;
        const row = {
          id: m.id, providerId: m.providerId, name: m.name, driverModel: m.driverModel,
          capabilities: m.capabilities, kind: m.kind, quality: m.quality, speed: m.speed,
          costPerUnit: m.costPerUnit, unit: m.unit,
          contextWindow: m.contextWindow ?? null, maxDurationSec: m.maxDurationSec ?? null,
          supportedRatios: m.ratios ?? [], supportedResolutions: m.resolutions ?? [],
          features: m.features ?? [], demo: Boolean(m.demo), custom: false, config: m.config ?? {}
        };
        if (!existing) {
          await models.create({ ...row, enabled: m.enabled !== false, isDefault: false, createdAt: nowIso() } as never);
        } else {
          await models.update(m.id, {
            name: row.name, driverModel: row.driverModel, capabilities: row.capabilities, kind: row.kind,
            quality: row.quality, speed: row.speed, unit: row.unit,
            contextWindow: row.contextWindow, maxDurationSec: row.maxDurationSec,
            supportedRatios: row.supportedRatios, supportedResolutions: row.supportedResolutions,
            features: row.features, demo: row.demo, config: row.config
          } as never);
        }
      }

      // One default per capability so the router always has an explicit answer.
      const defaults: [string, string][] = [
        ['text', 'claude-sonnet-4-5'], ['image', 'demo-image'], ['video', 'demo-video'],
        ['voice', 'demo-voice'], ['music', 'demo-music'], ['sfx', 'demo-sfx'], ['upscale', 'demo-upscale']
      ];
      for (const [, modelId] of defaults) {
        const m = await models.findUnique(modelId) as unknown as ModelDescriptor | null;
        if (m && !m.isDefault) {
          const sameKind = await models.findMany({ where: { kind: m.kind } }) as unknown as ModelDescriptor[];
          for (const s of sameKind) if (s.isDefault) await models.update(s.id, { isDefault: false } as never);
          await models.update(modelId, { isDefault: true } as never);
        }
      }

      await seedPresets(presets as never);
      gseed.afsSeedDone = true;
      console.log(`[ai] registry seeded: ${PROVIDERS.length} providers, ${MODELS.length} models`);
    } catch (err) {
      console.warn('[ai] registry seed failed:', (err as Error).message);
    } finally { gseed.afsSeedInflight = undefined; }
  })();
  gseed.afsSeedInflight = inflight;
  return inflight;
}

const BUILTIN_PRESETS: Omit<ModelPreset, 'id' | 'createdAt'>[] = [
  {
    userId: null, name: 'Cinematic Pro', description: 'Best available quality at every stage. Prefers real providers, falls back to demo only when nothing is configured.',
    builtIn: true, textModel: 'claude-sonnet-4-5', imageModel: 'rep-flux-1-1-pro', videoModel: 'rep-kling-2-1',
    voiceModel: 'el-multilingual-v2', musicModel: 'el-music', soundModel: 'el-sfx', upscaleModel: 'rep-realesrgan',
    editingModel: 'claude-opus-4-1', strategy: 'quality',
    defaults: { resolution: '1080p', aspectRatio: '2.39:1', fps: 24, steps: 32, guidance: 5.5, motion: 'Cinematic' },
    fallbacks: { image: ['fal-flux-pro', 'gpt-image-1', 'demo-image'], video: ['fal-kling', 'rep-hunyuan-video', 'demo-video'], text: ['gpt-4-1', 'demo-text'], voice: ['fal-playai-tts', 'openai-tts-hd', 'demo-voice'] }
  },
  {
    userId: null, name: 'Fast Social', description: 'Optimised for turnaround: vertical 9:16, 720p, cheap and quick models, minimal steps.',
    builtIn: true, textModel: 'claude-haiku-4-5', imageModel: 'rep-sdxl', videoModel: 'fal-wan',
    voiceModel: 'openai-tts', musicModel: 'demo-music', soundModel: 'demo-sfx', upscaleModel: null,
    editingModel: 'gpt-4o-mini', strategy: 'speed',
    defaults: { resolution: '720p', aspectRatio: '9:16', fps: 30, steps: 20, guidance: 6, motion: 'Dynamic' },
    fallbacks: { image: ['demo-image'], video: ['demo-video'], text: ['demo-text'] }
  },
  {
    userId: null, name: 'High Quality', description: 'Maximum fidelity for hero frames and masters. Slowest and most expensive.',
    builtIn: true, textModel: 'claude-opus-4-1', imageModel: 'fal-flux-pro', videoModel: 'rep-veo-3',
    voiceModel: 'el-multilingual-v2', musicModel: 'el-music', soundModel: 'el-sfx', upscaleModel: 'fal-esrgan',
    editingModel: 'claude-opus-4-1', strategy: 'quality',
    defaults: { resolution: '4k', aspectRatio: '16:9', fps: 24, steps: 40, guidance: 6, motion: 'Cinematic' },
    fallbacks: { image: ['rep-flux-1-1-pro'], video: ['rep-kling-2-1'] }
  },
  {
    userId: null, name: 'Local Models', description: 'Everything runs on your own hardware: Ollama/LM Studio for text, ComfyUI for image and video. Zero provider spend.',
    builtIn: true, textModel: 'ollama-qwen', imageModel: 'comfy-image', videoModel: 'comfy-video',
    voiceModel: 'demo-voice', musicModel: 'demo-music', soundModel: 'demo-sfx', upscaleModel: 'comfy-upscale',
    editingModel: 'ollama-llama31', strategy: 'explicit',
    defaults: { resolution: '1080p', aspectRatio: '16:9', fps: 24, steps: 28, guidance: 6.5, motion: 'Cinematic' },
    fallbacks: { text: ['lms-local', 'ollama-llama31'], image: ['demo-image'], video: ['demo-video'] }
  },
  {
    userId: null, name: 'Studio Engine (offline)', description: 'Built-in engine only. Renders real previsualisation media with zero spend — for previs, pipeline testing and evaluation.',
    builtIn: true, textModel: 'demo-text', imageModel: 'demo-image', videoModel: 'demo-video',
    voiceModel: 'demo-voice', musicModel: 'demo-music', soundModel: 'demo-sfx', upscaleModel: 'demo-upscale',
    editingModel: 'demo-text', strategy: 'explicit',
    defaults: { resolution: '1080p', aspectRatio: '16:9', fps: 24, steps: 24, guidance: 6, motion: 'Cinematic' },
    fallbacks: {}
  },
  {
    userId: null, name: 'Custom', description: 'Choose every model yourself. Nothing is preselected.',
    builtIn: true, textModel: null, imageModel: null, videoModel: null, voiceModel: null,
    musicModel: null, soundModel: null, upscaleModel: null, editingModel: null, strategy: 'explicit',
    defaults: { resolution: '1080p', aspectRatio: '16:9', fps: 24 }, fallbacks: {}
  }
];

async function seedPresets(presets: { findFirst(q: unknown): Promise<unknown>; create(d: never): Promise<unknown> }) {
  for (const p of BUILTIN_PRESETS) {
    const existing = await presets.findFirst({ where: { name: p.name, builtIn: true } });
    if (!existing) await presets.create({ ...p, id: uid('preset'), createdAt: nowIso() } as never);
  }
}

export const BUILTIN_PRESET_NAMES = BUILTIN_PRESETS.map(p => p.name);
