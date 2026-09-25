export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { coreGenerate } from '@/lib/api-core';

/**
 * Enqueue a generation and return the job.
 *
 * Long renders never run inside the request: poll GET /api/open/jobs/{id} for
 * status, then read the asset ids off the finished job. Send
 * `{ "dryRun": true }` to price a request without spending credits.
 */
export const POST = openApi(async ({ user, ip, json }) =>
  coreGenerate({ userId: user.id, ip }, await json()),
{ scope: 'generate', method: 'POST', auditAction: 'open.generate' });
