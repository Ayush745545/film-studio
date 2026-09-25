'use client';
/** Client-safe id helpers (no node:crypto). Mirrors src/lib/ids for UI-created rows. */
export function uid(prefix = ''): string {
  const raw = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `${prefix ? prefix + '_' : ''}${raw.slice(0, 20)}`;
}
export function shortId(n = 8): string { return uid().slice(0, n); }
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export function formatBytes(n: number): string {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function formatSeconds(s: number): string {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60); const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
