import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { getDb } from '../db';
import { uid, nowIso } from '../ids';
import type { User } from '@/types';

export const COOKIE = 'afs_session';
const ISSUER = 'ai-film-studio';

function secretKey() { return new TextEncoder().encode(config.sessionSecret.padEnd(32, '0').slice(0, 64)); }

export async function signToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId }).setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt().setIssuer(ISSUER).setExpirationTime('30d').sign(secretKey());
}
export async function verifyToken(token: string): Promise<string | null> {
  try { const { payload } = await jwtVerify(token, secretKey(), { issuer: ISSUER }); return (payload.sub as string) ?? null; }
  catch { return null; }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const checkPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

const PALETTE = ['#D99A32', '#63A9E9', '#4CCB8A', '#C58BE9', '#E9836A', '#5BC8C8'];

/** In `open` mode a single local profile is provisioned so the app is usable instantly. */
export async function ensureLocalUser(): Promise<User> {
  const db = await getDb();
  const users = db.repo('users');
  const existing = await users.findFirst({ orderBy: { createdAt: 'asc' } });
  if (existing) return existing as User;
  return await users.create({
    id: uid('usr'), email: 'director@local.studio', name: 'Director',
    passwordHash: null, avatarColor: PALETTE[0], role: 'owner',
    developerMode: false, theme: 'dark', onboardingDone: false, createdAt: nowIso(), updatedAt: nowIso()
  }) as unknown as User;
}

export async function getUserById(id: string): Promise<User | null> {
  const db = await getDb();
  return (await db.repo('users').findUnique(id)) as User | null;
}

/**
 * Resolve the caller. Returns null only in `credentials` mode with no valid
 * session; `open` mode always resolves to the local profile.
 */
export async function currentUser(): Promise<User | null> {
  if (config.authMode === 'open') return ensureLocalUser();
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const userId = await verifyToken(token);
  if (!userId) return null;
  return getUserById(userId);
}

export async function requireUser(): Promise<User> {
  const u = await currentUser();
  if (!u) throw new AuthError('Not authenticated');
  return u;
}

export class AuthError extends Error { constructor(m: string) { super(m); this.name = 'AuthError'; } }

export async function createSessionCookie(userId: string) {
  const token = await signToken(userId);
  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true, sameSite: 'lax', secure: config.nodeEnv === 'production',
    path: '/', maxAge: 60 * 60 * 24 * 30
  });
  return token;
}
export async function destroySessionCookie() {
  const store = await cookies();
  store.set(COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Lightweight CSRF defence for cookie-authenticated state-changing requests. */
export function isSafeOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;                                  // same-origin / non-browser
  try { return new URL(origin).host === new URL(req.url).host; } catch { return false; }
}

export async function signIn(email: string, password: string): Promise<User | null> {
  const db = await getDb();
  const u = await db.repo('users').findFirst({ where: { email: email.toLowerCase().trim() } });
  if (!u) return null;
  const hash = (u as unknown as { passwordHash?: string | null }).passwordHash;
  if (!hash || !(await checkPassword(password, hash))) return null;
  await createSessionCookie(u.id);
  return u as unknown as User;
}

export async function signUp(email: string, password: string, name: string): Promise<User> {
  const db = await getDb();
  const users = db.repo('users');
  const clean = email.toLowerCase().trim();
  const existing = await users.findFirst({ where: { email: clean } });
  if (existing) throw new Error('An account with that email already exists');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const u = await users.create({
    id: uid('usr'), email: clean, name: name || clean.split('@')[0],
    passwordHash: await hashPassword(password),
    avatarColor: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    role: 'owner', developerMode: false, theme: 'dark', onboardingDone: false,
    createdAt: nowIso(), updatedAt: nowIso()
  }) as unknown as User;
  await createSessionCookie(u.id);
  return u;
}
