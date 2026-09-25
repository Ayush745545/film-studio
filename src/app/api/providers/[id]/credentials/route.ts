import { api, notFound, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { encryptSecret, maskKey, keyFingerprint } from '@/lib/security/crypto';
import { audit } from '@/lib/security/audit';
import { uid, nowIso } from '@/lib/ids';
import { normalizeProviderBaseUrl } from '@/lib/ai/credentials';
import type { ApiCredential, Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Store a provider API key.
 *
 * The plaintext key exists only for the duration of this request: it is
 * encrypted (AES-256-GCM) before it is written, and the response contains
 * only a mask and a fingerprint. The raw key is never returned, never logged
 * and never leaves the server process during generation.
 */
export const POST = api(async ({ user, params, json, ip }) => {
  const body = await json<{ apiKey?: string; baseUrl?: string; label?: string; extra?: Record<string, string> }>();
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(params.id) as unknown as Provider | null;
  if (!provider) throw notFound('Provider not found');
  const key = (body.apiKey ?? '').trim();
  if (!key) throw badRequest('An API key is required', 'Paste the key from your provider dashboard.');
  if (key.length < 8) throw badRequest('That does not look like an API key');
  if (key.length > 512) throw badRequest('API key is too long');
  let baseUrl: string | null;
  try { baseUrl = normalizeProviderBaseUrl(body.baseUrl); }
  catch (error) { throw badRequest((error as Error).message, 'Paste the API endpoint URL here; the API key belongs in the key field.'); }

  const existingRows = await db.repo('credentials').findMany({ where: { providerId: provider.id, userId: user.id } }) as unknown as ApiCredential[];
  const enc = encryptSecret(key);
  const label = (body.label ?? 'Default').trim().slice(0, 40);
  const id = existingRows[0]?.id ?? uid('cred');
  const row = {
    id, providerId: provider.id, userId: user.id, label,
    encryptedKey: enc.ciphertext, iv: enc.iv, tag: enc.tag,
    maskedKey: maskKey(key), keyFingerprint: keyFingerprint(key),
    baseUrl, extra: body.extra ?? {},
    status: 'untested' as const, lastTestedAt: null, lastError: null, scopes: [],
    createdAt: existingRows[0]?.createdAt ?? nowIso(), updatedAt: nowIso()
  };
  await db.repo('credentials').upsert(id, row as never);
  for (const duplicate of existingRows.slice(1)) await db.repo('credentials').delete(duplicate.id);
  await audit({ userId: user.id, action: 'credential.store', entity: 'provider', entityId: provider.id, ip, meta: { fingerprint: row.keyFingerprint, provider: provider.name } });
  const { encryptedKey: _e, iv: _i, tag: _t, ...safe } = row;
  void _e; void _i; void _t;
  return { credential: safe };
}, { strict: true, auditAction: 'credential.store' });

export const GET = api(async ({ user, params }) => {
  const db = await getDb();
  const rows = await db.repo('credentials').findMany({ where: { providerId: params.id, userId: user.id } }) as unknown as (ApiCredential & { encryptedKey?: string; iv?: string; tag?: string })[];
  // strip every secret-bearing field before it leaves the server
  return rows.map(({ encryptedKey, iv, tag, ...rest }) => { void encryptedKey; void iv; void tag; return rest; });
});

export const DELETE = api(async ({ user, params, ip }) => {
  const db = await getDb();
  const n = await db.repo('credentials').deleteWhere({ where: { providerId: params.id, userId: user.id } } as never);
  await audit({ userId: user.id, action: 'credential.delete', entity: 'provider', entityId: params.id, ip, meta: { removed: n } });
  return { removed: n };
}, { strict: true });
