import { randomUUID } from 'node:crypto';
import type { Query, Repo, CollectionName, EntityOf, Entity } from './types';

/**
 * PostgreSQL driver (Prisma).
 *
 * Domain entities are camelCase and provider-agnostic; this layer maps them
 * onto the relational schema in prisma/schema.prisma. Column allow-lists are
 * read from the generated DMMF at runtime so the driver cannot break when the
 * schema evolves.
 */

type PrismaClientLike = Record<string, any>;

const MODEL_OF: Record<CollectionName, string> = {
  users: 'User', sessions: 'Session', teams: 'Team', teamMembers: 'TeamMember',
  projects: 'Project', projectVersions: 'ProjectVersion', stories: 'Story', scripts: 'Script',
  characters: 'Character', locations: 'Location', worldBibles: 'WorldBible', scenes: 'Scene',
  shots: 'Shot', storyboards: 'Storyboard', assets: 'Asset', jobs: 'GenerationJob',
  providers: 'AiProvider', models: 'ModelDescriptor', credentials: 'ApiCredential',
  apiKeys: 'ApiKey',
  presets: 'ModelPreset', timelines: 'Timeline', tracks: 'TimelineTrack', clips: 'TimelineClip',
  voices: 'VoiceLine', sounds: 'SoundCue', exports: 'ExportJob', automations: 'Automation',
  runs: 'AutomationRun', subscriptions: 'Subscription', creditTxs: 'CreditTx',
  invoices: 'Invoice', auditLogs: 'AuditLog', kv: 'KvStore'
};

/** domain field → column (only where they differ) */
const FIELD_MAP: Partial<Record<CollectionName, Record<string, string>>> = {
  clips: { in: 'inPoint', out: 'outPoint', text: 'textData' },
  exports: { range: '__range' },
  kv: { id: 'key' },
  providers: { id: 'id' }
};
const DATE_COLUMNS = new Set(['createdAt', 'updatedAt', 'startedAt', 'finishedAt', 'lastTestedAt', 'lastOpenedAt', 'renewsAt', 'startedAt', 'expiresAt', 'issuedAt', 'periodStart', 'periodEnd', 'requestedAt']);

export class PrismaDriver {
  private client: PrismaClientLike;
  private columns = new Map<string, Set<string>>();
  private jsonColumns = new Map<string, Set<string>>();
  private dateColumns = new Map<string, Set<string>>();

  constructor(client: PrismaClientLike) { this.client = client; }

  /** Introspect the generated datamodel so writes only send known columns. */
  async init() {
    try {
      const { Prisma } = await import('@prisma/client');
      const models = (Prisma as any)?.dmmf?.datamodel?.models ?? [];
      for (const m of models) {
        const cols = new Set<string>(); const jsons = new Set<string>(); const dates = new Set<string>();
        for (const f of m.fields ?? []) {
          if (f.kind === 'object') continue;           // relations are never written here
          cols.add(f.name);
          if (f.type === 'Json') jsons.add(f.name);
          if (f.type === 'DateTime') dates.add(f.name);
        }
        this.columns.set(m.name, cols);
        this.jsonColumns.set(m.name, jsons);
        this.dateColumns.set(m.name, dates);
      }
    } catch (err) {
      console.warn('[db] prisma DMMF introspection unavailable, using permissive writes:', (err as Error).message);
    }
    return this;
  }

  private delegate(model: string) {
    const key = model.charAt(0).toLowerCase() + model.slice(1);
    const d = this.client[key];
    if (!d) throw new Error(`[db] unknown prisma model "${model}"`);
    return d;
  }

  private toRow(col: CollectionName, e: Partial<Entity>): Record<string, unknown> {
    const model = MODEL_OF[col];
    const allow = this.columns.get(model);
    const map = FIELD_MAP[col] ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(e)) {
      if (v === undefined) continue;
      const target = map[k] ?? k;
      if (target === '__range') {
        const r = v as [number, number] | null;
        out.rangeIn = r?.[0] ?? null; out.rangeOut = r?.[1] ?? null; continue;
      }
      if (allow && !allow.has(target)) continue;
      out[target] = v === null ? null : v;
    }
    if (allow?.has('updatedAt')) out.updatedAt = new Date();
    for (const [k, v] of Object.entries(out)) {
      if (typeof v === 'string' && this.dateColumns.get(model)?.has(k)) out[k] = new Date(v);
    }
    return out;
  }

  private fromRow(col: CollectionName, row: any): any {
    if (!row) return null;
    const model = MODEL_OF[col];
    const inv: Record<string, string> = {};
    for (const [a, b] of Object.entries(FIELD_MAP[col] ?? {})) if (b !== '__range') inv[b] = a;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      const name = inv[k] ?? k;
      out[name] = v instanceof Date ? v.toISOString() : (v as unknown);
    }
    if (col === 'exports') {
      out.range = row.rangeIn == null ? null : [row.rangeIn, row.rangeOut];
      delete out.rangeIn; delete out.rangeOut;
    }
    if (col === 'kv') out.id = row.key;
    if (col === 'clips') { out.in = row.inPoint; out.out = row.outPoint; out.text = row.textData ?? undefined; }
    void model;
    return out;
  }

  private toWhere(col: CollectionName, where?: Query['where']): any {
    if (!where) return undefined;
    const model = MODEL_OF[col];
    const allow = this.columns.get(model);
    const map = FIELD_MAP[col] ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(where)) {
      if (v === undefined) continue;
      if (k === '$or') {
        out.OR = (v as unknown as Record<string, unknown>[]).map(s => this.toWhere(col, s as Query['where']));
        continue;
      }
      const target = map[k] ?? k;
      if (allow && !allow.has(target)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const o = v as Record<string, unknown>; const p: Record<string, unknown> = {};
        if ('$in' in o) p.in = o.$in;
        if ('$nin' in o) p.notIn = o.$nin;
        if ('$contains' in o) { p.contains = o.$contains; if (o.$mode === 'insensitive') p.mode = 'insensitive'; }
        if ('$gt' in o) p.gt = o.$gt;
        if ('$gte' in o) p.gte = o.$gte;
        if ('$lt' in o) p.lt = o.$lt;
        if ('$lte' in o) p.lte = o.$lte;
        if ('$ne' in o) p.not = o.$ne;
        out[target] = p;
      } else {
        out[target] = v === null ? null : v;
      }
    }
    return Object.keys(out).length ? out : undefined;
  }

  private toArgs(col: CollectionName, q?: Query<any>) {
    const args: Record<string, unknown> = {};
    const w = this.toWhere(col, q?.where); if (w) args.where = w;
    if (q?.orderBy) {
      const map = FIELD_MAP[col] ?? {};
      args.orderBy = Object.entries(q.orderBy).map(([f, d]) => ({ [map[f] ?? f]: d }));
    }
    if (typeof q?.take === 'number') args.take = q.take;
    if (typeof q?.skip === 'number') args.skip = q.skip;
    return args;
  }

  repo<K extends CollectionName>(col: K): Repo<EntityOf<K>> {
    const model = MODEL_OF[col];
    const d = () => this.delegate(model);
    const self = this;
    return {
      async findMany(q) { const rows = await d().findMany(self.toArgs(col, q)); return rows.map((r: any) => self.fromRow(col, r)); },
      async findFirst(q) { const r = await d().findFirst(self.toArgs(col, q)); return r ? self.fromRow(col, r) : null; },
      async findUnique(id) {
        const where = col === 'kv' ? { key: id } : { id };
        const r = await d().findUnique({ where }); return r ? self.fromRow(col, r) : null;
      },
      async create(data) {
        const row = self.toRow(col, { ...(data as object), id: (data as any).id ?? randomUUID() });
        if (col === 'kv') (row as any).key = (data as any).id ?? (data as any).key;
        const r = await d().create({ data: row });
        return self.fromRow(col, r);
      },
      async createMany(list) { const out = []; for (const it of list) out.push(await this.create(it)); return out; },
      async update(id, patch) {
        const row = self.toRow(col, patch); delete row.id; delete (row as any).key;
        try {
          const r = await d().update({ where: col === 'kv' ? { key: id } : { id }, data: row });
          return self.fromRow(col, r);
        } catch (e: any) { if (e?.code === 'P2025') return null; throw e; }
      },
      async upsert(id, data) {
        const row = self.toRow(col, { ...(data as object), id });
        if (col === 'kv') (row as any).key = id;
        const r = await d().upsert({ where: col === 'kv' ? { key: id } : { id }, create: row, update: row });
        return self.fromRow(col, r);
      },
      async delete(id) {
        try { await d().delete({ where: col === 'kv' ? { key: id } : { id } }); return true; }
        catch (e: any) { if (e?.code === 'P2025') return false; throw e; }
      },
      async deleteWhere(q) {
        const w = self.toWhere(col, q?.where);
        const r = await d().deleteMany(w ? { where: w } : {});
        return r.count as number;
      },
      async count(q) {
        const w = self.toWhere(col, q?.where);
        return (await d().count(w ? { where: w } : {})) as number;
      }
    };
  }

  async disconnect() { try { await this.client.$disconnect(); } catch { /* noop */ } }
}

export { MODEL_OF };
