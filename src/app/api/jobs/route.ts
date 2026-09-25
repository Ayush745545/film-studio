import { api } from '@/lib/api';
import { queueSnapshot } from '@/lib/queue';
import { getDb } from '@/lib/db';
import type { GenerationJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const status = query().get('status');
  const projectId = query().get('projectId');
  const snap = await queueSnapshot(user.id);
  if (!status && !projectId) return snap;
  const db = await getDb();
  let rows = await db.repo('jobs').findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 }) as unknown as GenerationJob[];
  if (status) rows = rows.filter(j => j.status === status);
  if (projectId) rows = rows.filter(j => j.projectId === projectId);
  return { active: rows.filter(r => ['queued','running','paused'].includes(r.status)), recent: rows.filter(r => !['queued','running','paused'].includes(r.status)).slice(0, 60), counts: snap.counts };
});
