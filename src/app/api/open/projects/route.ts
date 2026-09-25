export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreListProjects, coreCreateProject } from '@/lib/api-core';

export const GET = openApi(async ({ user, ip, query }) =>
  coreListProjects({ userId: user.id, ip }, query().get('q')),
{ scope: 'projects' });

export const POST = openApi(async ({ user, ip, json }) =>
  coreCreateProject({ userId: user.id, ip }, await json()),
{ scope: 'projects', method: 'POST', auditAction: 'open.project.create' });
