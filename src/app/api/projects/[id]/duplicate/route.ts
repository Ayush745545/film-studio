import { api, notFound } from '@/lib/api';
import { duplicateProject, getProject } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(async ({ user, params }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const copy = await duplicateProject(params.id, user.id);
  if (!copy) throw notFound('Could not duplicate project');
  return copy;
}, { strict: true });
