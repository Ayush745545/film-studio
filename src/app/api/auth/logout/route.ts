import { destroySessionCookie } from '@/lib/security/auth';
import { NextResponse } from 'next/server';
import { ensureBooted } from '@/lib/boot';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST() {
  await ensureBooted(); await destroySessionCookie(); return NextResponse.json({ ok: true, data: { signedOut: true } }); }
