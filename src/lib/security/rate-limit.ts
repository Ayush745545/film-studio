import { config } from '../config';

/**
 * Sliding-window in-process rate limiter, keyed by user id or IP.
 * For multi-instance deployments swap `store` for a Redis-backed counter —
 * the interface stays the same.
 */
interface Bucket { hits: number[] }
const gr = globalThis as unknown as { afsRate?: Map<string, Bucket> };
const store: Map<string, Bucket> = (gr.afsRate ??= new Map());

export interface RateLimitResult { ok: boolean; remaining: number; limit: number; retryAfterMs: number }

export function rateLimit(key: string, opts?: { max?: number; windowMs?: number }): RateLimitResult {
  const max = opts?.max ?? config.rateLimit.max;
  const windowMs = opts?.windowMs ?? config.rateLimit.windowMs;
  const now = Date.now();
  let b = store.get(key);
  if (!b) { b = { hits: [] }; store.set(key, b); }
  b.hits = b.hits.filter(t => now - t < windowMs);
  if (b.hits.length >= max) {
    return { ok: false, remaining: 0, limit: max, retryAfterMs: windowMs - (now - (b.hits[0] ?? now)) };
  }
  b.hits.push(now);
  return { ok: true, remaining: max - b.hits.length, limit: max, retryAfterMs: 0 };
}

/** Cheap guard for expensive endpoints (generation, export, credential tests). */
export function strictLimit(key: string, max = 30, windowMs = 60_000) {
  return rateLimit(`${key}:strict`, { max, windowMs });
}

let sweep: NodeJS.Timeout | null = null;
export function startRateLimitSweeper() {
  if (sweep) return;
  sweep = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of store) {
      b.hits = b.hits.filter(t => now - t < config.rateLimit.windowMs * 4);
      if (!b.hits.length) store.delete(k);
    }
  }, 120_000);
  if (typeof sweep.unref === 'function') sweep.unref();
}
