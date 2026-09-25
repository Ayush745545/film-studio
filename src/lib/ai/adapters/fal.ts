import type { Capability, AspectRatio, Resolution } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http, httpBytes, b64, poll } from './http';

/** fal.ai queue adapter — FLUX, Kling, Veo, MiniMax, Wan, Real-ESRGAN, PlayAI TTS. */
const QUEUE = 'https://queue.fal.run';

function imageSize(ratio: AspectRatio = '16:9', res: Resolution = '1080p'): { width: number; height: number } | string {
  const preset: Record<string, string> = {
    '16:9': 'landscape_16_9', '9:16': 'portrait_9_16', '1:1': 'square_1_1',
    '4:5': 'portrait_4_5', '2.39:1': 'landscape_16_9', '4:3': 'landscape_4_3', '21:9': 'landscape_16_9'
  };
  if (res === '4k' || res === '1440p') return { width: ratio === '9:16' ? 1664 : 2752, height: ratio === '9:16' ? 2752 : 1664 };
  return preset[ratio] ?? 'landscape_16_9';
}

function buildInput(req: GenerationRequest, refs: string[]): Record<string, unknown> {
  const m = (req.meta?.driverModel as string ?? req.modelId).toLowerCase();
  const inp: Record<string, unknown> = { prompt: req.prompt };

  if (req.kind === 'image') {
    if (m.includes('flux')) {
      inp.aspect_ratio = req.aspectRatio ?? '16:9';
      inp.num_images = Math.min(4, req.count ?? 1);
      inp.output_format = 'png';
      inp.safety_tolerance = '6';
      if (req.guidance) inp.guidance_scale = req.guidance;
      if (req.steps) inp.num_inference_steps = req.steps;
      if (m.includes('kontext') && refs[0]) inp.image_urls = refs;
    } else if (m.includes('sdxl')) {
      const s = imageSize(req.aspectRatio, req.resolution);
      if (typeof s === 'string') inp.image_size = s; else { inp.image_size = { width: s.width, height: s.height }; }
      inp.num_images = Math.min(4, req.count ?? 1);
      if (req.negativePrompt) inp.negative_prompt = req.negativePrompt;
    } else {
      inp.image_size = imageSize(req.aspectRatio, req.resolution);
      inp.num_images = Math.min(4, req.count ?? 1);
    }
    if (req.seed != null) inp.seed = req.seed;
    if (refs[0] && !inp.image_urls) inp.image_url = refs[0];
    return inp;
  }

  if (req.kind === 'upscale') {
    return { image_url: refs[0], scale: req.upscale?.factor ?? 2 };
  }

  if (req.kind === 'voice') {
    return {
      prompt: req.prompt, voice: req.voice?.voiceId || 'Jennifer (American English)',
      speech_rate: req.voice?.speed ?? 1, ...(req.voice?.emotion ? { emotion: req.voice.emotion } : {})
    };
  }

  // video
  const dur = Math.min(req.durationSec ?? 5, 10);
  if (m.includes('kling')) {
    inp.duration = String(Math.max(5, Math.round(dur)));
    inp.aspect_ratio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
    if (refs[0]) inp.image_url = refs[0];
    if (refs[1]) inp.image_tail_url = refs[1];
    if (req.negativePrompt) inp.negative_prompt = req.negativePrompt;
    inp.cfg_scale = 0.5;
  } else if (m.includes('veo')) {
    inp.aspect_ratio = req.aspectRatio === '9:16' ? '9:16' : '16:9';
    if (refs[0]) inp.image_url = refs[0];
    inp.duration = 8;
  } else if (m.includes('minimax') || m.includes('hailuo')) {
    if (refs[0]) inp.prompt = req.prompt;
    if (refs[0]) (inp as any).image_url = refs[0];
    inp.duration = 6;
  } else if (m.includes('wan')) {
    if (refs[0]) (inp as any).image_url = refs[0];
    if (refs[1]) (inp as any).end_image_url = refs[1];
    inp.duration = 5;
    inp.resolution = req.resolution === '480p' ? '480p' : '720p';
  } else {
    if (refs[0]) (inp as any).image_url = refs[0];
    inp.duration = dur;
    inp.aspect_ratio = req.aspectRatio ?? '16:9';
  }
  if (req.seed != null) inp.seed = req.seed;
  return inp;
}

export const fal: ProviderAdapter = {
  driver: 'fal',
  capabilities: (): Capability[] => ['image', 'video', 'upscale', 'voice', 'lipsync'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 5;
    if (req.kind === 'video') {
      const s = Math.min(req.durationSec ?? 5, 10);
      return { credits: Math.round(cost * s * 100) / 100, breakdown: `${s}s @ ${cost} credits/s` };
    }
    if (req.kind === 'voice') return { credits: Math.round(cost * (req.prompt.length / 1000) * 100) / 100, breakdown: `${req.prompt.length} chars` };
    const n = req.count ?? 1;
    return { credits: Math.round(cost * n * 100) / 100, breakdown: `${n} × ${cost} credits` };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    if (!ctx.apiKey) throw new ProviderError('fal.ai key is missing', { code: 'unauthorized', suggestion: 'Add FAL_KEY in Settings → AI Providers.' });
    const app = (req.meta?.driverModel as string ?? req.modelId).replace(/^fal-ai\//, 'fal-ai/');
    const headers = { authorization: `Key ${ctx.apiKey}`, 'content-type': 'application/json', accept: 'application/json' };

    const refs: string[] = [];
    for (const r of [...(req.referenceImages ?? []), req.startFrame, req.endFrame].filter(Boolean) as any[]) {
      if (r?.dataUrl) refs.push(r.dataUrl);
      else {
        const got = await ctx.fetchRef(r);
        if (got) refs.push(`data:${got.mime};base64,${b64(got.data)}`);
      }
    }

    yield { progress: 0.06, stage: 'Enqueueing on fal' } as ProviderEvent;
    const sub = await http(`${QUEUE}/${app}`, { method: 'POST', headers, signal: ctx.signal, body: JSON.stringify(buildInput(req, refs)), timeoutMs: 60_000 });
    if (sub.status >= 400) throw classifyHttpError(sub.status, sub.raw);

    // fal may answer inline for very fast apps
    let payload = sub.body;
    if (sub.body?.request_id) {
      const statusUrl: string = sub.body.status_url ?? `https://queue.fal.run/${app}/requests/${sub.body.request_id}/status`;
      const responseUrl: string = sub.body.response_url ?? `https://queue.fal.run/${app}/requests/${sub.body.request_id}`;
      const cancelUrl: string = `https://queue.fal.run/${app}/requests/${sub.body.request_id}/cancel`;
      const onCancel = () => { void http(cancelUrl, { method: 'PUT', headers, signal: undefined }).catch(() => {}); };
      ctx.signal.addEventListener('abort', onCancel, { once: true });
      yield { progress: 0.14, stage: `Queued (position ${sub.body.queue_position ?? '?'})` } as ProviderEvent;
      await poll(async () => {
        const s = await http(statusUrl, { headers, signal: ctx.signal, timeoutMs: 30_000 });
        const st = String(s.body?.status ?? 'IN_QUEUE');
        if (st === 'COMPLETED') return { done: true, value: null, progress: 0.9, stage: 'Completed' };
        const pos = s.body?.queue_position;
        return { done: false, progress: st === 'IN_PROGRESS' ? 0.55 : 0.18, stage: st === 'IN_PROGRESS' ? 'Generating' : `Queued${pos != null ? ` · position ${pos}` : ''}` };
      }, { signal: ctx.signal, intervalMs: 2000 });
      ctx.signal.removeEventListener('abort', onCancel);
      const r = await http(responseUrl, { headers, signal: ctx.signal, timeoutMs: 60_000 });
      if (r.status >= 400) throw classifyHttpError(r.status, r.raw);
      payload = r.body;
    }

    yield { progress: 0.92, stage: 'Downloading' } as ProviderEvent;
    const common = { ok: true as const, modelId: req.modelId, providerId: 'fal', demo: false, providerJobId: String(sub.body?.request_id ?? '') };

    if (req.kind === 'video') {
      const v = payload?.video ?? payload?.videos?.[0];
      const url: string | undefined = v?.url;
      if (!url) throw new ProviderError('fal returned no video', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(payload).slice(0, 300) });
      const dl = await httpBytes(url, { signal: ctx.signal, timeoutMs: 600_000 });
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, video: [{ data: dl.data, mime: dl.mime || 'video/mp4', durationSec: req.durationSec ?? 5, width: v.width, height: v.height }], usage: { units: req.durationSec ?? 5, unit: 'second' } };
    }
    if (req.kind === 'voice') {
      const url: string | undefined = payload?.audio?.url;
      if (!url) throw new ProviderError('fal returned no audio', { code: 'empty_output', retryable: true });
      const dl = await httpBytes(url, { signal: ctx.signal, timeoutMs: 300_000 });
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, audio: [{ data: dl.data, mime: dl.mime || 'audio/mpeg', durationSec: payload?.audio?.duration ?? req.prompt.length / 15 }], usage: { units: req.prompt.length / 1000, unit: '1k chars' } };
    }
    const imgs = payload?.images ?? (payload?.image ? [payload.image] : []);
    if (!imgs.length) throw new ProviderError('fal returned no images', { code: 'empty_output', retryable: true, providerMessage: JSON.stringify(payload).slice(0, 300) });
    const images = [];
    for (let i = 0; i < imgs.length; i++) {
      const dl = await httpBytes(imgs[i].url, { signal: ctx.signal, timeoutMs: 300_000 });
      images.push({ data: dl.data, mime: dl.mime || 'image/png', seed: imgs[i].seed ?? (req.seed ?? 0) + i, width: imgs[i].width, height: imgs[i].height, revisedPrompt: imgs[i].prompt });
      yield { progress: 0.92 + (i / imgs.length) * 0.08, stage: `Downloaded ${i + 1}/${imgs.length}` } as ProviderEvent;
    }
    return { ...common, images, usage: { units: images.length, unit: 'image' } };
  },

  async testConnection(ctx) {
    const r = await http('https://fal.run/fal-ai/flux/dev', { method: 'OPTIONS', headers: { authorization: `Key ${ctx.apiKey ?? ''}` }, signal: ctx.signal, timeoutMs: 15_000 }).catch(() => null);
    // OPTIONS is not informative on fal; do a real (tiny) queue submit against a cheap endpoint
    const probe = await http(`${QUEUE}/fal-ai/flux/dev`, {
      method: 'POST', headers: { authorization: `Key ${ctx.apiKey ?? ''}`, 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'connectivity test', num_images: 1, image_size: 'square_hd' }), signal: ctx.signal, timeoutMs: 30_000
    }).catch(() => null);
    void r;
    if (!probe) return { ok: false, message: 'fal.ai unreachable', detail: 'Network error' };
    if (probe.status === 401 || probe.status === 403) return { ok: false, message: 'Invalid FAL key', detail: probe.raw.slice(0, 200) };
    if (probe.status >= 400) return { ok: false, message: `HTTP ${probe.status}`, detail: probe.raw.slice(0, 200) };
    if (probe.body?.request_id) {
      void http(`https://queue.fal.run/fal-ai/flux/dev/requests/${probe.body.request_id}/cancel`, { method: 'PUT', headers: { authorization: `Key ${ctx.apiKey ?? ''}` } }).catch(() => {});
    }
    return { ok: true, message: 'Connected to fal.ai', detail: QUEUE };
  }
};
