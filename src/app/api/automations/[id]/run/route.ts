import { api, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { startRun } from '@/lib/automation/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(async ({ user, params, json }) => {
  const body = await json<{ projectId?: string | null; vars?: Record<string, unknown> }>().catch(() => ({}) as any);
  const db = await getDb();
  const a = await db.repo('automations').findUnique(params.id);
  if (!a) throw badRequest('Workflow not found');
  const run = await startRun(params.id, user.id, body.projectId ?? undefined, body.vars ?? {});
  return run;
}, { strict: true });
