import { NextResponse } from 'next/server';
import { signUp } from '@/lib/security/auth';
import { config } from '@/lib/config';
import { strictLimit } from '@/lib/security/rate-limit';
import { ensureBooted } from '@/lib/boot';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  await ensureBooted();
  if (config.authMode === 'open') return NextResponse.json({ ok: false, error: { message: 'Sign-up is disabled while the instance runs in open mode.', code: 'disabled' } }, { status: 403 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'local';
  if (!strictLimit(`signup:${ip}`, 5, 3600_000).ok) return NextResponse.json({ ok: false, error: { message: 'Too many sign-up attempts from this address.', code: 'rate_limited' } }, { status: 429 });
  let email = '', password = '', name = '';
  try { const b = await req.json(); email = String(b.email ?? ''); password = String(b.password ?? ''); name = String(b.name ?? ''); } catch { /* noop */ }
  try {
    const user = await signUp(email, password, name);
    return NextResponse.json({ ok: true, data: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    return NextResponse.json({ ok: false, error: { message: (err as Error).message, code: 'signup_failed' } }, { status: 400 });
  }
}
