import { api, notFound } from '@/lib/api';
import { getProject, listVersions, snapshot } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  return { versions: await listVersions(params.id, 60), rev: p.rev };
});

export const POST = api(async ({ user, params, json }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const body = await json<{ reason?: string; label?: string }>().catch(() => ({ reason: 'Manual save' }));
  const v = await snapshot(params.id, user.id, body.reason ?? 'Manual save', p.stage);
  return v;
});
