import type { Query, WhereValue } from './types';

/** Shared query engine used by the file driver and to validate prisma filters. */
export function getDeep(obj: unknown, path: string): unknown {
  if (!path.includes('.')) return (obj as Record<string, unknown>)?.[path];
  let cur: unknown = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cmpVal(a: unknown, op: WhereValue): boolean {
  if (op === null) return a === null || a === undefined;
  if (typeof op === 'object' && op !== null && !Array.isArray(op)) {
    const o = op as Record<string, unknown>;
    if ('$in' in o) return Array.isArray(o.$in) && (o.$in as unknown[]).some(v => looseEq(a, v));
    if ('$nin' in o) return Array.isArray(o.$nin) && !(o.$nin as unknown[]).some(v => looseEq(a, v));
    if ('$contains' in o) {
      const hay = String(a ?? '').toLowerCase();
      const needle = String(o.$contains ?? '').toLowerCase();
      return hay.includes(needle);
    }
    if ('$gt' in o) return Number(a) > Number(o.$gt);
    if ('$gte' in o) return Number(a) >= Number(o.$gte);
    if ('$lt' in o) return Number(a) < Number(o.$lt);
    if ('$lte' in o) return Number(a) <= Number(o.$lte);
    if ('$ne' in o) return !looseEq(a, o.$ne);
    return true;
  }
  return looseEq(a, op);
}

function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  if (typeof a === 'boolean' || typeof b === 'boolean') return Boolean(a) === Boolean(b);
  return String(a) === String(b);
}

export function matches<T>(row: T, where?: Query<T>['where']): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (v === undefined) continue;
    if (k === '$or') {
      const arr = v as unknown as Record<string, WhereValue>[];
      if (!arr.some(sub => matches(row, sub as Query<T>['where']))) return false;
      continue;
    }
    if (!cmpVal(getDeep(row, k), v as WhereValue)) return false;
  }
  return true;
}

export function applyQuery<T>(rows: T[], q?: Query<T>): T[] {
  let out = q?.where ? rows.filter(r => matches(r, q.where)) : rows.slice();
  if (q?.orderBy) {
    const entries = Object.entries(q.orderBy);
    out = out.slice().sort((a, b) => {
      for (const [field, dir] of entries) {
        const av = getDeep(a, field); const bv = getDeep(b, field);
        let c = 0;
        if (typeof av === 'number' && typeof bv === 'number') c = av - bv;
        else c = String(av ?? '').localeCompare(String(bv ?? ''));
        if (c !== 0) return dir === 'desc' ? -c : c;
      }
      return 0;
    });
  }
  if (q?.skip) out = out.slice(q.skip);
  if (typeof q?.take === 'number') out = out.slice(0, q.take);
  return out;
}
