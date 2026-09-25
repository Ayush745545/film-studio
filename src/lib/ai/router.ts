import { getDb } from '../db';
import { adapterFor } from './adapters';
import { resolveCredential } from './credentials';
import { ProviderError } from './types';
import type { GenerationRequest, GenerationResult, ProviderContext, ProviderAdapter, ImageRef } from './types';
import type { Capability, GenKind, ModelDescriptor, ModelPreset, Provider } from '@/types';
import { storage } from '../storage';
import { config } from '../config';

/**
 * Model Router.
 *
 *   request → capability detection → model selection (strategy / preset /
 *   explicit) → credential resolution → adapter execution → fallback chain.
 *
 * Nothing above this layer names a vendor. That is the whole point: the UI,
 * the queue and the automation engine all talk to `route()` and `execute()`.
 */

export type RouteStrategy = 'quality' | 'speed' | 'cost' | 'explicit' | 'preset';

export interface RouteOptions {
  userId: string;
  kind: GenKind;
  capability?: Capability;
  modelId?: string | null;
  presetId?: string | null;
  strategy?: RouteStrategy;
  /** Allow the demo engine when no configured provider can serve the request. */
  allowDemo?: boolean;
  req?: GenerationRequest;
}

export interface RouteDecision {
  model: ModelDescriptor;
  provider: Provider;
  adapter: ProviderAdapter;
  credential: Awaited<ReturnType<typeof resolveCredential>>;
  strategy: RouteStrategy;
  reason: string;
  demo: boolean;
  fallbacks: { model: ModelDescriptor; provider: Provider }[];
}

export class NoModelError extends Error {
  code = 'no_model';
  hint: string;
  constructor(message: string, hint: string) { super(message); this.name = 'NoModelError'; this.hint = hint; }
}

const KIND_CAP: Record<GenKind, Capability> = {
  text: 'text', image: 'image', video: 'video', voice: 'voice', music: 'music',
  sfx: 'sound', upscale: 'upscale', lipsync: 'lipsync', assembly: 'editing',
  export: 'editing', analysis: 'text',
  story: 'text', script: 'text', cast: 'text', world: 'text', breakdown: 'editing',
  'sound-design': 'editing', dialogue: 'editing', 'edit-plan': 'editing',
  copilot: 'editing', stems: 'editing', bundle: 'editing'
};

export async function route(opts: RouteOptions): Promise<RouteDecision> {
  const db = await getDb();
  const cap: Capability = opts.capability ?? KIND_CAP[opts.kind] ?? 'text';
  const [providers, models] = await Promise.all([
    db.repo('providers').findMany({ where: { enabled: true } }) as Promise<Provider[]>,
    db.repo('models').findMany({ where: { enabled: true } }) as Promise<ModelDescriptor[]>
  ]);
  const providerById = new Map(providers.map(p => [p.id, p]));
  const usable = models.filter(m => m.capabilities.includes(cap) || m.kind === opts.kind)
    .filter(m => providerById.has(m.providerId));

  if (!usable.length) {
    throw new NoModelError(`No model can perform "${cap}" generation`, 'Add a provider in Settings → AI Providers, or enable one of the built-in models in Settings → Models.');
  }

  // 1. an explicitly requested model always wins.
  //
  // The UI's model picker, `input.modelId` on a job, and the `forceDemo` path in
  // runMediaJob all name a specific model. Without this branch `route()` ignored
  // that and re-derived a winner from the strategy sort, so picking a model
  // silently generated with a different one — and for ComfyUI it substituted a
  // built-in placeholder whose `config.workflowJson` is null, which then failed
  // with "No ComfyUI workflow configured" no matter what the user had loaded.
  if (opts.modelId) {
    const wanted = usable.find(x => x.id === opts.modelId);
    if (wanted) {
      const provider = providerById.get(wanted.providerId);
      if (provider) {
        const credential = await resolveCredential(provider, opts.userId);
        if (await isUsable(credential, provider, wanted)) {
          return mk(wanted, provider, 'explicit', `Selected model: ${wanted.name}`,
            await fallbackList(usable, wanted, providerById, opts), credential);
        }
      }
    }
    // Named but unusable (disabled, provider down, or no capability match). Fall
    // through to the normal strategy — but log it, because silently generating
    // with a different model than the one that was asked for is how this went
    // unnoticed in the first place.
    console.warn(`[router] requested model "${opts.modelId}" cannot serve ${cap}; falling back to the "${opts.strategy ?? 'quality'}" strategy`);
  }

  // 2. preset
  const preset = opts.presetId ? await db.repo('presets').findUnique(opts.presetId) as ModelPreset | null : null;
  const presetField: Record<GenKind, keyof ModelPreset> = {
    text: 'textModel', image: 'imageModel', video: 'videoModel', voice: 'voiceModel',
    music: 'musicModel', sfx: 'soundModel', upscale: 'upscaleModel', lipsync: 'videoModel',
    assembly: 'editingModel', export: 'editingModel', analysis: 'textModel',
    story: 'textModel', script: 'textModel', cast: 'textModel', world: 'textModel',
    breakdown: 'editingModel', 'sound-design': 'editingModel', dialogue: 'editingModel',
    'edit-plan': 'editingModel', copilot: 'editingModel', stems: 'editingModel', bundle: 'editingModel'
  };
  if (preset) {
    const wanted = preset[presetField[opts.kind]] as string | null;
    const m = wanted ? usable.find(x => x.id === wanted) : undefined;
    if (m) {
      const provider = providerById.get(m.providerId)!;
      const credential = await resolveCredential(provider, opts.userId);
      if (await isUsable(credential, provider, m)) {
        return mk(m, provider, 'preset', `Preset "${preset.name}" → ${m.name}`, await fallbackList(usable, m, providerById, opts), credential);
      }
    }
    // preset model unavailable → fall through to strategy, honouring preset.strategy
    opts.strategy = opts.strategy ?? (preset.strategy as RouteStrategy) ?? 'quality';
  }

  // 3. defaults for the capability
  const strategy = opts.strategy ?? 'quality';
  const scored = usable.filter(x => x.demo === false || opts.allowDemo !== false);

  // Sort by strategy, then verify each candidate can actually serve so we never
  // pick (or fall back to) a model whose provider has no key or isn't running.
  const sorted = scored.slice().sort((a, b) => {
    if (a.demo !== b.demo) return a.demo ? 1 : -1;
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    if (strategy === 'cost') return (a.costPerUnit - b.costPerUnit) || (b.quality - a.quality);
    if (strategy === 'speed') return (b.speed - a.speed) || (a.costPerUnit - b.costPerUnit);
    return (b.quality - a.quality) || (b.speed - a.speed);        // quality (default)
  });

  for (const m of sorted) {
    const provider = providerById.get(m.providerId);
    if (!provider) continue;
    const cred = await resolveCredential(provider, opts.userId);
    if (!(await isUsable(cred, provider, m))) continue;
    const word = strategy === 'quality' ? 'Highest quality' : strategy === 'speed' ? 'Fastest' : strategy === 'cost' ? 'Cheapest' : 'Selected';
    return mk(m, provider, strategy, `${word} configured model: ${m.name}`, await fallbackList(usable, m, providerById, opts), cred);
  }

  // 4. built-in engine fallback (previs output, zero cost)
  if (opts.allowDemo !== false) {
    const demoProvider = providers.find(p => p.id === 'demo' || p.driver === 'demo');
    const demoModel = models.find(m => (m.demo || m.providerId === 'demo') && (m.capabilities.includes(cap) || m.kind === opts.kind));
    if (demoProvider && demoModel) {
      const credential = await resolveCredential(demoProvider, opts.userId);
      return mk(demoModel, demoProvider, 'explicit', 'No configured provider could serve this request — routed to the built-in Studio Engine, which renders previsualisation media. Add a provider in Settings → AI Providers for model generation.', [], credential);
    }
  } else {
    // Demo disallowed and nothing else can serve: say exactly what is missing.
    const missing = [...new Set(usable.map(m => providerById.get(m.providerId)?.name).filter(Boolean))] as string[];
    throw new NoModelError(
      `No "${cap}" model is configured and ready`,
      `These providers could serve it once configured: ${missing.join(', ') || 'none registered'}. Add a key in Settings → AI Providers, or enable Demo Mode.`
    );
  }

  throw new NoModelError(
    `No "${cap}" model is configured and ready`,
    'Add an API key for a provider that supports this capability (Settings → AI Providers), or enable Demo Mode.'
  );
}

/**
 * Local/self-hosted providers are only usable if the process is actually
 * listening. A 900 ms TCP probe (cached for a minute, loopback/private hosts
 * only) means Demo Mode falls straight through to the demo engine instead of
 * burning an attempt on an Ollama that isn't running.
 */
const reachCache = new Map<string, { ok: boolean; at: number }>();
function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
    || /^192\.168\./.test(host) || /^10\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host.endsWith('.local');
}
export async function reachable(baseUrl: string | null): Promise<boolean> {
  if (!baseUrl) return false;
  let host: string; let port: number;
  try { const u = new URL(baseUrl); host = u.hostname; port = Number(u.port || (u.protocol === 'https:' ? 443 : 80)); }
  catch { return false; }
  if (!isLocalHost(host)) return true;              // remote hosts: assume reachable, let HTTP errors speak
  const hit = reachCache.get(baseUrl);
  if (hit && Date.now() - hit.at < 60_000) return hit.ok;
  const ok = await new Promise<boolean>(resolve => {
    import('node:net').then(net => {
      const sock = net.connect({ host, port, timeout: 900 }, () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    }).catch(() => resolve(false));
  });
  reachCache.set(baseUrl, { ok, at: Date.now() });
  return ok;
}

const KEYLESS = new Set(['ollama', 'lmstudio', 'comfyui', 'custom']);

/** Can this model actually serve a request right now? */
async function isUsable(cred: ResolvedCred, provider: Provider, model: ModelDescriptor): Promise<boolean> {
  if (!provider.enabled || !model.enabled) return false;
  if (provider.driver === 'demo' || model.demo || provider.id === 'demo') return true;
  if (provider.driver === 'comfyui') {
    const workflow = model.config?.workflowJson;
    return Boolean(workflow && await reachable(cred.baseUrl ?? provider.baseUrl));
  }
  if (provider.driver === 'custom-http') return Boolean(provider.baseUrl);
  if (KEYLESS.has(provider.id)) return await reachable(cred.baseUrl ?? provider.baseUrl);
  return Boolean(cred.apiKey);
}
type ResolvedCred = Awaited<ReturnType<typeof resolveCredential>>;

function mk(m: ModelDescriptor, p: Provider, strategy: RouteStrategy, reason: string, fallbacks: { model: ModelDescriptor; provider: Provider }[], cred?: Awaited<ReturnType<typeof resolveCredential>>): RouteDecision {
  return {
    model: m, provider: p, adapter: adapterFor(p.driver),
    credential: cred ?? ({ apiKey: null, baseUrl: p.baseUrl, extra: {}, source: 'none' } as Awaited<ReturnType<typeof resolveCredential>>),
    strategy, reason, demo: Boolean(m.demo || p.driver === 'demo'), fallbacks
  };
}

async function fallbackList(usable: ModelDescriptor[], chosen: ModelDescriptor, byId: Map<string, Provider>, opts: RouteOptions) {
  const cap = opts.capability ?? KIND_CAP[opts.kind];
  const candidates = usable.filter(m => m.id !== chosen.id && (m.capabilities.includes(cap) || m.kind === opts.kind));
  const out: { model: ModelDescriptor; provider: Provider }[] = [];
  const ordered = candidates.slice().sort((a, b) => (a.demo ? 1 : 0) - (b.demo ? 1 : 0) || b.quality - a.quality);
  for (const m of ordered) {
    if (out.length >= 4) break;
    const provider = byId.get(m.providerId);
    if (!provider) continue;
    const cred = await resolveCredential(provider, opts.userId);
    if (m.demo && opts.allowDemo === false) continue;
    if (!(await isUsable(cred, provider, m))) continue;
    out.push({ model: m, provider });
  }
  // The demo engine is always a valid last resort unless explicitly forbidden.
  if (opts.allowDemo !== false && !out.some(o => o.model.demo)) {
    const dp = byId.get('demo');
    const dm = usable.find(m => m.demo && (m.capabilities.includes(cap) || m.kind === opts.kind));
    if (dp && dm) out.push({ model: dm, provider: dp });
  }
  return out;
}

/* ── execution ─────────────────────────────────────────────── */
export interface ExecuteOptions {
  jobId: string;
  userId: string;
  signal: AbortSignal;
  onProgress?: (p: number, stage?: string) => void;
  onLog?: (level: 'info' | 'warn' | 'error', msg: string) => void;
  route?: RouteDecision;
  routeOpts?: RouteOptions;
  /** Attempt fallback models when the primary fails with a retryable error. */
  useFallback?: boolean;
}

export interface ExecuteOutcome extends GenerationResult {
  route: RouteDecision;
  attempts: { modelId: string; providerId: string; error?: string }[];
}

export async function execute(
  req: GenerationRequest,
  opts: ExecuteOptions
): Promise<ExecuteOutcome> {
  const decision = opts.route ?? await route({ ...(opts.routeOpts as RouteOptions), req });
  const attempts: ExecuteOutcome['attempts'] = [];
  let current: RouteDecision = decision;
  const chain: RouteDecision[] = [current];
  if (opts.useFallback !== false) {
    for (const f of current.fallbacks) {
      if (f.model.demo && config.demoMode === 'off') continue;
      chain.push(mk(f.model, f.provider, current.strategy, `Fallback: ${f.model.name}`, []));
    }
  }

  let lastErr: unknown = null;
  for (const cand of chain) {
    if (opts.signal.aborted) throw new ProviderError('Cancelled', { code: 'cancelled' });
    current = cand;
    try {
      opts.onLog?.('info', `→ ${cand.provider.name} · ${cand.model.name}${cand.demo ? ' (demo engine)' : ''}`);
      const ctx = await buildContext(req, cand, opts);
      const gen = cand.adapter.generate({ ...req, modelId: (cand.model.config?.driverModel as string) ?? cand.model.driverModel ?? req.modelId, meta: { ...req.meta, driverModel: cand.model.driverModel, modelConfig: cand.model.config, providerId: cand.provider.id } }, ctx);
      let res: GenerationResult | undefined;
      for (;;) {
        const step = await gen.next();
        if (step.done) { res = step.value; break; }
        const ev = step.value;
        if (typeof ev.progress === 'number') opts.onProgress?.(ev.progress, ev.stage);
        if (ev.log) opts.onLog?.(ev.log.level, ev.log.msg);
      }
      if (!res || !res.ok) throw new ProviderError(res?.error?.message ?? 'Provider returned no result', { code: 'empty_output', retryable: true });
      attempts.push({ modelId: cand.model.id, providerId: cand.provider.id });
      return { ...res, modelId: cand.model.id, providerId: cand.provider.id, demo: cand.demo, route: cand, attempts };
    } catch (err) {
      const e = err as ProviderError;
      const retryable = e?.retryable ?? false;
      const canFallback = retryable || e?.code === 'payment_required';
      const cancelled = e?.code === 'cancelled' || opts.signal.aborted;
      attempts.push({ modelId: cand.model.id, providerId: cand.provider.id, error: e?.message ?? String(err) });
      opts.onLog?.('error', `${cand.model.name} failed: ${e?.message ?? String(err)}`);
      lastErr = err;
      if (cancelled || !canFallback) break;
      opts.onLog?.('warn', 'Attempting fallback provider…');
    }
  }
  throw lastErr instanceof Error ? lastErr : new ProviderError('Generation failed', { code: 'unknown', retryable: true });
}

async function buildContext(req: GenerationRequest, decision: RouteDecision, opts: ExecuteOptions): Promise<ProviderContext> {
  const cred = decision.credential.apiKey
    ? decision.credential
    : await resolveCredential(decision.provider, opts.userId);
  const st = storage();
  return {
    apiKey: cred.apiKey,
    baseUrl: cred.baseUrl ?? decision.provider.baseUrl,
    extra: cred.extra ?? {},
    jobId: opts.jobId,
    signal: opts.signal,
    platformKey: cred.source === 'env' ? 'env' : undefined,
    async fetchRef(ref: ImageRef) {
      if (!ref) return null;
      if (ref.dataUrl) {
        const m = /^data:([^;]+);base64,(.*)$/.exec(ref.dataUrl);
        if (m) return { data: new Uint8Array(Buffer.from(m[2], 'base64')), mime: m[1] };
        return null;
      }
      if (ref.key) {
        const data = await st.get(ref.key);
        return data ? { data, mime: mimeOf(ref.key, ref.mime) } : null;
      }
      if (ref.url) {
        try {
          const key = decodeURIComponent(new URL(ref.url, 'http://x').pathname).replace(/^\/api\/files\//, '');
          const data = await st.get(key);
          if (data) return { data, mime: mimeOf(key, ref.mime) };
          const r = await fetch(ref.url);
          if (r.ok) return { data: new Uint8Array(await r.arrayBuffer()), mime: r.headers.get('content-type') ?? 'application/octet-stream' };
        } catch { /* fallthrough */ }
      }
      return null;
    },
    log(level, msg) { opts.onLog?.(level, msg); }
  };
}

function mimeOf(key: string, fallback?: string) {
  const e = key.split('.').pop()?.toLowerCase();
  return ({ svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', wav: 'audio/wav', mp3: 'audio/mpeg', json: 'application/json' } as Record<string, string>)[e ?? ''] ?? fallback ?? 'application/octet-stream';
}

export interface RouteEstimate {
  model: string;
  provider: string;
  providerId: string;
  strategy: RouteStrategy;
  reason: string;
  credentialSource: 'user' | 'env' | 'none';
  fallbacks: { model: string; provider: string; providerId: string }[];
}

export interface EstimateResult extends RouteEstimate {
  credits: number;
  breakdown: string;
  demo: boolean;
}

/** Estimate credits for a request before it is queued (used by confirm dialogs). */
export async function estimate(req: GenerationRequest, opts: RouteOptions): Promise<EstimateResult> {
  try {
    const d = await route({ ...opts, req });
    const est = d.adapter.estimateCost(req, d.model);
    return {
      credits: d.demo ? 0 : est.credits,
      breakdown: d.demo ? 'Demo engine — 0 credits' : est.breakdown,
      model: d.model.name,
      provider: d.provider.name,
      providerId: d.provider.id,
      strategy: d.strategy,
      reason: d.reason,
      credentialSource: d.credential.source,
      fallbacks: d.fallbacks.map(fallback => ({ model: fallback.model.name, provider: fallback.provider.name, providerId: fallback.provider.id })),
      demo: d.demo
    };
  } catch (err) {
    return {
      credits: 0,
      breakdown: (err as Error).message,
      model: '—',
      provider: '—',
      providerId: '—',
      strategy: opts.strategy ?? 'quality',
      reason: (err as Error).message,
      credentialSource: 'none',
      fallbacks: [],
      demo: true
    };
  }
}

export async function isDemoMode(userId: string): Promise<boolean> {
  if (config.demoMode === 'on') return true;
  if (config.demoMode === 'off') return false;
  const db = await getDb();
  const creds = await db.repo('credentials').count({ where: { userId } });
  if (creds > 0) return false;
  return !Object.values(config.platformKeys).some(Boolean);
}
