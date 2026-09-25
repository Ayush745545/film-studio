import type { Capability, AspectRatio, Resolution } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http, httpBytes, b64, poll } from './http';

/**
 * Replicate adapter — image, video, upscaling and lip-sync.
 * Submits to `/v1/models/{owner}/{name}/predictions`, then polls the
 * prediction URL. Per-model input mapping lives in `buildInput` so adding a
 * model is a catalogue row, not new code.
 */
const API = 'https://api.replicate.com/v1';

function dims(ratio: AspectRatio = '16:9', res: Resolution = '1080p'): { w: number; h: number } {
  const base = res === '4k' ? 2160 : res === '1440p' ? 1440 : res === '720p' ? 720 : res === '480p' ? 480 : 1080;
  const map: Record<string, [number, number]> = {
    '16:9': [base * 16 / 9, base], '9:16': [base, base * 16 / 9], '1:1': [base, base],
    '4:5': [base * 4 / 5, base], '2.39:1': [base * 2.39, base], '4:3': [base * 4 / 3, base], '21:9': [base * 21 / 9, base]
  };
  const [w, h] = map[ratio] ?? map['16:9'];
  // most diffusion models need multiples of 8/64 and a sane max
  const r8 = (n: number) => Math.max(64, Math.min(2048, Math.round(n / 8) * 8));
  return { w: r8(w), h: r8(h) };
}

async function dataUrl(ctx: ProviderContext, ref: any) {
  if (ref?.dataUrl) return ref.dataUrl;
  const got = await ctx.fetchRef(ref);
  if (!got) throw new ProviderError('Reference image could not be read', { code: 'input_unreadable', retryable: true });
  return `data:${got.mime};base64,${b64(got.data)}`;
}

function buildInput(req: GenerationRequest, ctx: ProviderContext, refs: string[]): Record<string, unknown> {
  const m = req.modelId.toLowerCase();
  const { w, h } = dims(req.aspectRatio, req.resolution);
  const common: Record<string, unknown> = { prompt: req.prompt };
  if (req.negativePrompt) common.negative_prompt = req.negativePrompt;
  if (req.seed != null) common.seed = req.seed;

  if (req.kind === 'image') {
    return {
      ...common,
      ...(m.includes('flux') ? { aspect_ratio: req.aspectRatio ?? '16:9', output_format: 'png', num_outputs: Math.min(4, req.count ?? 1), ...(req.guidance ? { guidance: req.guidance } : {}), ...(req.steps ? { num_inference_steps: req.steps } : {}) }
        : m.includes('sdxl') ? { width: w, height: h, num_outputs: Math.min(4, req.count ?? 1), ...(req.guidance ? { guidance_scale: req.guidance } : {}), ...(req.steps ? { num_inference_steps: req.steps } : {}) }
        : { width: w, height: h, num_outputs: Math.min(4, req.count ?? 1) }),
      ...(refs.length ? { image: refs[0] } : {})
    };
  }
  if (req.kind === 'upscale') {
    return { image: refs[0], ...(m.includes('real-esrgan') ? { scale: req.upscale?.factor ?? 2, face_enhance: true } : { scale: req.upscale?.factor ?? 2 }) };
  }
  // video
  const dur = Math.min(req.durationSec ?? 5, 10);
  const input: Record<string, unknown> = { ...common, duration: dur };
  if (refs[0]) input.image = refs[0];
  if (m.includes('kling')) {
    delete input.duration;
    input.duration = String(Math.min(10, Math.max(5, Math.round(dur))));
    if (req.camera && req.camera !== 'Static') input.camera_control = { type: mapKlingCamera(req.camera ?? '') };
    input.aspect_ratio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
    if (req.motion) input.mode = /dynamic|action/i.test(req.motion) ? 'professional' : 'std';
  } else if (m.includes('veo')) {
    input.aspect_ratio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
    input.duration = 8;
  } else if (m.includes('hunyuan')) {
    input.resolution = req.resolution === '480p' ? '480p' : '720p';
    input.video_length = dur <= 3 ? 33 : dur <= 5 ? 61 : 129;
    delete input.duration;
  } else if (m.includes('minimax')) {
    input.prompt_optimizer = true;
    if (refs.length > 1) input.first_frame = refs[0];
  } else if (m.includes('wan')) {
    input.resolution = req.resolution === '480p' ? '480P' : '720P';
    input.duration = Math.min(5, dur);
  } else {
    input.width = w; input.height = h; input.fps = 24;
  }
  return input;
}

function mapKlingCamera(cam: string): string {
  const c = cam.toLowerCase();
  if (c.includes('zoom in') || c.includes('dolly in') || c.includes('push')) return 'zoom_in';
  if (c.includes('zoom out') || c.includes('dolly out') || c.includes('pull')) return 'zoom_out';
  if (c.includes('pan left')) return 'pan_left';
  if (c.includes('pan right')) return 'pan_right';
  if (c.includes('tilt up')) return 'tilt_up';
  if (c.includes('tilt down')) return 'tilt_down';
  return 'static';
}

export const replicate: ProviderAdapter = {
  driver: 'replicate',
  capabilities: (): Capability[] => ['image', 'video', 'upscale', 'lipsync'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 5;
    if (req.kind === 'video') {
      const secs = Math.min(req.durationSec ?? 5, 10);
      return { credits: Math.round(cost * secs * 100) / 100, breakdown: `${secs}s @ ${cost} credits/s` };
    }
    const n = req.count ?? 1;
    return { credits: Math.round(cost * n * 100) / 100, breakdown: `${n} × ${cost} credits` };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const base = (ctx.baseUrl || API).replace(/\/$/, '');
    if (!ctx.apiKey) throw new ProviderError('Replicate API token is missing', { code: 'unauthorized', suggestion: 'Add REPLICATE_API_TOKEN in Settings → AI Providers.' });
    const headers = { 'content-type': 'application/json', authorization: `Bearer ${ctx.apiKey}`, ...(ctx.extra?.['prefer'] ? { prefer: ctx.extra['prefer'] } : {}) };

    const refs: string[] = [];
    for (const r of [...(req.referenceImages ?? []), req.startFrame].filter(Boolean) as any[]) refs.push(await dataUrl(ctx, r));

    const slug = req.meta?.driverModel as string ?? req.modelId;
    if (!slug.includes('/')) throw new ProviderError('Replicate model must be "owner/name"', { code: 'config', suggestion: 'Set the model id like black-forest-labs/flux-1.1-pro.' });

    yield { progress: 0.05, stage: 'Submitting prediction' } as ProviderEvent;
    const res = await http(`${base}/models/${slug}/predictions`, { method: 'POST', headers, signal: ctx.signal, body: JSON.stringify({ input: buildInput(req, ctx, refs) }), timeoutMs: 60_000 });
    if (res.status >= 400) throw classifyHttpError(res.status, res.raw);

    const urls = res.body?.urls ?? {};
    const get = urls.get ?? `${base}/predictions/${res.body?.id}`;

    // Register cancellation before we start waiting on the provider.
    const cancelUrl = urls.cancel;
    const onCancel = () => { if (cancelUrl) void http(cancelUrl, { method: 'POST', headers }).catch(() => {}); };
    ctx.signal.addEventListener('abort', onCancel, { once: true });

    yield { progress: 0.12, stage: 'Queued at provider' } as ProviderEvent;
    const final = await poll(async () => {
      const r = await http(get, { headers, signal: ctx.signal, timeoutMs: 30_000 });
      if (r.status >= 400) throw classifyHttpError(r.status, r.raw);
      const st = String(r.body?.status ?? 'starting');
      if (st === 'succeeded') return { done: true, value: r.body, progress: 1, stage: 'Succeeded' };
      if (st === 'failed' || st === 'canceled') {
        throw new ProviderError(String(r.body?.error ?? `Prediction ${st}`), {
          code: st === 'failed' ? 'generation_failed' : 'cancelled', retryable: st === 'failed',
          providerMessage: String(r.body?.error ?? ''), suggestion: 'Adjust the prompt or parameters, or switch to the fallback model.'
        });
      }
      const pct = st === 'processing' ? 0.55 : st === 'starting' ? 0.2 : 0.12;
      return { done: false, progress: pct, stage: st === 'processing' ? 'Rendering on GPU' : `Queued (${st})` };
    }, { signal: ctx.signal, intervalMs: 2500, onProgress: (p, s) => { ctx.log('info', `${s} — ${Math.round(p * 100)}%`); } });

    ctx.signal.removeEventListener('abort', onCancel);
    const out = final.output;
    const list = (Array.isArray(out) ? out : [out]).filter(Boolean).map((o: any) => typeof o === 'string' ? o : (o.url ?? o.video?.url ?? o.image?.url)).filter(Boolean) as string[];
    if (!list.length) throw new ProviderError('Provider returned no media', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(final.output).slice(0, 300) });

    yield { progress: 0.9, stage: 'Downloading outputs' } as ProviderEvent;
    const common = { ok: true as const, modelId: req.modelId, providerId: 'replicate', demo: false, providerJobId: String(final.id ?? '') };

    if (req.kind === 'video') {
      const url = list[0];
      const dl = await httpBytes(url, { signal: ctx.signal, timeoutMs: 600_000 });
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, video: [{ data: dl.data, mime: dl.mime || 'video/mp4', durationSec: req.durationSec ?? 5 }], usage: { units: req.durationSec ?? 5, unit: 'second' } };
    }
    const images = [];
    for (let i = 0; i < list.length; i++) {
      const dl = await httpBytes(list[i], { signal: ctx.signal, timeoutMs: 300_000 });
      images.push({ data: dl.data, mime: dl.mime || 'image/png', seed: (req.seed ?? 0) + i });
      yield { progress: 0.9 + (i / list.length) * 0.1, stage: `Downloaded ${i + 1}/${list.length}` } as ProviderEvent;
    }
    return { ...common, images, usage: { units: images.length, unit: 'image' } };
  },

  async getStatus(providerJobId, ctx) {
    const r = await http(`${(ctx.baseUrl || API).replace(/\/$/, '')}/predictions/${providerJobId}`, { headers: { authorization: `Bearer ${ctx.apiKey ?? ''}` }, signal: ctx.signal, timeoutMs: 20_000 });
    return { status: String(r.body?.status ?? 'unknown'), progress: r.body?.status === 'succeeded' ? 1 : r.body?.status === 'processing' ? 0.5 : 0.1 };
  },

  async cancel(providerJobId, ctx) {
    const r = await http(`${(ctx.baseUrl || API).replace(/\/$/, '')}/predictions/${providerJobId}/cancel`, { method: 'POST', headers: { authorization: `Bearer ${ctx.apiKey ?? ''}` }, signal: ctx.signal });
    return r.status < 400;
  },

  async testConnection(ctx) {
    const r = await http(`${(ctx.baseUrl || API).replace(/\/$/, '')}/models?per_page=1`, { headers: { authorization: `Bearer ${ctx.apiKey ?? ''}` }, signal: ctx.signal, timeoutMs: 20_000 });
    return r.status < 400 ? { ok: true, message: 'Connected to Replicate', detail: API } : { ok: false, message: `HTTP ${r.status}`, detail: r.raw.slice(0, 300) };
  }
};
