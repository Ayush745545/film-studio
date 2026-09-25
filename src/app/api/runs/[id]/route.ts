import { api, notFound, forbidden } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { AutomationRun } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const db = await getDb();
  const r = await db.repo('runs').findUnique(params.id) as unknown as AutomationRun | null;
  if (!r) throw notFound('Run not found');
  if (r.userId !== user.id) throw forbidden('Not your run');
  const a = await db.repo('automations').findUnique(r.automationId);
  return { run: r, automation: a };
});
