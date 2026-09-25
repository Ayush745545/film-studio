import { api, badRequest } from '@/lib/api';
import { resolveReview } from '@/lib/automation/engine';
import { audit } from '@/lib/security/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = api(async ({ user, params, json, ip }) => {
  const body = await json<{ decision: 'approve' | 'reject' | 'regenerate'; vars?: Record<string, unknown> }>();
  if (!['approve','reject','regenerate'].includes(body.decision)) throw badRequest('decision must be approve, reject or regenerate');
  const res = await resolveReview(params.id, user.id, body.decision, body.vars);
  await audit({ userId: user.id, action: `automation.review.${body.decision}`, entity: 'run', entityId: params.id, ip });
  return res;
}, { strict: true });
