'use client';
/** Deterministic 31-bit string hash — mirrors the server's hashSeed so seeds match. */
export function hashSeedish(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % 2147483647;
}
