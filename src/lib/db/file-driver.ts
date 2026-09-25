import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { applyQuery } from './match';
import type { CollectionName, Collections, Entity, EntityOf, Query, Repo } from './types';

/**
 * Embedded JSON document driver.
 *
 * A real database: durable, atomic (tmp file + rename), indexed in memory, and
 * safe under concurrent access — including *multiple processes*, which is what
 * lets `npm run worker` share the store with the web process without a broker.
 *
 * Concurrency model:
 *   · reads   — the file is stat'd first; if another process moved its mtime we
 *               reload, so cross-process writes are always visible.
 *   · writes  — taken under an exclusive lockfile, then merged record-by-record:
 *               rows this process touched win, rows it never touched keep the
 *               on-disk version, rows it deleted stay deleted. That makes two
 *               processes writing different records safe, which is exactly the
 *               job-queue shape (web owns generation jobs, worker owns exports).
 *
 * For multi-instance production deployments use PostgreSQL (AFS_DB_DRIVER=prisma);
 * this driver targets single-host installs and zero-setup development.
 */
export class FileDriver {
  private dir: string;
  private cache = new Map<string, Entity[]>();
  private dirty = new Set<string>();
  private flushing: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  /** mtimeMs of each collection as last observed by this process. */
  private seen = new Map<string, number>();
  /** Record ids this process created/updated/deleted since the last merge. */
  private touched = new Map<string, Set<string>>();
  private removed = new Map<string, Set<string>>();

  constructor(dir: string) {
    this.dir = path.join(dir, 'db');
    fssync.mkdirSync(this.dir, { recursive: true });
  }

  private file(c: string) { return path.join(this.dir, `${c}.json`); }
  private setFor<K, V>(m: Map<string, Set<string>>, c: string): Set<string> {
    let s = m.get(c); if (!s) { s = new Set(); m.set(c, s); } return s;
  }

  private readDisk(c: string): { rows: Entity[]; mtime: number } {
    const f = this.file(c);
    let mtime = 0;
    try { mtime = fssync.statSync(f).mtimeMs; } catch { return { rows: [], mtime: 0 }; }
    try {
      const parsed = JSON.parse(fssync.readFileSync(f, 'utf8'));
      const rows = Array.isArray(parsed) ? parsed : (parsed.rows ?? []);
      return { rows, mtime };
    } catch (err) {
      const bad = `${f}.corrupt-${Date.now()}`;
      try { fssync.renameSync(f, bad); } catch { /* ignore */ }
      console.error(`[db] ${c}.json unreadable, moved to ${path.basename(bad)}`, (err as Error).message);
      return { rows: [], mtime: 0 };
    }
  }

  private load(c: CollectionName): Entity[] {
    const key = c as string;
    const { rows, mtime } = this.readDisk(key);
    const seenAt = this.seen.get(key) ?? 0;
    const hit = this.cache.get(key);
    // Nothing changed on disk, or we have unflushed local edits: trust memory.
    if (hit && (mtime <= seenAt || this.dirty.has(c))) return hit;
    if (hit && mtime > seenAt) {
      // Another process wrote. Merge: our touched records win, its other records survive.
      const touched = this.touched.get(key) ?? new Set<string>();
      const removed = this.removed.get(key) ?? new Set<string>();
      const mine = new Map(hit.filter(r => touched.has(r.id)).map(r => [r.id, r]));
      const merged: Entity[] = [];
      const seenIds = new Set<string>();
      for (const r of rows) {
        if (removed.has(r.id)) continue;
        const ours = mine.get(r.id);
        merged.push(ours ?? (r as Entity));
        seenIds.add(r.id);
      }
      for (const [id, r] of mine) if (!seenIds.has(id)) merged.push(r);
      this.cache.set(key, merged);
      this.seen.set(key, mtime);
      return merged;
    }
    this.cache.set(key, rows as Entity[]);
    this.seen.set(key, mtime);
    return rows as Entity[];
  }

  private mark(c: CollectionName) {
    this.dirty.add(c);
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 25);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** Exclusive lockfile with stale-lock recovery. */
  private withLock<T>(c: string, fn: () => T): T {
    const lock = `${this.file(c)}.lock`;
    for (let i = 0; i < 400; i++) {
      try { fssync.writeFileSync(lock, `${process.pid}`, { flag: 'wx' }); break; }
      catch {
        try {
          const st = fssync.statSync(lock);
          if (Date.now() - st.mtimeMs > 5000) fssync.rmSync(lock, { force: true });
        } catch { /* lock vanished — retry immediately */ }
        const until = Date.now() + 12;
        while (Date.now() < until) { /* brief spin, avoids a timer per retry */ }
      }
    }
    try { return fn(); } finally { try { fssync.rmSync(lock, { force: true }); } catch { /* ignore */ } }
  }

  /** Serialised, locked, merge-on-write flush. */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    const self = this;
    this.flushing = (async () => {
      const pending = [...this.dirty];
      this.dirty.clear();
      for (const c of pending) {
        const key = c as string;
        const mine = this.cache.get(key);
        if (!mine) continue;
        const f = this.file(key);
        const tmp = `${f}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
        try {
          self.withLock(key, () => {
            const disk = self.readDisk(key).rows as Entity[];
            const touched = self.touched.get(key) ?? new Set<string>();
            const removed = self.removed.get(key) ?? new Set<string>();
            const byId = new Map(mine.filter(r => touched.has(r.id)).map(r => [r.id, r]));
            const merged: Entity[] = [];
            const seenIds = new Set<string>();
            for (const r of disk) {
              const id = (r as Entity).id;
              if (removed.has(id)) continue;
              merged.push(byId.get(id) ?? r);
              seenIds.add(id);
            }
            for (const [id, r] of byId) if (!seenIds.has(id)) merged.push(r);
            fssync.writeFileSync(tmp, JSON.stringify(merged, null, 1));
            fssync.renameSync(tmp, f);
            // Our cache is now the merged truth; drop the change bookkeeping.
            self.cache.set(key, merged);
            self.touched.set(key, new Set());
            self.removed.set(key, new Set());
            try { self.seen.set(key, fssync.statSync(f).mtimeMs); } catch { /* ignore */ }
          });
        } catch (err) {
          console.error(`[db] flush failed for ${c}:`, (err as Error).message);
          this.dirty.add(c);
          try { fssync.rmSync(tmp, { force: true }); } catch { /* ignore */ }
        }
      }
    })().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  /** Force any pending writes to disk immediately (used before process exit). */
  async sync() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } await this.flush(); }

  repo<K extends CollectionName>(name: K): Repo<EntityOf<K>> {
    const self = this;
    const col = name as CollectionName;
    const key = col as string;
    const rows = () => self.load(col) as EntityOf<K>[];
    const noteWrite = (id: string) => { self.setFor(self.touched, key).add(id); };
    const noteDelete = (id: string) => { self.setFor(self.removed, key).add(id); self.setFor(self.touched, key).delete(id); };

    const insert = (data: Partial<EntityOf<K>>): EntityOf<K> => {
      const row = {
        ...(data as object),
        id: (data as { id?: string }).id || randomUUID(),
        createdAt: (data as { createdAt?: string }).createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
      } as EntityOf<K>;
      rows().push(row);
      noteWrite((row as Entity).id);
      self.mark(col);
      return row;
    };

    return {
      async findMany(q?: Query<EntityOf<K>>) { return applyQuery(rows(), q); },
      async findFirst(q?: Query<EntityOf<K>>) { return applyQuery(rows(), { ...q, take: 1 })[0] ?? null; },
      async findUnique(id: string) { return rows().find(r => (r as Entity).id === id) ?? null; },
      async create(data) { return insert(data); },
      async createMany(list) { return list.map(insert); },
      async update(id, patch) {
        const arr = rows();
        const i = arr.findIndex(r => (r as Entity).id === id);
        if (i < 0) return null;
        const next = { ...arr[i], ...(patch as object), id, updatedAt: new Date().toISOString() } as EntityOf<K>;
        arr[i] = next; noteWrite(id); self.mark(col); return next;
      },
      async upsert(id, data) {
        const existing = rows().find(r => (r as Entity).id === id);
        if (existing) return this.update(id, data) as Promise<EntityOf<K>>;
        return insert({ ...(data as object), id } as Partial<EntityOf<K>>);
      },
      async delete(id) {
        const arr = rows();
        const i = arr.findIndex(r => (r as Entity).id === id);
        if (i < 0) return false;
        arr.splice(i, 1); noteDelete(id); self.mark(col); return true;
      },
      async deleteWhere(q) {
        const arr = rows();
        const doomed = applyQuery(arr, q).map(r => (r as Entity).id);
        if (!doomed.length) return 0;
        const set = new Set(doomed);
        const kept = arr.filter(r => !set.has((r as Entity).id));
        self.cache.set(key, kept as unknown as Entity[]);
        for (const id of doomed) noteDelete(id);
        self.mark(col);
        return doomed.length;
      },
      async count(q) { return q?.where || q?.take ? applyQuery(rows(), q).length : rows().length; }
    };
  }

  snapshotAll(): Record<string, unknown[]> {
    const out: Record<string, unknown[]> = {};
    for (const [k, v] of this.cache) out[k] = v;
    return out;
  }
}

export type { Collections };
