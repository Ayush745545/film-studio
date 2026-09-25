import { api, notFound } from '@/lib/api';
import { getProject, restoreVersion } from '@/lib/project';
import { audit } from '@/lib/security/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(async ({ user, params, ip }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const project = await restoreVersion(params.id, params.vid, user.id);
  if (!project) throw notFound('Version not found');
  await audit({ userId: user.id, action: 'project.restore', entity: 'project', entityId: params.id, ip, meta: { versionId: params.vid } });
  return project;
}, { strict: true });
