import { storage, verifyFileAccess } from '@/lib/storage';
import { currentUser } from '@/lib/security/auth';
import { rateLimit } from '@/lib/security/rate-limit';
import { getDb } from '@/lib/db';
import { config } from '@/lib/config';
import { ensureBooted } from '@/lib/boot';
import type { Asset } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
  gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  wav: 'audio/wav', mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg',
  json: 'application/json', txt: 'text/plain; charset=utf-8', zip: 'application/zip', csv: 'text/csv'
};

/**
 * Object-storage read path.
 *
 * Authorised by either an unexpired HMAC signature or an authenticated session
 * **that owns the object** — a valid session alone is not enough, otherwise any
 * signed-in user could read another user's media by guessing a key.
 * Supports HTTP range requests so the <video> element can seek.
 */
async function authorised(key: string, signed: boolean): Promise<{ ok: boolean; status?: number }> {
  if (signed) return { ok: true };
  const user = await currentUser();
  if (!user) return { ok: false, status: 401 };
  const rl = rateLimit(`files:${user.id}`, { max: 900, windowMs: 60_000 });
  if (!rl.ok) return { ok: false, status: 429 };

  const db = await getDb();
  const owner = await db.repo('assets').findFirst({ where: { storageKey: key } }) as unknown as Asset | null;
  if (owner) return owner.userId === user.id ? { ok: true } : { ok: false, status: 403 };

  // Not an asset row (thumbnail, temp render, project bundle part). In `open`
  // mode there is exactly one profile so access is safe; otherwise refuse
  // rather than serve an unattributable object.
  if (config.authMode === 'open') return { ok: true };
  return { ok: false, status: 403 };
}

export async function GET(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const { key: parts } = await ctx.params;
  const key = (parts ?? []).map(decodeURIComponent).join('/');
  if (!key || key.includes('..')) return new Response('Bad key', { status: 400 });

  await ensureBooted();
  const sp = new URL(req.url).searchParams;
  const signed = verifyFileAccess(key, sp.get('exp'), sp.get('sig'));
  const auth = await authorised(key, signed);
  if (!auth.ok) return new Response(auth.status === 429 ? 'Too many requests' : auth.status === 401 ? 'Unauthorized' : 'Forbidden', { status: auth.status });

  const st = storage();
  const data = await st.get(key);
  if (!data) return new Response('Not found', { status: 404 });

  const ext = key.split('.').pop()?.toLowerCase() ?? '';
  const type = MIME[ext] ?? 'application/octet-stream';
  const download = sp.get('dl');
  const headers = new Headers({
    'content-type': type,
    'cache-control': signed ? 'private, max-age=86400' : 'private, max-age=3600, must-revalidate',
    'accept-ranges': 'bytes',
    'x-content-type-options': 'nosniff'
  });
  if (download) headers.set('content-disposition', `attachment; filename="${download.replace(/["\\]/g, '')}"`);

  const range = req.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const total = data.byteLength;
    const start = m?.[1] ? Number(m[1]) : 0;
    const end = m?.[2] ? Math.min(total - 1, Number(m[2])) : total - 1;
    if (start >= total || end < start) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${total}` } });
    headers.set('content-range', `bytes ${start}-${end}/${total}`);
    headers.set('content-length', String(end - start + 1));
    return new Response(data.slice(start, end + 1) as unknown as BodyInit, { status: 206, headers });
  }
  headers.set('content-length', String(data.byteLength));
  return new Response(data as unknown as BodyInit, { status: 200, headers });
}

export async function HEAD(req: Request, ctx: { params: Promise<{ key: string[] }> }) {
  const r = await GET(req, ctx);
  return new Response(null, { status: r.status, headers: r.headers });
}
