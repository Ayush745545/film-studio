export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreGetJob } from '@/lib/api-core';

/** Poll this after POST /api/open/generate. `status` and `assetIds` are the fields to watch. */
export const GET = openApi(async ({ user, ip, params }) =>
  coreGetJob({ userId: user.id, ip }, params.id),
{ scope: 'generate' });
