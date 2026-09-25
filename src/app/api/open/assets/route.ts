export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreListAssets } from '@/lib/api-core';

export const GET = openApi(async ({ user, ip, query }) =>
  coreListAssets({ userId: user.id, ip }, {
    projectId: query().get('projectId'),
    kinds: query().get('kinds'),
    q: query().get('q'),
    scope: query().get('scope')
  }),
{ scope: 'assets' });
