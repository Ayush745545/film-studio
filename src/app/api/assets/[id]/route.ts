import { api, notFound, forbidden } from '@/lib/api';
import { deleteAsset, duplicateAsset, getAsset, renameAsset } from '@/lib/assets';
import { getDb } from '@/lib/db';
import { nowIso } from '@/lib/ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const a = await getAsset(params.id);
  if (!a) throw notFound('Asset not found');
  if (a.userId !== user.id) throw forbidden('Not your asset');
  return a;
});

export const PATCH = api(async ({ user, params, json }) => {
  const body = await json<{ name?: string; tags?: string[]; meta?: Record<string, unknown>; action?: string }>();
  if (body.action === 'duplicate') return await duplicateAsset(params.id, user.id);
  const a = await getAsset(params.id);
  if (!a) throw notFound('Asset not found');
  if (a.userId !== user.id) throw forbidden('Not your asset');
  const db = await getDb();
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 160);
  if (Array.isArray(body.tags)) patch.tags = body.tags.slice(0, 24).map(String);
  if (body.meta && typeof body.meta === 'object') patch.meta = { ...(a.meta ?? {}), ...body.meta };
  return await db.repo('assets').update(params.id, patch as never);
});

export const DELETE = api(async ({ user, params }) => {
  const ok = await deleteAsset(params.id, user.id);
  if (!ok) throw notFound('Asset not found');
  return { deleted: true };
}, { strict: true });
