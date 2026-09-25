import type { Capability, AspectRatio, Resolution } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { ProviderError } from '../types';
import { http, httpBytes, b64, unb64 } from './http';
import { classifyHttpError } from '../types';

/**
 * OpenAI-compatible adapter.
 *
 * Covers OpenAI, Azure OpenAI, Together, Groq, DeepInfra, OpenRouter, vLLM,
 * Ollama (`/v1`) and LM Studio — anything speaking chat/completions. The base
 * URL is the only thing that changes, so local and hosted models share one
 * code path and one UI.
 */

function imageSize(ratio: AspectRatio = '16:9', res: Resolution = '1080p'): string {
  const tall = ratio === '9:16' || ratio === '4:5';
  const square = ratio === '1:1';
  const big = res === '1440p' || res === '4k';
  if (square) return big ? '1536x1536' : '1024x1024';
  if (tall) return big ? '1024x1792' : '1024x1536';
  return big ? '1792x1024' : '1536x1024';
}

async function toDataUrl(ctx: ProviderContext, ref: { key?: string; url?: string; dataUrl?: string; mime?: string }) {
  if (ref.dataUrl) return ref.dataUrl;
  const got = await ctx.fetchRef(ref as never);
  if (!got) throw new ProviderError('Reference image could not be read', { code: 'input_unreadable', retryable: true });
  return `data:${got.mime};base64,${b64(got.data)}`;
}

export const openaiCompatible: ProviderAdapter = {
  driver: 'openai-compatible',
  capabilities: (): Capability[] => ['text','image','voice','vision','editing'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 1;
    if (req.kind === 'image') return { credits: Math.round(cost * (req.count ?? 1) * 100) / 100, breakdown: `${req.count ?? 1} image(s) @ ${cost} credits` };
    if (req.kind === 'voice') {
      const chars = (req.prompt || '').length;
      return { credits: Math.round(cost * chars / 1000 * 100) / 100, breakdown: `${chars} chars @ ${cost} credits/1k` };
    }
    const tokens = Math.ceil(((req.prompt?.length ?? 0) + (req.text?.system?.length ?? 0)) / 4) + 800;
    return { credits: Math.round(cost * tokens / 1000 * 100) / 100, breakdown: `~${tokens} tokens @ ${cost} credits/1k` };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const base = (ctx.baseUrl || '').replace(/\/$/, '');
    if (!base) throw new ProviderError('This provider needs a Base URL', { code: 'config', suggestion: 'Set the Base URL in Settings → AI Providers (e.g. https://api.openai.com/v1).' });
    const headers: Record<string, string> = { ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}) };
    const common = { modelId: req.modelId, providerId: String(req.meta?.providerId ?? 'openai'), demo: false };

    if (req.kind === 'image') {
      yield { progress: 0.1, stage: 'Submitting image request' } as ProviderEvent;
      const count = Math.max(1, Math.min(8, req.count ?? 1));
      const body: Record<string, unknown> = {
        model: req.modelId.startsWith('dall') || req.modelId.includes('gpt-image') ? req.modelId : 'gpt-image-1',
        prompt: req.prompt, n: count, size: imageSize(req.aspectRatio, req.resolution), quality: 'high',
        response_format: 'b64_json'
      };
      if (req.negativePrompt) body.prompt = `${req.prompt}\n\nAvoid: ${req.negativePrompt}`;
      if (req.seed != null) body.seed = req.seed;
      const refs = req.referenceImages ?? [];
      if (refs.length) {
        // gpt-image-1 accepts multipart image edits; fall back to prompt-embedded refs
        body.image = [];
        for (const r of refs.slice(0, 4)) (body.image as unknown[]).push(await toDataUrl(ctx, r));
      }
      let res = await http(`${base}/images/generations`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: ctx.signal, timeoutMs: 300_000
      });
      if (res.status >= 400) {
        // Some gateways reject `response_format` (gpt-image-1 always returns b64).
        const retryBody = { ...body }; delete retryBody.response_format;
        const retry = await http(`${base}/images/generations`, {
          method: 'POST', headers, signal: ctx.signal, timeoutMs: 300_000, body: JSON.stringify(retryBody)
        });
        if (retry.status >= 400) throw classifyHttpError(res.status, res.raw);
        res = retry;
      }
      yield { progress: 0.85, stage: 'Decoding' } as ProviderEvent;
      const data = res.body?.data ?? [];
      const images = data.map((d: any, i: number) => {
        const bytes = d.b64_json ? unb64(d.b64_json) : null;
        return bytes
          ? { data: bytes, mime: 'image/png', seed: (req.seed ?? 0) + i, revisedPrompt: d.revised_prompt }
          : { url: d.url, mime: 'image/png', seed: (req.seed ?? 0) + i, revisedPrompt: d.revised_prompt };
      });
      const resolved = [];
      for (const im of images) {
        if ((im as any).data) { resolved.push(im); continue; }
        const dl = await httpBytes((im as any).url, { signal: ctx.signal });
        resolved.push({ data: dl.data, mime: dl.mime, seed: im.seed, revisedPrompt: (im as any).revisedPrompt });
      }
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, ok: true, images: resolved, usage: { units: resolved.length, unit: 'image' } };
    }

    if (req.kind === 'voice') {
      yield { progress: 0.2, stage: 'Synthesising speech' } as ProviderEvent;
      const voice = req.voice?.voiceId && !/^(auto|default|narrator)$/i.test(req.voice.voiceId) ? req.voice.voiceId : 'alloy';
      const instructions = req.voice?.emotion && req.voice.emotion !== 'neutral'
        ? `Read this in a ${req.voice.emotion} tone. Speaking rate ${Math.round((req.voice?.speed ?? 1) * 100)}%.`
        : undefined;
      const body: Record<string, unknown> = { model: req.modelId, input: req.prompt, voice, response_format: 'mp3', speed: req.voice?.speed ?? 1 };
      if (instructions) body.instructions = instructions;
      const res = await fetch(`${base}/audio/speech`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: ctx.signal
      });
      if (res.status >= 400) throw classifyHttpError(res.status, (await res.text()).slice(0, 400));
      const mime = res.headers.get('content-type') ?? 'audio/mpeg';
      const bytes = new Uint8Array(await res.arrayBuffer());
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      const dur = Math.max(0.5, (req.prompt.length / 15) / (req.voice?.speed ?? 1));
      return { ...common, ok: true, audio: [{ data: bytes, mime, durationSec: dur }], usage: { units: req.prompt.length / 1000, unit: '1k chars' } };
    }

    // text / vision / editing → chat completions
    yield { progress: 0.15, stage: 'Sending to model' } as ProviderEvent;
    const msgs: any[] = [];
    if (req.text?.system) msgs.push({ role: 'system', content: req.text.system });
    const content: any[] = [{ type: 'text', text: req.prompt }];
    const refs = req.referenceImages ?? [];
    for (const r of refs.slice(0, 6)) content.push({ type: 'image_url', image_url: { url: await toDataUrl(ctx, r) } });
    msgs.push({ role: 'user', content: refs.length ? content : req.prompt });
    if (Array.isArray(req.meta?.history)) for (const m of req.meta.history as any[]) msgs.splice(msgs.length - 1, 0, m);

    const body: Record<string, unknown> = {
      model: req.modelId, messages: msgs,
      temperature: req.text?.temperature ?? 0.8,
      max_tokens: req.text?.maxTokens ?? 4000
    };
    if (req.text?.responseFormat === 'json') body.response_format = { type: 'json_object' };
    if (req.seed != null) body.seed = req.seed;

    let res = await http(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctx.signal, timeoutMs: 300_000 });
    if (res.status === 402 && Number(body.max_tokens) > 400 && isTokenBudgetError(res.raw)) {
      body.max_tokens = 400;
      res = await http(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: ctx.signal, timeoutMs: 300_000 });
    }
    if (res.status >= 400) throw classifyHttpError(res.status, res.raw);
    const text: string = res.body?.choices?.[0]?.message?.content ?? '';
    yield { progress: 1, stage: 'Done' } as ProviderEvent;
    let json: unknown;
    if (req.text?.responseFormat === 'json') json = safeParse(text);
    return {
      ...common, ok: true, text, json,
      usage: { inputTokens: res.body?.usage?.prompt_tokens, outputTokens: res.body?.usage?.completion_tokens, units: ((res.body?.usage?.total_tokens ?? 1000) / 1000), unit: '1k tokens' }
    };
  },

  async testConnection(ctx) {
    const base = (ctx.baseUrl || '').replace(/\/$/, '');
    if (!base) return { ok: false, message: 'No Base URL configured' };
    const res = await http(`${base}/models`, { headers: ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}, signal: ctx.signal, timeoutMs: 20_000 });
    if (res.status < 400) {
      const n = Array.isArray(res.body?.data) ? res.body.data.length : 0;
      return { ok: true, message: `Connected${n ? ` — ${n} models visible` : ''}`, detail: base };
    }
    // /models may be blocked on some gateways; a tiny chat call is a better probe
    const probe = await http(`${base}/chat/completions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}) },
      body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }), signal: ctx.signal, timeoutMs: 20_000
    });
    return probe.status < 400
      ? { ok: true, message: 'Connected', detail: base }
      : { ok: false, message: `HTTP ${probe.status}`, detail: probe.raw.slice(0, 300) };
  }
};

function isTokenBudgetError(raw: string): boolean {
  return /max_tokens|fewer max|can only afford|requested up to/i.test(raw);
}

function safeParse(t: string): unknown {
  try { return JSON.parse(t); } catch {
    const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch { return undefined; } }
    return undefined;
  }
}
