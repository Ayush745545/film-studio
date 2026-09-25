export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreGetProject, coreUpdateProject, coreDeleteProject } from '@/lib/api-core';

export const GET = openApi(async ({ user, ip, params }) =>
  coreGetProject({ userId: user.id, ip }, params.id),
{ scope: 'projects' });

export const PATCH = openApi(async ({ user, ip, params, json }) =>
  coreUpdateProject({ userId: user.id, ip }, params.id, await json()),
{ scope: 'projects', auditAction: 'open.project.update' });

export const DELETE = openApi(async ({ user, ip, params }) =>
  coreDeleteProject({ userId: user.id, ip }, params.id),
{ scope: 'projects', method: 'DELETE', auditAction: 'open.project.delete' });
