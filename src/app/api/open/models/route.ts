export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreListModels } from '@/lib/api-core';

/** Read-only. Adding or changing models stays on the session API. */
export const GET = openApi(async ({ query }) =>
  coreListModels(query().get('kind'), query().get('capability')),
{ scope: 'models' });
