import { NextResponse } from 'next/server';
import { signIn } from '@/lib/security/auth';
import { config } from '@/lib/config';
import { audit } from '@/lib/security/audit';
import { strictLimit } from '@/lib/security/rate-limit';
import { ensureBooted } from '@/lib/boot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await ensureBooted();
  if (config.authMode === 'open') {
    return NextResponse.json({ ok: true, data: { mode: 'open', message: 'This instance runs in open mode — a local profile is used automatically.' } });
  }
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  const rl = strictLimit(`login:${ip}`, 8, 60_000);
  if (!rl.ok) return NextResponse.json({ ok: false, error: { message: 'Too many sign-in attempts. Try again in a minute.', code: 'rate_limited' } }, { status: 429 });
  let email = ''; let password = '';
  try { const b = await req.json(); email = String(b.email ?? ''); password = String(b.password ?? ''); } catch { /* handled below */ }
  if (!email || !password) return NextResponse.json({ ok: false, error: { message: 'Email and password are required', code: 'bad_request' } }, { status: 400 });
  const user = await signIn(email, password);
  if (!user) {
    await audit({ action: 'auth.login.failed', entity: 'user', ip, meta: { email } });
    return NextResponse.json({ ok: false, error: { message: 'Invalid email or password', code: 'invalid_credentials' } }, { status: 401 });
  }
  await audit({ userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip });
  return NextResponse.json({ ok: true, data: { id: user.id, email: user.email, name: user.name } });
}
