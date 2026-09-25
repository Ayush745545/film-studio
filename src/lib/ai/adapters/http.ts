import { classifyHttpError, ProviderError, readJson } from '../types';

export async function http(
  url: string,
  init: RequestInit & { expectJson?: boolean; timeoutMs?: number } = {}
): Promise<{ status: number; body: any; raw: string; headers: Headers }> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 300_000);
  const external = init.signal;
  const onAbort = () => ctrl.abort();
  external?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const raw = await res.text();
    let body: any = raw;
    try { body = JSON.parse(raw); } catch { /* keep text */ }
    return { status: res.status, body, raw, headers: res.headers };
  } catch (err) {
    const e = err as Error;
    if (e.name === 'AbortError' && external?.aborted) {
      throw new ProviderError('Cancelled', { code: 'cancelled', retryable: false });
    }
    throw new ProviderError(`Network error contacting ${new URL(url).host}: ${e.message}`, {
      code: 'network', retryable: true,
      suggestion: 'Check the Base URL, that the service is running, and that this host is reachable from the server.'
    });
  } finally {
    clearTimeout(t);
    external?.removeEventListener('abort', onAbort);
  }
}

export async function httpJson(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const r = await http(url, {
    ...init,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(init.headers ?? {}) }
  });
  if (r.status >= 400) throw classifyHttpError(r.status, r.raw);
  return r.body;
}

export async function httpBytes(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 600_000);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (res.status >= 400) throw classifyHttpError(res.status, (await res.text()).slice(0, 400));
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    return { data: new Uint8Array(await res.arrayBuffer()), mime };
  } catch (err) {
    const e = err as Error;
    if (e instanceof ProviderError) throw e;
    throw new ProviderError(`Download failed: ${e.message}`, { code: 'download', retryable: true });
  } finally { clearTimeout(t); }
}

export const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
export const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

export const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new ProviderError('Cancelled', { code: 'cancelled' })); }, { once: true });
});

/** Exponential backoff with jitter for idempotent reads (polling). */
export async function poll<T>(
  fn: () => Promise<{ done: boolean; value?: T; progress?: number; stage?: string }>,
  opts: { signal?: AbortSignal; intervalMs?: number; maxMs?: number; onProgress?: (p: number, s?: string) => void } = {}
): Promise<T> {
  const started = Date.now();
  let interval = opts.intervalMs ?? 1500;
  const maxMs = opts.maxMs ?? 20 * 60_000;
  for (;;) {
    if (opts.signal?.aborted) throw new ProviderError('Cancelled', { code: 'cancelled' });
    const r = await fn();
    if (typeof r.progress === 'number' && opts.onProgress) opts.onProgress(r.progress, r.stage);
    if (r.done) return r.value as T;
    if (Date.now() - started > maxMs) {
      throw new ProviderError('Provider did not finish in time', { code: 'timeout', retryable: true, suggestion: 'Retry, or choose a faster model.' });
    }
    await sleep(interval + Math.random() * 400, opts.signal);
    interval = Math.min(interval * 1.25, 6000);
  }
}

/** `a.b[0].c` path lookup used by the custom-HTTP mapping engine. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce<unknown>((acc, k) => {
    if (acc == null) return undefined;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

/** Very small `{{token}}` templating engine for custom provider bodies. */
export function template(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_, p) => {
    const v = getPath(vars, p);
    return v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  });
}
