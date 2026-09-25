import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config, isProd } from '../config';

/**
 * AES-256-GCM envelope encryption for user-owned provider API keys.
 * Keys are encrypted before they touch storage and decrypted only inside the
 * provider adapter, in-process, for the duration of a single request.
 * Raw keys are never logged and never returned by any API route.
 */
const ALGO = 'aes-256-gcm';

function deriveKey(secret: string): Buffer {
  // scrypt with a fixed app-level salt: the secret itself is the entropy source.
  return scryptSync(secret, 'ai-film-studio::credential-envelope::v1', 32);
}

export interface EncryptedBlob { ciphertext: string; iv: string; tag: string }

export function encryptSecret(plaintext: string): EncryptedBlob {
  const key = deriveKey(config.encryptionKey);
  const iv = randomBytes(12);
  const c = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([c.update(plaintext, 'utf8'), c.final()]);
  const tag = c.getAuthTag();
  return { ciphertext: enc.toString('base64'), iv: iv.toString('base64'), tag: tag.toString('base64') };
}

export function decryptSecret(blob: EncryptedBlob): string {
  const key = deriveKey(config.encryptionKey);
  const d = createDecipheriv(ALGO, key, Buffer.from(blob.iv, 'base64'));
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ciphertext, 'base64')), d.final()]).toString('utf8');
}

/** `sk-proj-abc…wxyz` — safe to render in the UI. */
export function maskKey(k: string): string {
  const clean = k.trim();
  if (clean.length <= 10) return '•'.repeat(Math.max(4, clean.length));
  return `${clean.slice(0, 6)}${'•'.repeat(10)}${clean.slice(-4)}`;
}

export function keyFingerprint(k: string): string {
  return createHash('sha256').update(`afs::kfp::${k.trim()}`).digest('hex').slice(0, 16);
}

export function sha256(s: string): string { return createHash('sha256').update(s).digest('hex'); }

/** Short stable identifier for a credential, safe to store and display. */
export function fingerprint(s: string): string {
  return createHash('sha256').update(`afs::kfp::${s.trim()}`).digest('hex').slice(0, 16);
}

/** HMAC used to sign storage URLs so object keys are not directly enumerable. */
export function sign(value: string, ttlSec: number): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = createHash('sha256').update(`${config.sessionSecret}|${value}|${exp}`).digest('base64url');
  return { exp, sig };
}
export function verifySignature(value: string, exp: number, sig: string): boolean {
  if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
  const expect = createHash('sha256').update(`${config.sessionSecret}|${value}|${exp}`).digest('base64url');
  const a = Buffer.from(expect); const b = Buffer.from(sig ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}

export function assertSecureCryptoConfig() {
  if (isProd && config.encryptionKey.includes('dev-only')) {
    throw new Error('AFS_ENCRYPTION_KEY must be changed from the development default before running in production.');
  }
}

/** Generate a strong key for .env: `node -e "require('./src/lib/security/crypto').printKey()"` */
export function generateEnvKey(): string { return randomBytes(32).toString('hex'); }
