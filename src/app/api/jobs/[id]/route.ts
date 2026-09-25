import { api, notFound, forbidden } from '@/lib/api';
import { getDb } from '@/lib/db';
import { cancelJob, retryJob, pauseJob, resumeJob, setPriority, sanitise } from '@/lib/queue';
import type { GenerationJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owned(id: string, userId: string) {
  const db = await getDb();
  const j = await db.repo('jobs').findUnique(id) as unknown as GenerationJob | null;
  if (!j) throw notFound('Job not found');
  if (j.userId !== userId) throw forbidden('Not your job');
  return j;
}

export const GET = api(async ({ user, params }) => sanitise(await owned(params.id, user.id)));

export const PATCH = api(async ({ user, params, json }) => {
  const j = await owned(params.id, user.id);
  const body = await json<{ action?: string; priority?: number }>();
  switch (body.action) {
    case 'cancel': return { ok: await cancelJob(j.id, user.id) };
    case 'retry': return { ok: await retryJob(j.id, user.id) };
    case 'pause': return { ok: await pauseJob(j.id, user.id) };
    case 'resume': return { ok: await resumeJob(j.id, user.id) };
    case 'priority': return { ok: await setPriority(j.id, user.id, Math.max(-10, Math.min(10, Number(body.priority ?? 0)))) };
    default: return { ok: false };
  }
}, { strict: true });

export const DELETE = api(async ({ user, params }) => {
  const j = await owned(params.id, user.id);
  await cancelJob(j.id, user.id);
  const db = await getDb();
  await db.repo('jobs').delete(j.id);
  return { deleted: true };
}, { strict: true });
