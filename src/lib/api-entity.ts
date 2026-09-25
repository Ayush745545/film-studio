import { api, notFound, forbidden, badRequest } from './api';
import { getDb } from './db';
import { nowIso, uid } from './ids';
import type { CollectionName } from './db/types';

/**
 * Factory for the per-entity routes (characters, locations, scenes, shots,
 * voice lines, sound cues). Ownership is enforced from the parent project, so
 * a user can never touch another user's rows by guessing an id.
 */
export function entityRoutes<K extends CollectionName>(
  collection: K,
  opts: {
    projectField?: string;
    writable?: string[];
    defaults?: Record<string, unknown>;
    beforeSave?: (row: any, patch: any) => any;
    afterDelete?: (row: any) => Promise<void> | void;
  } = {}
) {
  const projectField = opts.projectField ?? 'projectId';
  const writable = new Set(opts.writable ?? []);

  async function owned(id: string, userId: string) {
    const db = await getDb();
    const row = await db.repo(collection).findUnique(id) as any;
    if (!row) throw notFound('Not found');
    const projectId = row[projectField];
    if (projectId) {
      const p = await db.repo('projects').findUnique(projectId) as any;
      if (!p || p.userId !== userId) throw forbidden('Not your project');
    } else if (row.userId && row.userId !== userId) throw forbidden('Not yours');
    return row;
  }

  return {
    GET: api(async ({ user, params }) => owned(params.id, user.id)),

    PATCH: api(async ({ user, params, json }) => {
      const row = await owned(params.id, user.id);
      const body = await json<Record<string, unknown>>();
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(body)) {
        if (k === 'id' || k === projectField) continue;
        if (writable.size && !writable.has(k)) continue;
        patch[k] = v;
      }
      patch.updatedAt = nowIso();
      const db = await getDb();
      const next = opts.beforeSave ? opts.beforeSave(row, patch) : patch;
      const updated = await db.repo(collection).update(params.id, next as never);
      if (!updated) throw notFound('Not found');
      return updated;
    }),

    DELETE: api(async ({ user, params }) => {
      const row = await owned(params.id, user.id);
      const db = await getDb();
      await opts.afterDelete?.(row);
      await db.repo(collection).delete(params.id);
      return { deleted: true };
    }, { strict: true }),

    /** Create under a project. */
    POST: api(async ({ user, params, json }) => {
      const db = await getDb();
      const projectId = params.projectId ?? params.id;
      const p = await db.repo('projects').findUnique(projectId) as any;
      if (!p || p.userId !== user.id) throw forbidden('Not your project');
      const body = await json<Record<string, unknown>>();
      if (!writable.size) throw badRequest('This collection is read-only');
      const row: Record<string, unknown> = { id: uid(String(collection).slice(0, 3)), [projectField]: projectId, createdAt: nowIso(), updatedAt: nowIso(), ...(opts.defaults ?? {}) };
      for (const [k, v] of Object.entries(body)) if (writable.has(k)) row[k] = v;
      const created = await db.repo(collection).create(row as never);
      return created;
    })
  };
}
