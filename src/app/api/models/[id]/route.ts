import { api, notFound, forbidden, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { ModelDescriptor } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = api(async ({ user, params, json }) => {
  const db = await getDb();
  const m = await db.repo('models').findUnique(params.id) as unknown as ModelDescriptor | null;
  if (!m) throw notFound('Model not found');
  const body = await json<Partial<ModelDescriptor> & { setDefault?: boolean }>();
  const patch: Record<string, unknown> = {};
  for (const k of ['name','driverModel','quality','speed','costPerUnit','unit','enabled','capabilities','features','supportedRatios','supportedResolutions','contextWindow','maxDurationSec','config'] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (body.setDefault) {
    const sameKind = await db.repo('models').findMany({ where: { kind: m.kind } }) as unknown as ModelDescriptor[];
    for (const s of sameKind) if (s.isDefault) await db.repo('models').update(s.id, { isDefault: false } as never);
    patch.isDefault = true;
  }
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  return await db.repo('models').update(params.id, patch as never);
}, { auditAction: 'model.update' });

export const DELETE = api(async ({ params }) => {
  const db = await getDb();
  const m = await db.repo('models').findUnique(params.id) as unknown as ModelDescriptor | null;
  if (!m) throw notFound('Model not found');
  if (!m.custom) throw forbidden('Built-in catalogue models can be disabled, not deleted.');
  await db.repo('models').delete(params.id);
  return { deleted: true };
}, { strict: true });
