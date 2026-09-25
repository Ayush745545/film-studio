import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { resolveCredential } from '@/lib/ai/credentials';
import { canonicalDriver } from '@/lib/ai/adapters';
import type { Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const GET = api(async ({ user, params }) => {
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(params.id) as unknown as Provider | null;
  if (!provider) throw notFound('Provider not found');

  const cred = await resolveCredential(provider, user.id);
  const driver = canonicalDriver(provider.driver);
  const defaultBase = driver === 'anthropic' ? 'https://api.anthropic.com' : '';
  const base = (cred.baseUrl ?? provider.baseUrl ?? defaultBase).replace(/\/$/, '');
  if (!base) return { models: [], error: 'No base URL configured' };
  if (!/^https?:\/\//i.test(base)) return { models: [], error: 'Base URL must start with http:// or https://' };

  try {
    let models: { id: string; name: string; capabilities?: string[]; owned_by?: string }[] = [];

    if (driver === 'openai-compatible') {
      const res = await fetch(`${base}/models`, {
        headers: cred.apiKey ? { authorization: `Bearer ${cred.apiKey}` } : {},
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return { models: [], error: `Model discovery failed (HTTP ${res.status})` };
      const data = await res.json();
      models = data.data?.map((m: { id: string; owned_by?: string }) => ({
        id: m.id,
        name: m.id,
        capabilities: inferCapabilities(m.id, provider.driver),
        owned_by: m.owned_by
      })) ?? [];
    } else if (driver === 'anthropic') {
      const res = await fetch(`${base}/v1/models`, {
        headers: { 'x-api-key': cred.apiKey ?? '', 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return { models: [], error: `Model discovery failed (HTTP ${res.status})` };
      const data = await res.json();
      models = data.data?.map((m: { id: string; display_name?: string }) => ({
        id: m.id,
        name: m.display_name ?? m.id,
        capabilities: inferCapabilities(m.id, provider.driver)
      })) ?? [];
    } else if (driver === 'comfyui') {
      const res = await fetch(`${base}/object_info`, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return { models: [], error: `ComfyUI discovery failed (HTTP ${res.status})` };
      const data = await res.json();
      models = Object.keys(data).filter(key =>
        key.toLowerCase().includes('checkpoint') ||
        key.toLowerCase().includes('load') ||
        key.toLowerCase().includes('model')
      ).map(id => ({
        id,
        name: id.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase()),
        capabilities: ['image', 'video']
      }));
    } else if (driver === 'replicate') {
      const res = await fetch(`${base}/models`, {
        headers: cred.apiKey ? { authorization: `Token ${cred.apiKey}` } : {},
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return { models: [], error: `Model discovery failed (HTTP ${res.status})` };
      const data = await res.json();
      models = data.results?.map((m: { name: string; owner?: string }) => ({
        id: m.name,
        name: m.name,
        capabilities: inferCapabilities(m.name, provider.driver),
        owned_by: m.owner
      })) ?? [];
    } else if (driver === 'elevenlabs') {
      const res = await fetch(`${base}/v1/voices`, {
        headers: cred.apiKey ? { 'xi-api-key': cred.apiKey } : {},
        signal: AbortSignal.timeout(15_000)
      });
      if (!res.ok) return { models: [], error: `Voice discovery failed (HTTP ${res.status})` };
      const data = await res.json();
      models = data.voices?.map((voice: { voice_id: string; name: string; category?: string }) => ({
        id: voice.voice_id,
        name: voice.name,
        capabilities: ['voice'],
        owned_by: voice.category
      })) ?? [];
    }

    return { models, provider: { id: provider.id, name: provider.name, driver: provider.driver, baseUrl: provider.baseUrl } };
  } catch (err) {
    return { models: [], error: (err as Error).message };
  }
});

function inferCapabilities(modelId: string, driver: string): string[] {
  const id = modelId.toLowerCase();
  const caps: string[] = [];

  // Text/LLM models
  if (id.includes('llama') || id.includes('qwen') || id.includes('mistral') || 
      id.includes('phi') || id.includes('gemma') || id.includes('gpt') ||
      id.includes('claude') || id.includes('gemini') || id.includes('deepseek') || id.includes('grok') ||
      id.includes('command') || id.includes('vicuna') ||
      id.includes('alpaca') || id.includes('hermes') || id.includes('chat') ||
      id.includes('instruct') || id.includes('code') || driver === 'ollama' || driver === 'lmstudio') {
    caps.push('text');
  }

  // Image models
  if (id.includes('flux') || id.includes('stable-diffusion') || id.includes('sdxl') ||
      id.includes('midjourney') || id.includes('dall-e') || id.includes('dalle') ||
      id.includes('gpt-image') || id.includes('imagen') || id.includes('kandinsky') ||
      id.includes('playground') || id.includes('kling') || id.includes('wan') ||
      id.includes('video') || id.includes('sora') || id.includes('veo') || id.includes('hunyuan')) {
    if (id.includes('video') || id.includes('kling') || id.includes('wan') || id.includes('veo') || id.includes('hunyuan') || id.includes('sora')) {
      caps.push('video');
    } else {
      caps.push('image');
    }
  }

  // Voice models
  if (id.includes('voice') || id.includes('tts') || id.includes('eleven') || id.includes('speech') ||
      id.includes('parler') || id.includes('bark') || id.includes('vits') || id.includes('xtts')) {
    caps.push('voice');
  }

  // Music
  if (id.includes('music') || id.includes('audio') || id.includes('suno') || id.includes('udio') || id.includes('stable-audio')) {
    caps.push('music');
  }

  // Sound effects
  if (id.includes('sfx') || id.includes('sound') || id.includes('effect') || id.includes('foley')) {
    caps.push('sound');
  }

  // Upscaling
  if (id.includes('upscale') || id.includes('esrgan') || id.includes('realesrgan') || id.includes('swinir') || id.includes('4x')) {
    caps.push('upscale');
  }

  // Lip sync
  if (id.includes('lip') || id.includes('sync') || id.includes('wav2lip') || id.includes('latentsync')) {
    caps.push('lipsync');
  }

  // Vision
  if (id.includes('vision') || id.includes('clip') || id.includes('llava') || id.includes('blip') || id.includes('vl') || id.includes('gemini')) {
    caps.push('vision');
  }

  // Editing
  if (id.includes('edit') || id.includes('inpaint') || id.includes('controlnet') || id.includes('depth') || id.includes('canny')) {
    caps.push('editing');
  }

  // Default to text for local LLMs
  if (driver === 'ollama' || driver === 'lmstudio') {
    if (!caps.length) caps.push('text');
  }

  return caps.length ? caps : ['text'];
}