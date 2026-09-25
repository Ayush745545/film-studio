import type { Capability } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http, httpBytes, template, getPath, poll, b64, unb64 } from './http';

/**
 * Generic configurable HTTP adapter.
 *
 * Lets a user wire up *any* REST API (a studio's in-house inference service,
 * a self-hosted diffusers server, a paid gateway we don't ship) without a code
 * change. The model's `config` declares URL, headers, body template and where
 * to read results from.
 *
 * config = {
 *   method: 'POST',
 *   url: '{{baseUrl}}/v1/generate',            // or `path` appended to baseUrl
 *   headers: { 'X-Api-Key': '{{apiKey}}' },
 *   body: '{"prompt":"{{prompt}}","seed":{{seed}},"w":{{width}}}',  // string or object
 *   async: false,
 *   result: {
 *     jobIdPath: 'id',
 *     statusUrl: '{{baseUrl}}/v1/status/{{jobId}}',
 *     statusPath: 'state', doneValue: 'done', failedValue: 'error',
 *     progressPath: 'percent',
 *     imagePath: 'artifacts[0].b64', imageUrlPath: 'artifacts[0].url',
 *     textPath: 'output.text', jsonPath: 'output.data',
 *     audioPath: 'audio.url', videoPath: 'video.url', errorPath: 'message'
 *   }
 * }
 */
function parseConfig(req: GenerationRequest): Record<string, any> {
  return ((req.meta?.modelConfig as Record<string, any>) ?? {}) as Record<string, any>;
}

export const customHttp: ProviderAdapter = {
  driver: 'custom-http',
  capabilities: (): Capability[] => ['text', 'image', 'video', 'voice', 'music', 'sound', 'upscale'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 0;
    const n = req.kind === 'video' ? (req.durationSec ?? 5) : (req.count ?? 1);
    return { credits: Math.round(cost * n * 100) / 100, breakdown: cost ? `${n} units @ ${cost} credits` : 'No cost configured for this model.' };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const cfg = parseConfig(req);
    const result = cfg.result ?? {};
    const base = (ctx.baseUrl || '').replace(/\/$/, '');
    if (!base && !cfg.url) throw new ProviderError('Custom provider needs a Base URL or absolute `url`', { code: 'config', suggestion: 'Set the Base URL in Settings → AI Providers.' });

    const vars: Record<string, unknown> = {
      baseUrl: base, apiKey: ctx.apiKey ?? '', prompt: JSON.stringify(req.prompt).slice(1, -1),
      rawPrompt: req.prompt, negative: req.negativePrompt ?? '', model: req.modelId,
      driverModel: req.meta?.driverModel ?? req.modelId,
      seed: req.seed ?? 0, steps: req.steps ?? 28, cfg: req.guidance ?? 7,
      width: 1024, height: 576, duration: req.durationSec ?? 5, fps: 24,
      aspectRatio: req.aspectRatio ?? '16:9', resolution: req.resolution ?? '1080p',
      count: req.count ?? 1, count_: req.count ?? 1,
      voice: req.voice?.voiceId ?? '', language: req.voice?.language ?? 'en',
      emotion: req.voice?.emotion ?? 'neutral', speed: req.voice?.speed ?? 1, pitch: req.voice?.pitch ?? 0,
      extra: ctx.extra ?? {}
    };

    const url = template(String(cfg.url ?? `{{baseUrl}}${cfg.path ?? '/generate'}`), vars);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(cfg.headers ?? {})) headers[k] = template(String(v), vars);
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
    if (ctx.apiKey && !Object.values(headers).some(v => v.includes(ctx.apiKey!))) headers['authorization'] = `Bearer ${ctx.apiKey}`;

    let bodyStr: string;
    if (typeof cfg.body === 'string') bodyStr = template(cfg.body, vars);
    else bodyStr = JSON.stringify(cfg.body ?? { prompt: req.prompt, seed: vars.seed, model: vars.driverModel });

    yield { progress: 0.1, stage: `POST ${safeUrl(url)}` } as ProviderEvent;
    const res = await http(url, { method: cfg.method ?? 'POST', headers, body: bodyStr, signal: ctx.signal, timeoutMs: cfg.timeoutMs ?? 300_000 });
    if (res.status >= 400) throw classifyHttpError(res.status, res.raw);

    const common = { ok: true as const, modelId: req.modelId, providerId: String(req.meta?.providerId ?? 'custom'), demo: false };
    let payload = res.body;

    // async job pattern
    if (result.statusUrl || cfg.async) {
      const jobId = String(getPath(payload, result.jobIdPath ?? 'id') ?? '');
      if (!jobId) throw new ProviderError('Custom API returned no job id', { code: 'bad_response', providerMessage: res.raw.slice(0, 300) });
      const statusUrl = template(String(result.statusUrl ?? `{{baseUrl}}/status/{{jobId}}`), { ...vars, jobId });
      yield { progress: 0.2, stage: `Polling ${safeUrl(statusUrl)}` } as ProviderEvent;
      payload = await poll(async () => {
        const s = await http(statusUrl, { headers, signal: ctx.signal, timeoutMs: 30_000 });
        if (s.status >= 400) throw classifyHttpError(s.status, s.raw);
        const st = String(getPath(s.body, result.statusPath ?? 'status') ?? '').toLowerCase();
        const failedValue = String(result.failedValue ?? 'failed').toLowerCase();
        const doneValue = String(result.doneValue ?? 'succeeded').toLowerCase();
        if (st === failedValue || st === 'error' || st === 'cancelled') {
          throw new ProviderError(String(getPath(s.body, result.errorPath ?? 'error') ?? 'Custom provider reported failure'), { code: 'generation_failed', retryable: true, providerMessage: s.raw.slice(0, 300) });
        }
        if (st === doneValue || st === 'complete' || st === 'completed' || st === 'success') return { done: true, value: s.body, progress: 0.95, stage: 'Completed' };
        const p = Number(getPath(s.body, result.progressPath ?? 'progress') ?? 0);
        const norm = p > 1 ? p / 100 : p;
        return { done: false, progress: 0.2 + Math.min(0.7, norm * 0.7), stage: st ? `Working (${st})` : 'Working' };
      }, { signal: ctx.signal, intervalMs: cfg.pollMs ?? 2000 });
      if (result.responseUrl) {
        const r = await http(template(String(result.responseUrl), { ...vars, jobId }), { headers, signal: ctx.signal, timeoutMs: 60_000 });
        payload = r.body;
      }
    }

    yield { progress: 0.95, stage: 'Collecting result' } as ProviderEvent;

    // ── extract by declared paths ─────────────────────────────
    if (req.kind === 'video') {
      const vUrl = pickFirst(payload, [result.videoPath, 'video.url', 'output[0]', 'data.video']);
      if (!vUrl) throw new ProviderError('Custom API returned no video URL', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(payload).slice(0, 300) });
      const dl = await httpBytes(String(vUrl), { signal: ctx.signal, timeoutMs: 600_000 });
      return { ...common, video: [{ data: dl.data, mime: dl.mime || 'video/mp4', durationSec: req.durationSec ?? 5 }], usage: { units: req.durationSec ?? 5, unit: 'second' } };
    }
    if (req.kind === 'voice' || req.kind === 'music' || req.kind === 'sfx') {
      const aUrl = pickFirst(payload, [result.audioPath, 'audio.url', 'output.url', 'data.audio']);
      if (aUrl) {
        const dl = await httpBytes(String(aUrl), { signal: ctx.signal, timeoutMs: 300_000 });
        return { ...common, audio: [{ data: dl.data, mime: dl.mime || 'audio/mpeg', durationSec: req.durationSec ?? (req.prompt.length / 15) }], usage: { units: 1, unit: req.kind } };
      }
      const aB64 = pickFirst(payload, [result.audioB64Path, 'audio.b64', 'data']);
      if (aB64) return { ...common, audio: [{ data: unb64(String(aB64)), mime: 'audio/mpeg', durationSec: req.prompt.length / 15 }], usage: { units: 1, unit: req.kind } };
      throw new ProviderError('Custom API returned no audio', { code: 'empty_output', retryable: true });
    }
    if (req.kind === 'image') {
      const images = [];
      const list = collectImages(payload, result);
      if (!list.length) throw new ProviderError('Custom API returned no images', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(payload).slice(0, 300), suggestion: 'Set result.imagePath or result.imageUrlPath in the model config.' });
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        const got = item.b64 ? { data: unb64(item.b64), mime: item.mime ?? 'image/png' } : await httpBytes(item.url!, { signal: ctx.signal, timeoutMs: 300_000 });
        images.push({ data: got.data, mime: got.mime, seed: (req.seed ?? 0) + i });
        yield { progress: 0.95 + (i / list.length) * 0.05, stage: `Fetching ${i + 1}/${list.length}` } as ProviderEvent;
      }
      return { ...common, images, usage: { units: images.length, unit: 'image' } };
    }
    // text
    const text = String(pickFirst(payload, [result.textPath, 'choices[0].message.content', 'output.text', 'text', 'data.text', 'response']) ?? '');
    let json: unknown;
    const jsonPath = result.jsonPath ? getPath(payload, result.jsonPath) : undefined;
    if (jsonPath !== undefined) json = jsonPath;
    else if (req.text?.responseFormat === 'json') { try { json = JSON.parse(text); } catch { json = undefined; } }
    if (!text && json === undefined) throw new ProviderError('Custom API returned an empty response', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(payload).slice(0, 300) });
    return { ...common, text, json, usage: { units: text.length / 4000, unit: '1k tokens' } };
  },

  async testConnection(ctx) {
    const cfg = (ctx.extra?.config ? JSON.parse(ctx.extra.config as string) : {}) as Record<string, any>;
    const base = (ctx.baseUrl || '').replace(/\/$/, '');
    if (!base) return { ok: false, message: 'No Base URL configured' };
    const probePath = cfg.probePath ?? '/v1/models';
    const r = await http(`${base}${probePath}`, {
      headers: ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : {}, signal: ctx.signal, timeoutMs: 15_000
    }).catch(() => null);
    if (!r) return { ok: false, message: 'Endpoint unreachable', detail: base + probePath };
    return r.status < 400 ? { ok: true, message: 'Endpoint reachable', detail: base + probePath } : { ok: false, message: `HTTP ${r.status}`, detail: r.raw.slice(0, 200) };
  }
};

function safeUrl(u: string) { try { const x = new URL(u); return x.host + x.pathname; } catch { return u; } }
function pickFirst(obj: unknown, paths: (string | undefined)[]): unknown {
  for (const p of paths) { if (!p) continue; const v = getPath(obj, p); if (v != null && v !== '') return v; }
  return undefined;
}
function collectImages(payload: any, result: any): { b64?: string; url?: string; mime?: string }[] {
  const out: { b64?: string; url?: string; mime?: string }[] = [];
  const push = (v: unknown, mime?: string) => {
    if (typeof v !== 'string' || !v) return;
    if (v.startsWith('data:')) { const m = v.match(/^data:([^;]+);base64,(.*)$/); if (m) out.push({ b64: m[2], mime: m[1] }); return; }
    if (v.startsWith('http')) out.push({ url: v, mime }); else if (/^[A-Za-z0-9+/=]{64,}$/.test(v)) out.push({ b64: v, mime });
  };
  // explicit array paths first
  for (const p of [result.imageListPath, 'images', 'output', 'data.images', 'artifacts'].filter(Boolean) as string[]) {
    const arr = getPath(payload, p);
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === 'string') push(it);
        else if (it && typeof it === 'object') push(it.b64_json ?? it.b64 ?? it.base64 ?? it.data ?? it.url ?? it.image_url, it.mime ?? it.content_type);
      }
      if (out.length) return out;
    }
  }
  push(getPath(payload, result.imagePath));
  push(getPath(payload, result.imageUrlPath));
  return out;
}
void b64;
