import { api, notFound, forbidden } from '@/lib/api';
import { getDb } from '@/lib/db';
import { nowIso } from '@/lib/ids';
import type { Automation } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owned(id: string, userId: string) {
  const db = await getDb();
  const a = await db.repo('automations').findUnique(id) as unknown as Automation | null;
  if (!a) throw notFound('Workflow not found');
  if (a.userId !== userId) throw forbidden('Not your workflow');
  return a;
}

export const GET = api(async ({ user, params }) => {
  const a = await owned(params.id, user.id);
  const db = await getDb();
  const runs = await db.repo('runs').findMany({ where: { automationId: a.id }, orderBy: { startedAt: 'desc' }, take: 20 });
  return { automation: a, runs };
});

export const PATCH = api(async ({ user, params, json }) => {
  const a = await owned(params.id, user.id);
  const body = await json<Partial<Automation>>();
  const db = await getDb();
  const patch: Record<string, unknown> = { updatedAt: nowIso() };
  for (const k of ['name','description','nodes','edges','trigger','schedule','maxCostCredits','requireApproval','enabled'] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  return await db.repo('automations').update(a.id, patch as never);
}, { auditAction: 'automation.update' });

export const DELETE = api(async ({ user, params }) => {
  const a = await owned(params.id, user.id);
  const db = await getDb();
  await db.repo('automations').delete(a.id);
  return { deleted: true };
}, { strict: true });
