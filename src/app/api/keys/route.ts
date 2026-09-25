import { api, badRequest } from '@/lib/api';
import { createKey, listKeys, KEY_SCOPES, type KeyScope } from '@/lib/security/api-keys';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Developer API keys.
 *
 * Session-authenticated on purpose: issuing a key is a privilege escalation, so
 * it must require an interactive sign-in and must NOT be doable with an existing
 * key. Otherwise one leaked key could mint more keys and survive its own
 * revocation.
 */

export const GET = api(async ({ user }) => {
  return { keys: await listKeys(user.id), availableScopes: KEY_SCOPES };
});

export const POST = api(async ({ user, json, ip }) => {
  const body = await json<{ name?: string; scopes?: string[]; expiresInDays?: number | null }>();
  const name = (body.name ?? '').trim();
  if (!name) throw badRequest('A name is required', 'Something like "Render farm" or "CI deploy" so you know what to revoke later.');
  if (name.length > 60) throw badRequest('That name is too long', 'Keep it under 60 characters.');

  const scopes = body.scopes ?? [];
  if (!Array.isArray(scopes)) throw badRequest('scopes must be an array');
  const unknown = scopes.filter(s => !(KEY_SCOPES as readonly string[]).includes(s));
  if (unknown.length) {
    throw badRequest(`Unknown scope${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`,
      `Available scopes: ${KEY_SCOPES.join(', ')}. Send an empty list for a key that can do everything.`);
  }

  const days = body.expiresInDays;
  if (days !== null && days !== undefined) {
    if (typeof days !== 'number' || !Number.isFinite(days) || days <= 0 || days > 3650) {
      throw badRequest('expiresInDays must be a number of days between 1 and 3650', 'Or omit it for a key that does not expire.');
    }
  }

  const created = await createKey({
    userId: user.id, name, scopes: scopes as KeyScope[],
    expiresInDays: days ?? null, ip
  });

  // The plaintext exists only in this response. Nothing downstream can recover
  // it — the database holds a hash, and it is not in the audit log.
  return created;
}, { strict: true, method: 'POST', auditAction: 'apikey.create' });
