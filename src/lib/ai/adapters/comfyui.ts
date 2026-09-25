import type { Capability, AspectRatio, Resolution } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http, httpBytes, b64, poll } from './http';
import { randomUUID } from 'node:crypto';

/**
 * ComfyUI adapter — workflow-agnostic.
 *
 * Rather than hard-coding node graphs, the user supplies a workflow JSON
 * (exported from ComfyUI in "API format") and we map generation parameters
 * into it. Two mapping modes:
 *
 *   1. `{{token}}` substitution anywhere in the JSON string, or
 *   2. explicit node/field patching from model config:
 *      { promptNode: "6", seedNode: "3", widthNode: "5", heightNode: "5",
 *        negativeNode: "7", stepsNode: "3", cfgNode: "4", imageNode: "10" }
 *
 * Any workflow — SDXL, FLUX, AnimateDiff, Wan, upscalers — works unchanged.
 */
const TOKENS = ['prompt', 'negative', 'seed', 'width', 'height', 'steps', 'cfg', 'duration', 'fps', 'image', 'model', 'lora'];

function dims(ratio: AspectRatio = '16:9', res: Resolution = '1080p') {
  const base = res === '4k' ? 2048 : res === '1440p' ? 1536 : res === '720p' ? 832 : res === '480p' ? 640 : 1024;
  const map: Record<string, [number, number]> = {
    '16:9': [base, Math.round(base * 9 / 16)], '9:16': [Math.round(base * 9 / 16), base],
    '1:1': [base, base], '4:5': [Math.round(base * 4 / 5), base], '2.39:1': [base, Math.round(base / 2.39)],
    '4:3': [base, Math.round(base * 3 / 4)], '21:9': [base, Math.round(base * 9 / 21)]
  };
  const [w, h] = map[ratio] ?? map['16:9'];
  const r8 = (n: number) => Math.max(64, Math.round(n / 8) * 8);
  return { w: r8(w), h: r8(h) };
}

function patchWorkflow(tpl: unknown, vars: Record<string, unknown>, cfg: Record<string, any>): unknown {
  let json = typeof tpl === 'string' ? tpl : JSON.stringify(tpl);
  for (const t of TOKENS) {
    json = json.split(`{{${t}}}`).join(String(vars[t] ?? ''));
  }
  const graph = JSON.parse(json) as Record<string, any>;

  const setField = (nodeId: string | undefined, field: string, value: unknown, index?: number) => {
    if (!nodeId) return;
    const node = graph[String(nodeId)];
    if (!node) return;
    const inputs = (node.inputs ??= {});
    if (typeof index === 'number') {
      if (Array.isArray(inputs[field])) inputs[field][index] = value;
      else inputs[field] = value;
    } else inputs[field] = value;
  };
  setField(cfg.promptNode, cfg.promptField ?? 'text', vars.prompt);
  setField(cfg.negativeNode, cfg.negativeField ?? 'text', vars.negative);
  setField(cfg.widthNode, cfg.widthField ?? 'width', vars.width);
  setField(cfg.heightNode, cfg.heightField ?? 'height', vars.height);
  setField(cfg.seedNode, cfg.seedField ?? 'seed', vars.seed);
  setField(cfg.seedNode, cfg.noiseField ?? 'noise_seed', vars.seed);
  setField(cfg.stepsNode, cfg.stepsField ?? 'steps', vars.steps);
  setField(cfg.cfgNode, cfg.cfgField ?? 'cfg', vars.cfg);
  setField(cfg.durationNode, cfg.durationField ?? 'length', vars.frames);
  if (cfg.imageNode && vars.imageDataUrl) setField(cfg.imageNode, cfg.imageField ?? 'image', vars.imageDataUrl);
  if (cfg.checkpointNode && vars.model) setField(cfg.checkpointNode, cfg.checkpointField ?? 'ckpt_name', vars.model);
  if (cfg.loraNode && vars.lora) setField(cfg.loraNode, cfg.loraField ?? 'lora_name', vars.lora);
  return graph;
}

export const comfyui: ProviderAdapter = {
  driver: 'comfyui',
  capabilities: (): Capability[] => ['image', 'video', 'upscale'],

  estimateCost: () => ({ credits: 0, breakdown: 'Local ComfyUI — no per-generation cost.' }),

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    const base = (ctx.baseUrl || ctx.extra?.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
    const cfg = (req.meta?.modelConfig as Record<string, any>) ?? {};
    const tpl = cfg.workflowJson ?? req.meta?.workflowJson;
    if (!tpl) {
      // The built-in "ComfyUI Workflow (image/video/upscale)" registry entries
      // ship with `workflowJson: null` on purpose — they are slots waiting for a
      // graph. Say so, and point at the screen that actually fills them.
      throw new ProviderError('No ComfyUI workflow attached to this model', {
        code: 'config', retryable: false,
        suggestion: 'In Models → ComfyUI, connect your instance and use "Load to app" on a workflow (or paste its API-format JSON). That registers a model carrying the graph. The built-in "ComfyUI Workflow" entries are empty placeholders until you do.'
      });
    }
    const { w, h } = dims(req.aspectRatio, req.resolution);
    const clientId = randomUUID();
    const imageDataUrl = req.referenceImages?.[0] || req.startFrame
      ? await (async () => { const g = await ctx.fetchRef((req.referenceImages?.[0] ?? req.startFrame) as never); return g ? `data:${g.mime};base64,${b64(g.data)}` : undefined; })()
      : undefined;

    const graph = patchWorkflow(tpl, {
      prompt: req.prompt, negative: req.negativePrompt ?? '', seed: req.seed ?? Math.floor(Math.random() * 2 ** 31),
      width: w, height: h, steps: req.steps ?? 28, cfg: req.guidance ?? 6.5,
      duration: req.durationSec ?? 5, fps: Number(req.meta?.fps ?? 12),
      frames: Math.round((req.durationSec ?? 3) * Number(req.meta?.fps ?? 12)),
      image: imageDataUrl, imageDataUrl, model: cfg.checkpoint, lora: cfg.lora
    }, cfg);

    yield { progress: 0.08, stage: 'Submitting workflow' } as ProviderEvent;
    const sub = await http(`${base}/prompt`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: ctx.signal, timeoutMs: 30_000,
      body: JSON.stringify({ prompt: graph, client_id: clientId })
    });
    if (sub.status >= 400) throw classifyHttpError(sub.status, sub.raw);
    const promptId = sub.body?.prompt_id;
    if (!promptId) throw new ProviderError('ComfyUI did not return a prompt_id', { code: 'bad_response', providerMessage: sub.raw.slice(0, 300) });

    yield { progress: 0.2, stage: `Queued (${promptId.slice(0, 8)})` } as ProviderEvent;
    let lastPct = 0.2;
    await poll(async () => {
      const h1 = await http(`${base}/history/${promptId}`, { signal: ctx.signal, timeoutMs: 15_000 });
      const entry = h1.body?.[promptId];
      if (entry) {
        if (entry.status?.status_str === 'error') {
          throw new ProviderError('ComfyUI workflow errored', { code: 'workflow_error', retryable: false, providerMessage: JSON.stringify(entry.status?.messages ?? entry).slice(0, 500), suggestion: 'Open the workflow in ComfyUI and check the failing node.' });
        }
        return { done: true, value: entry, progress: 1, stage: 'Completed' };
      }
      const q = await http(`${base}/queue`, { signal: ctx.signal, timeoutMs: 10_000 }).catch(() => null);
      const running = (q?.body?.queue_running ?? []).some((j: any[]) => j[1] === promptId);
      const pending = (q?.body?.queue_pending ?? []).findIndex((j: any[]) => j[1] === promptId);
      const prog = running ? Math.min(0.92, lastPct + 0.06) : 0.25;
      lastPct = prog;
      return { done: false, progress: prog, stage: running ? 'Rendering locally' : pending >= 0 ? `Queued · position ${pending + 1}` : 'Waiting for worker' };
    }, { signal: ctx.signal, intervalMs: 1200, onProgress: () => {} });

    const hist = await http(`${base}/history/${promptId}`, { signal: ctx.signal, timeoutMs: 15_000 });
    const outputs = hist.body?.[promptId]?.outputs ?? {};
    const files: { filename: string; subfolder: string; type: string }[] = [];
    for (const nodeOut of Object.values(outputs) as any[]) {
      for (const img of nodeOut?.images ?? []) files.push(img);
      for (const g of nodeOut?.gifs ?? []) files.push(g);
      for (const v of nodeOut?.videos ?? []) files.push(v);
    }
    if (!files.length) throw new ProviderError('Workflow produced no output files', { code: 'empty_output', retryable: true, suggestion: 'Check that a SaveImage / SaveVideo / VHS_VideoCombine node is the output of your workflow.' });

    const common = { ok: true as const, modelId: req.modelId, providerId: 'comfyui', demo: false, providerJobId: promptId };
    if (req.kind === 'video') {
      const f = files[0];
      const dl = await httpBytes(`${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder ?? '')}&type=${encodeURIComponent(f.type ?? 'output')}`, { signal: ctx.signal, timeoutMs: 300_000 });
      yield { progress: 1, stage: 'Done' } as ProviderEvent;
      return { ...common, video: [{ data: dl.data, mime: dl.mime || 'video/mp4', durationSec: req.durationSec ?? 5, width: w, height: h }], usage: { units: req.durationSec ?? 5, unit: 'second' } };
    }
    const images = [];
    for (let i = 0; i < Math.min(files.length, 8); i++) {
      const f = files[i];
      const dl = await httpBytes(`${base}/view?filename=${encodeURIComponent(f.filename)}&subfolder=${encodeURIComponent(f.subfolder ?? '')}&type=${encodeURIComponent(f.type ?? 'output')}`, { signal: ctx.signal, timeoutMs: 120_000 });
      images.push({ data: dl.data, mime: dl.mime || 'image/png', seed: (req.seed ?? 0) + i, width: w, height: h });
      yield { progress: 0.9 + (i / files.length) * 0.1, stage: `Fetching ${i + 1}/${files.length}` } as ProviderEvent;
    }
    return { ...common, images, usage: { units: images.length, unit: 'image' } };
  },

  async testConnection(ctx) {
    const base = (ctx.baseUrl || ctx.extra?.COMFYUI_URL || 'http://127.0.0.1:8188').replace(/\/$/, '');
    const r = await http(`${base}/system_stats`, { signal: ctx.signal, timeoutMs: 8_000 }).catch(() => null);
    if (!r) return { ok: false, message: `Cannot reach ComfyUI at ${base}`, detail: 'Is ComfyUI running? Start it, or set --listen/--port if it is on another host.' };
    if (r.status >= 400) return { ok: false, message: `HTTP ${r.status}`, detail: r.raw.slice(0, 200) };
    const v = r.body?.system?.comfyui_version ?? 'unknown';
    const gpu = r.body?.devices?.[0]?.name;
    return { ok: true, message: `Connected — ComfyUI ${v}${gpu ? ` · ${gpu}` : ''}`, detail: base };
  }
};
