import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { AutomationRun } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const db = await getDb();
  const rows = await db.repo('runs').findMany({ where: { userId: user.id }, orderBy: { startedAt: 'desc' }, take: 60 }) as unknown as AutomationRun[];
  const waiting = rows.filter(r => r.status === 'waiting');
  const projectId = query().get('projectId');
  return { runs: projectId ? rows.filter(r => r.projectId === projectId) : rows, waiting };
});
