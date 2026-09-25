import { api, notFound } from '@/lib/api';
import { revokeKey } from '@/lib/security/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Revoke a developer API key.
 *
 * Revocation is immediate: `authenticateKey` checks `enabled` on every request,
 * and there is no cache of valid keys to invalidate. Session-authenticated for
 * the same reason as issuance — a key must not be able to revoke keys.
 */
export const DELETE = api(async ({ user, params }) => {
  const result = await revokeKey(user.id, params.id);
  // A key id is not a capability, so "yours" and "exists" are the same answer.
  if (!result.revoked) throw notFound('No such key');
  // Pass `alreadyRevoked` through: DELETE is idempotent, so a repeat call is not
  // an error, but a caller restoring a script should be able to tell "I revoked
  // this" from "this was already revoked".
  return result;
}, { strict: true, method: 'DELETE', auditAction: 'apikey.revoke' });
