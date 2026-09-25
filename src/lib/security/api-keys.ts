import { randomBytes, timingSafeEqual } from 'node:crypto';
import { getDb } from '../db';
import { uid, nowIso } from '../ids';
import { sha256 } from './crypto';
import { audit } from './audit';
import type { ApiKey } from '@/types';

/**
 * Inbound API keys for the public REST API (`/api/open/*`).
 *
 * These authenticate *callers of this app*. They are unrelated to
 * `ApiCredential` in `src/lib/ai/credentials.ts`, which holds the OUTBOUND keys
 * this app uses to reach OpenAI, Replicate, ComfyUI and friends. Keeping the two
 * apart matters: one is a secret we issue, the other is a secret we hold.
 *
 * Threat model
 * ------------
 * A key is high-entropy random, so it is hashed with plain SHA-256 rather than
 * bcrypt/argon2 — there is no low-entropy secret for an attacker to brute force
 * offline, and a slow KDF here would put a deliberately expensive operation on
 * an unauthenticated request path (a free DoS amplification). The hash is
 * unique-indexed, so verification is one lookup.
 *
 * The plaintext is returned exactly once, from `createKey`, and is never
 * written to the database, to a log, or to an audit entry. `prefix` is stored so
 * the Settings list can tell keys apart without holding anything secret.
 */

/** Visible handle of a key. Everything here is safe to send to a browser. */
export type ApiKeyView = Omit<ApiKey, 'keyHash'>;

/** A key that was just created — the only moment the plaintext exists. */
export interface CreatedKey extends ApiKeyView { plaintext: string }

/**
 * What a key may do. `openApi()` checks the route's required scope against
 * these via `scopeAllows`. Empty `scopes` on a stored key means "everything",
 * so an unrestricted key keeps working as endpoints are added.
 */
export const KEY_SCOPES = ['projects', 'generate', 'models', 'assets', 'system'] as const;
export type KeyScope = typeof KEY_SCOPES[number];

const PREFIX = 'afs_';
/** Characters a key may contain — no ambiguous glyphs, URL/header safe. */
const ALPHABET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const KEY_BODY_LENGTH = 40;
/** Domain separator, so a hash here can never collide with one from crypto.ts. */
const HASH_PEPPER = 'afs::open-api-key::v1::';

/**
 * Hash a presented or newly minted key.
 *
 * Trimming lives HERE rather than at the call sites on purpose. `createKey`
 * hashed trimmed input while `authenticateKey` hashed it raw, so a key pasted
 * with a trailing space was silently rejected — an unrecoverable-looking bug
 * from the user's side, because the key they were shown genuinely was correct.
 * One normalisation, applied identically on both paths.
 */
export function hashKey(plaintext: string): string {
  return sha256(`${HASH_PEPPER}${plaintext.trim()}`);
}

function randomKey(): string {
  const bytes = randomBytes(KEY_BODY_LENGTH);
  let out = '';
  for (let i = 0; i < KEY_BODY_LENGTH; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${PREFIX}${out}`;
}

/** `afs_xxxx…` — enough to recognise a key in a list, not enough to use it. */
function displayPrefix(plaintext: string): string {
  return `${plaintext.slice(0, PREFIX.length + 6)}…`;
}

/** Strip the hash before anything leaves the server. */
export function toView(row: ApiKey): ApiKeyView {
  const { keyHash: _hash, ...safe } = row;
  void _hash;
  return safe;
}

export interface CreateKeyInput {
  userId: string;
  name: string;
  scopes?: KeyScope[];
  /** Lifetime in days. Omit or pass null for a key that does not expire. */
  expiresInDays?: number | null;
  ip?: string | null;
}

export async function createKey(input: CreateKeyInput): Promise<CreatedKey> {
  const db = await getDb();
  const name = input.name.trim().slice(0, 60);
  if (!name) throw new Error('A key needs a name so you can recognise it later');

  const cleanScopes = [...new Set((input.scopes ?? []).filter(s => (KEY_SCOPES as readonly string[]).includes(s)))] as KeyScope[];

  const days = Number(input.expiresInDays);
  const expiresAt = Number.isFinite(days) && days > 0
    ? new Date(Date.now() + days * 86_400_000).toISOString()
    : null;

  const plaintext = randomKey();
  const row = {
    id: uid('key'),
    userId: input.userId,
    name,
    prefix: displayPrefix(plaintext),
    keyHash: hashKey(plaintext),
    scopes: cleanScopes as string[],
    enabled: true,
    expiresAt,
    lastUsedAt: null,
    lastUsedIp: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  } as unknown as ApiKey;

  await db.repo('apiKeys').create(row as never);
  // The audit entry records that a key was minted, never what it was.
  await audit({
    userId: input.userId, action: 'apikey.create', entity: 'apikey', entityId: row.id,
    ip: input.ip ?? null, meta: { name, scopes: cleanScopes, expiresAt, prefix: row.prefix }
  });
  return { ...toView(row), plaintext };
}

export async function listKeys(userId: string): Promise<ApiKeyView[]> {
  const db = await getDb();
  const rows = await db.repo('apiKeys').findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }) as unknown as ApiKey[];
  return rows.map(toView);
}

/**
 * Revoke a key. Idempotent: DELETE says "make this not exist as a credential",
 * and a key that is already revoked satisfies that, so repeating the call is not
 * an error. `alreadyRevoked` lets a caller tell the two apart without a second
 * round trip. A key id is not a capability, so ownership is part of the lookup.
 */
export async function revokeKey(userId: string, keyId: string): Promise<{ revoked: boolean; alreadyRevoked?: boolean }> {
  const db = await getDb();
  const row = await db.repo('apiKeys').findUnique(keyId) as unknown as ApiKey | null;
  if (!row || row.userId !== userId) return { revoked: false };
  if (!row.enabled) return { revoked: true, alreadyRevoked: true };
  await db.repo('apiKeys').update(keyId, { enabled: false, updatedAt: nowIso() } as never);
  await audit({ userId, action: 'apikey.revoke', entity: 'apikey', entityId: keyId, meta: { prefix: row.prefix } });
  return { revoked: true, alreadyRevoked: false };
}

export interface AuthedKey {
  key: ApiKeyView;
  userId: string;
  scopes: KeyScope[];
}

/**
 * Pull the key out of a request. Accepts `Authorization: Bearer <key>` and
 * `x-api-key: <key>`; the latter exists because some HTTP clients and webhooks
 * will not let you set Authorization.
 */
export function extractKey(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const header = req.headers.get('x-api-key');
  if (header) return header.trim();
  return null;
}

/**
 * Resolve a presented key to its owner, or null.
 *
 * Returns null rather than throwing for every failure mode — wrong key, unknown
 * key, revoked, expired — so the caller cannot be used as an oracle to tell
 * "this key exists but is revoked" apart from "this key was never issued".
 */
export async function authenticateKey(req: Request, ip: string | null): Promise<AuthedKey | null> {
  const raw = extractKey(req);
  if (!raw) return null;
  // Normalise BEFORE the shape check. `Authorization: Bearer  afs_x` is legal —
  // the separator is `\s+` — so the captured value can carry padding that undici
  // did not strip, and an untrimmed length test would reject a valid key.
  const presented = raw.trim();
  if (!presented.startsWith(PREFIX) || presented.length < PREFIX.length + 16) return null;

  const db = await getDb();
  const row = await db.repo('apiKeys').findFirst({ where: { keyHash: hashKey(presented) } }) as unknown as ApiKey | null;
  if (!row) return null;

  // Defence in depth: the lookup is by hash, but re-check the plaintext hash
  // with a constant-time compare so a driver that ever fuzzy-matched cannot
  // short-circuit the comparison.
  const expected = Buffer.from(row.keyHash, 'utf8');
  const actual = Buffer.from(hashKey(presented), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  if (!row.enabled) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;

  // Touch usage metadata. Deliberately not awaited: a bookkeeping write must not
  // add latency to, or be able to fail, an otherwise valid request.
  void db.repo('apiKeys').update(row.id, { lastUsedAt: nowIso(), lastUsedIp: ip } as never).catch(() => {});

  return { key: toView(row), userId: row.userId, scopes: (row.scopes ?? []) as KeyScope[] };
}

/** True when `held` permits `wanted`. An empty scope list means unrestricted. */
export function scopeAllows(held: KeyScope[], wanted: KeyScope): boolean {
  if (!held.length) return true;
  return held.includes(wanted);
}
