import type { Capability } from '@/types';
import type { GenerationRequest, GenerationResult, ProviderAdapter, ProviderContext, ProviderEvent } from '../types';
import { classifyHttpError, ProviderError } from '../types';
import { http, b64 } from './http';

const VERSION = '2023-06-01';

/** Anthropic Messages API — long-form writing, edit reasoning and vision. */
export const anthropic: ProviderAdapter = {
  driver: 'anthropic',
  capabilities: (): Capability[] => ['text', 'vision', 'editing'],

  estimateCost(req, model) {
    const cost = model?.costPerUnit ?? 0.7;
    const tokens = Math.ceil(((req.prompt?.length ?? 0) + (req.text?.system?.length ?? 0)) / 4) + 2000;
    return { credits: Math.round(cost * tokens / 1000 * 100) / 100, breakdown: `~${tokens} tokens @ ${cost} credits/1k` };
  },

  async *generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult> {
    if (req.kind !== 'text') {
      throw new ProviderError('Anthropic serves text and vision only', {
        code: 'unsupported_kind', suggestion: `Route "${req.kind}" jobs to an image/video/voice provider instead.`
      });
    }
    const base = (ctx.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    if (!ctx.apiKey) throw new ProviderError('Anthropic API key is missing', { code: 'unauthorized', suggestion: 'Add the key in Settings → AI Providers, or set ANTHROPIC_API_KEY.' });

    yield { progress: 0.2, stage: 'Sending to Claude' } as ProviderEvent;

    const content: any[] = [];
    for (const ref of (req.referenceImages ?? []).slice(0, 6)) {
      const got = await ctx.fetchRef(ref as never);
      if (got) content.push({ type: 'image', source: { type: 'base64', media_type: got.mime === 'image/svg+xml' ? 'image/png' : got.mime, data: b64(got.data) } });
    }
    content.push({ type: 'text', text: req.prompt });

    const history = Array.isArray(req.meta?.history) ? (req.meta!.history as any[]) : [];
    const messages = [...history.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content ?? '') })), { role: 'user' as const, content }];

    const body = {
      model: req.modelId, max_tokens: req.text?.maxTokens ?? 4000,
      temperature: req.text?.temperature ?? 0.85,
      ...(req.text?.system ? { system: req.text.system } : {}),
      messages
    };

    const res = await http(`${base}/v1/messages`, {
      method: 'POST', signal: ctx.signal, timeoutMs: 300_000,
      headers: { 'content-type': 'application/json', 'x-api-key': ctx.apiKey, 'anthropic-version': VERSION, ...(ctx.extra?.['anthropic-beta'] ? { 'anthropic-beta': ctx.extra['anthropic-beta'] } : {}) },
      body: JSON.stringify(body)
    });
    if (res.status >= 400) throw classifyHttpError(res.status, res.raw);

    const text: string = (res.body?.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
    yield { progress: 1, stage: 'Done' } as ProviderEvent;
    let json: unknown;
    if (req.text?.responseFormat === 'json') json = safeParse(text);
    return {
      ok: true, modelId: req.modelId, providerId: 'anthropic', demo: false, text, json,
      usage: { inputTokens: res.body?.usage?.input_tokens, outputTokens: res.body?.usage?.output_tokens, units: ((res.body?.usage?.input_tokens ?? 0) + (res.body?.usage?.output_tokens ?? 0)) / 1000, unit: '1k tokens' }
    };
  },

  async testConnection(ctx) {
    const base = (ctx.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
    const res = await http(`${base}/v1/models`, { headers: { 'x-api-key': ctx.apiKey ?? '', 'anthropic-version': VERSION }, signal: ctx.signal, timeoutMs: 20_000 });
    if (res.status < 400) {
      const n = res.body?.data?.length ?? 0;
      return { ok: true, message: `Connected${n ? ` — ${n} models available` : ''}`, detail: base };
    }
    return { ok: false, message: `HTTP ${res.status}`, detail: res.raw.slice(0, 300) };
  }
};

function safeParse(t: string): unknown {
  try { return JSON.parse(t); } catch {
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/) ?? t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[1] ?? m[0]); } catch { return undefined; } }
    return undefined;
  }
}
