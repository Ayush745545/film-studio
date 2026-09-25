export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreListJobs } from '@/lib/api-core';

export const GET = openApi(async ({ user, ip, query }) =>
  coreListJobs({ userId: user.id, ip }, {
    status: query().get('status'),
    projectId: query().get('projectId')
  }),
{ scope: 'generate' });
