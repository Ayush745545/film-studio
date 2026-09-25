/**
 * Isomorphic id/hash helpers.
 *
 * Deliberately dependency-free (no node:crypto) so the same module can be
 * imported by server workers AND by client components — timeline ops, scene
 * breakdown and screenplay formatting are shared code paths and must not be
 * duplicated. Secret hashing lives in src/lib/security/crypto instead.
 */
export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  const raw = c && 'randomUUID' in c
    ? c.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix ? prefix + '_' : ''}${raw.slice(0, 20)}`;
}

export const shortId = (n = 8): string => uid().slice(0, n);
export const nowIso = (): string => new Date().toISOString();

/** Stable, human-friendly token: `character_alex_01` */
export function slugToken(prefix: string, name: string, n = 1): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'untitled';
  return `${prefix}_${s}_${String(n).padStart(2, '0')}`;
}
export function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'untitled';
}
/** Deterministic 31-bit hash — used for seeds so regeneration is reproducible. */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 2147483647;
}
/** Mulberry32 — small deterministic PRNG shared by server generators and the client renderer. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(r: () => number, arr: readonly T[]): T { return arr[Math.floor(r() * arr.length) % arr.length]; }
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
