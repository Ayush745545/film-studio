import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { FileDriver } from './file-driver';
import { PrismaDriver } from './prisma-driver';
import type { CollectionName, EntityOf, Query, Repo } from './types';

export * from './types';
export { applyQuery, matches } from './match';

/**
 * Unified persistence facade.
 *
 *   db.repo('projects').findMany({ where: { userId } })
 *
 * Backed by PostgreSQL + Prisma when DATABASE_URL answers, otherwise by the
 * embedded file driver. Application code never branches on the driver.
 */
export interface Database {
  readonly driverName: 'file' | 'prisma';
  repo<K extends CollectionName>(name: K): Repo<EntityOf<K>>;
  flush(): Promise<void>;
  info(): { driver: string; detail: string };
}

class FileDatabase implements Database {
  readonly driverName = 'file' as const;
  constructor(private inner: FileDriver) {}
  repo<K extends CollectionName>(n: K) { return this.inner.repo(n); }
  flush() { return this.inner.flush(); }
  info() { return { driver: 'file', detail: path.resolve(config.dataDir, 'db') }; }
}

class PrismaDatabase implements Database {
  readonly driverName = 'prisma' as const;
  constructor(private inner: PrismaDriver) {}
  repo<K extends CollectionName>(n: K) { return this.inner.repo(n); }
  async flush() { /* postgres commits synchronously per operation */ }
  info() { return { driver: 'prisma', detail: 'postgresql' }; }
}

interface GlobalStore {
  afsDb?: Database;
  afsDbAttempted?: boolean;
  afsFile?: FileDriver;
}
const g = globalThis as unknown as GlobalStore;

async function probePostgres(url: string): Promise<boolean> {
  try {
    const u = new URL(url);
    const net = await import('node:net');
    return await new Promise<boolean>(resolve => {
      const sock = net.connect({ host: u.hostname, port: Number(u.port || 5432), timeout: 2500 }, () => { sock.destroy(); resolve(true); });
      sock.on('error', () => { sock.destroy(); resolve(false); });
      sock.on('timeout', () => { sock.destroy(); resolve(false); });
    });
  } catch { return false; }
}

async function build(): Promise<Database> {
  const want = config.dbDriver;
  if (want !== 'file' && config.databaseUrl) {
    const reachable = want === 'prisma' ? true : await probePostgres(config.databaseUrl);
    if (reachable) {
      try {
        const { PrismaClient } = await import('@prisma/client');
        const client = new PrismaClient({ datasources: { db: { url: config.databaseUrl } }, log: ['warn', 'error'] });
        await client.$queryRaw`SELECT 1`;
        const drv = await new PrismaDriver(client as unknown as Record<string, any>).init();
        console.log('[db] driver = prisma/postgresql');
        return new PrismaDatabase(drv);
      } catch (err) {
        console.warn('[db] postgres unavailable, falling back to embedded file driver:', (err as Error).message.split('\n')[0]);
      }
    } else if (want === 'auto') {
      console.log('[db] DATABASE_URL set but host unreachable — using embedded file driver');
    }
  }
  fs.mkdirSync(path.resolve(config.dataDir), { recursive: true });
  g.afsFile ??= new FileDriver(path.resolve(config.dataDir));
  console.log(`[db] driver = file (${path.resolve(config.dataDir, 'db')})`);
  return new FileDatabase(g.afsFile);
}

let pending: Promise<Database> | null = null;

/** Await this in every server entrypoint. Cached for the process lifetime. */
export function getDb(): Promise<Database> {
  if (g.afsDb) return Promise.resolve(g.afsDb);
  if (!pending) pending = build().then(d => { g.afsDb = d; return d; });
  return pending;
}

/** Convenience accessor for repos. */
export async function repo<K extends CollectionName>(name: K): Promise<Repo<EntityOf<K>>> {
  return (await getDb()).repo(name);
}

export async function flushDb() { const d = await getDb(); await d.flush(); }

/** Flush pending writes before the process exits (file driver only). */
export async function syncDb() {
  const d = await getDb();
  await d.flush();
  const f = (g.afsFile as unknown as { sync?: () => Promise<void> } | undefined)?.sync;
  if (f) await g.afsFile!.sync();
}

export async function dbInfo() { const d = await getDb(); return d.info(); }

/** Generic helpers used across the API layer. */
export async function findMany<K extends CollectionName>(c: K, q?: Query<EntityOf<K>>) { return (await getDb()).repo(c).findMany(q); }
export async function findFirst<K extends CollectionName>(c: K, q?: Query<EntityOf<K>>) { return (await getDb()).repo(c).findFirst(q); }
export async function findById<K extends CollectionName>(c: K, id: string) { return (await getDb()).repo(c).findUnique(id); }
