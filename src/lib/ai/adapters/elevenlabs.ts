import type { Capability } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http } from './http';

/** ElevenLabs — dialogue voices with emotion control, text-to-SFX and music. */
const API = 'https://api.elevenlabs.io';

/** Curated defaults; the real list is fetched by /api/providers/elevenlabs/voices. */
export const DEFAULT_VOICES = [
  { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'female', accent: 'American' },
  { id: '9bwtsMNqrJYKihSjYgCn', name: 'Dorothy', gender: 'female', accent: 'British' },
  { id: 'JBFqnCBsd6RMkjVDRZzb', name: 'George', gender: 'male', accent: 'British' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', gender: 'male', accent: 'British' },
  { id: 'XB0fDUnXU5powFXDhCwa', name: 'Charlotte', gender: 'female', accent: 'American' },
  { id: 'XrExE9yKIg1WjnnlVkGX', name: 'Matilda', gender: 'female', accent: 'American' },
  { id: 'cgSgspJ2msm6clMCkdW9', name: 'Jessica', gender: 'female', accent: 'American' },
  { id: 'iP95p4xoKVk53GoZ742B', name: 'Chris', gender: 'male', accent: 'American' },
  { id: 'nPbnSzQBKXpJqNpJqNpJ', name: 'Narrator (deep)', gender: 'male', accent: 'American' }
];

export const elevenlabs: ProviderAdapter = {
  driver: 'elevenlabs',
  capabilities: (): Capability[] => ['voice', 'sound', 'music'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 2;
    if (req.kind === 'sfx' || req.kind === 'music') {
      return { credits: cost, breakdown: `1 ${req.kind} cue @ ${cost} credits` };
    }
    return { credits: Math.round(cost * req.prompt.length / 1000 * 100) / 100, breakdown: `${req.prompt.length} chars @ ${cost} credits/1k` };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const base = (ctx.baseUrl || API).replace(/\/$/, '');
    if (!ctx.apiKey) throw new ProviderError('ElevenLabs API key is missing', { code: 'unauthorized', suggestion: 'Add ELEVENLABS_API_KEY in Settings → AI Providers.' });
    const headers = { 'xi-api-key': ctx.apiKey, 'content-type': 'application/json', accept: 'application/json' };
    const common = { ok: true as const, modelId: req.modelId, providerId: 'elevenlabs', demo: false };

    if (req.kind === 'sfx') {
      yield { progress: 0.2, stage: 'Generating sound effect' } as ProviderEvent;
      const dur = Math.max(0.5, Math.min(30, req.durationSec ?? 4));
      const res = await fetch(`${base}/v1/sound-generation`, {
        method: 'POST', headers, signal: ctx.signal,
        body: JSON.stringify({ text: req.prompt, duration_seconds: dur, prompt_influence: 0.3 })
      });
      if (res.status >= 400) throw classifyHttpError(res.status, (await res.text()).slice(0, 400));
      const data = new Uint8Array(await res.arrayBuffer());
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, audio: [{ data, mime: 'audio/mpeg', durationSec: dur, label: req.prompt.slice(0, 40) }], usage: { units: 1, unit: 'cue' } };
    }

    if (req.kind === 'music') {
      yield { progress: 0.2, stage: 'Generating music' } as ProviderEvent;
      const ms = Math.max(10_000, Math.min(120_000, (req.durationSec ?? 30) * 1000));
      const res = await fetch(`${base}/v1/music/generate?music_length_ms=${Math.round(ms)}`, {
        method: 'POST', headers, signal: ctx.signal,
        body: JSON.stringify({ prompt: req.prompt })
      });
      if (res.status >= 400) throw classifyHttpError(res.status, (await res.text()).slice(0, 400));
      const data = new Uint8Array(await res.arrayBuffer());
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, audio: [{ data, mime: 'audio/mpeg', durationSec: ms / 1000 }], usage: { units: 1, unit: 'track' } };
    }

    // voice
    const voiceId = resolveVoice(req.voice?.voiceId);
    yield { progress: 0.15, stage: `Synthesising with ${voiceId.slice(0, 8)}…` } as ProviderEvent;
    const modelId = req.meta?.driverModel as string ?? req.modelId;
    const body: Record<string, unknown> = {
      text: req.prompt, model_id: modelId,
      voice_settings: {
        stability: clamp01(req.voice?.stability ?? 0.55),
        similarity_boost: clamp01(req.voice?.clarity ?? 0.78),
        style: clamp01(emotionToStyle(req.voice?.emotion)),
        use_speaker_boost: true,
        speed: Math.max(0.7, Math.min(1.2, req.voice?.speed ?? 1))
      }
    };
    if (req.voice?.language) body.language_code = req.voice.language;

    const res = await fetch(`${base}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: 'POST', headers, signal: ctx.signal, body: JSON.stringify(body)
    });
    if (res.status >= 400) throw classifyHttpError(res.status, (await res.text()).slice(0, 400));
    const data = new Uint8Array(await res.arrayBuffer());
    const dur = Math.max(0.6, req.prompt.length / 15 / (req.voice?.speed ?? 1));
    yield { progress: 1, stage: 'Done' } as ProviderEvent;
    return { ...common, audio: [{ data, mime: 'audio/mpeg', durationSec: dur }], text: req.prompt, usage: { units: req.prompt.length / 1000, unit: '1k chars' } };
  },

  async testConnection(ctx) {
    const r = await http(`${(ctx.baseUrl || API).replace(/\/$/, '')}/v1/user/subscription`, { headers: { 'xi-api-key': ctx.apiKey ?? '' }, signal: ctx.signal, timeoutMs: 20_000 });
    if (r.status < 400) {
      const tier = r.body?.tier ?? 'unknown';
      return { ok: true, message: `Connected — ${tier} tier`, detail: `character limit ${r.body?.character_limit ?? '?'}` };
    }
    return { ok: false, message: `HTTP ${r.status}`, detail: r.raw.slice(0, 300) };
  }
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, Number.isFinite(n) ? n : 0.5));
function resolveVoice(v?: string): string {
  if (!v) return DEFAULT_VOICES[0].id;
  const hit = DEFAULT_VOICES.find(x => x.id === v || x.name.toLowerCase() === v.toLowerCase());
  return hit?.id ?? (/^[A-Za-z0-9]{16,}$/.test(v) ? v : DEFAULT_VOICES[0].id);
}
function emotionToStyle(e?: string): number {
  if (!e) return 0;
  const t = e.toLowerCase();
  if (/fury|angry|rage/.test(t)) return 0.85;
  if (/dread|fear|anxious|terror/.test(t)) return 0.7;
  if (/grief|sad|mourn/.test(t)) return 0.65;
  if (/wonder|awe|excited|joy/.test(t)) return 0.75;
  if (/tender|warm|love/.test(t)) return 0.55;
  if (/flat|neutral|clinical/.test(t)) return 0.1;
  return 0.4;
}
