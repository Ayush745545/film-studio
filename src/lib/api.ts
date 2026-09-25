import { NextResponse } from 'next/server';
import { currentUser, requireUser, isSafeOrigin } from './security/auth';
import { ensureBooted } from './boot';
import { rateLimit, strictLimit } from './security/rate-limit';
import { audit } from './security/audit';
import { ProviderError } from './ai/types';
import { NoModelError } from './ai/router';
import { InsufficientCredits } from './credits';
import type { User } from '@/types';

export interface Ctx<P = Record<string, string>> { params: Promise<P> }

export class HttpError extends Error {
  status: number; code: string; hint?: string; details?: unknown;
  constructor(status: number, message: string, opts: { code?: string; hint?: string; details?: unknown } = {}) {
    super(message);
    this.status = status; this.code = opts.code ?? `http_${status}`;
    this.hint = opts.hint; this.details = opts.details;
  }
}
export const badRequest = (m: string, hint?: string) => new HttpError(400, m, { code: 'bad_request', hint });
export const notFound = (m = 'Not found') => new HttpError(404, m, { code: 'not_found' });
export const forbidden = (m = 'Not permitted') => new HttpError(403, m, { code: 'forbidden' });
export const conflict = (m: string, hint?: string) => new HttpError(409, m, { code: 'conflict', hint });

export interface HandlerArg<P = Record<string, string>> {
  req: Request; user: User; params: P; ip: string;
  json<T = any>(): Promise<T>;
  query(): URLSearchParams;
}

type Handler<P, R> = (arg: HandlerArg<P>) => Promise<R> | R;

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim();
}

/**
 * One wrapper for every route: auth → CSRF → rate limit → handler → envelope.
 * Errors are translated into user-actionable messages; stack traces never
 * reach the browser unless the caller has developer mode on.
 */
export function api<P extends Record<string, string> = Record<string, string>, R = unknown>(
  handler: Handler<P, R>,
  opts: { auth?: boolean; strict?: boolean; method?: string; auditAction?: string } = {}
) {
  return async function route(req: Request, ctx: Ctx<P>): Promise<NextResponse> {
    const started = Date.now();
    let user: User | null = null;
    try {
      await ensureBooted();
      if (opts.method && req.method !== opts.method) {
        return NextResponse.json({ ok: false, error: { message: `${req.method} not allowed`, code: 'method_not_allowed' } }, { status: 405 });
      }
      if (!isSafeOrigin(req)) throw new HttpError(403, 'Cross-origin request blocked', { code: 'csrf' });

      user = opts.auth === false ? await currentUser() : await requireUser();
      if (!user) throw new HttpError(401, 'Sign in to continue', { code: 'unauthenticated' });

      const ip = clientIp(req);
      const rl = opts.strict ? strictLimit(user.id, 40) : rateLimit(`${user.id}:${ip}`);
      if (!rl.ok) {
        return NextResponse.json(
          { ok: false, error: { message: 'Too many requests — slow down for a moment.', code: 'rate_limited', hint: `Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s` } },
          { status: 429, headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) } }
        );
      }

      const params = await (ctx?.params ?? Promise.resolve({} as P));
      const result = await handler({
        req, user, params, ip,
        query: () => new URL(req.url).searchParams,
        async json<T = any>(): Promise<T> {
          try { return await req.json() as T; }
          catch { throw badRequest('Request body must be valid JSON'); }
        }
      });

      if (opts.auditAction) {
        void audit({ userId: user.id, action: opts.auditAction, entity: 'api', entityId: (params as any)?.id ?? null, ip, meta: { method: req.method, ms: Date.now() - started } });
      }
      return NextResponse.json({ ok: true, data: result ?? null }, {
        status: req.method === 'POST' && !result ? 201 : 200,
        headers: { 'cache-control': 'no-store' }
      });
    } catch (err) {
      return shape(err, user?.developerMode ?? false, req);
    }
  };
}

export function shape(err: unknown, developerMode: boolean, req?: Request): NextResponse {
  const e = err as any;
  if (e instanceof HttpError) {
    return NextResponse.json({ ok: false, error: { message: e.message, code: e.code, hint: e.hint, details: e.details } }, { status: e.status });
  }
  if (e?.name === 'AuthError') {
    return NextResponse.json({ ok: false, error: { message: 'Sign in to continue', code: 'unauthenticated' } }, { status: 401 });
  }
  if (e instanceof InsufficientCredits) {
    return NextResponse.json({ ok: false, error: { message: e.message, code: e.code, hint: 'Top up in Settings → Billing, choose a cheaper model, or use the Demo engine.', details: { required: e.required, balance: e.balance } } }, { status: 402 });
  }
  if (e instanceof NoModelError) {
    return NextResponse.json({ ok: false, error: { message: e.message, code: e.code, hint: e.hint } }, { status: 424 });
  }
  if (e instanceof ProviderError) {
    return NextResponse.json({ ok: false, error: { message: e.message, code: e.code, hint: e.suggestion, details: developerMode ? { providerMessage: e.providerMessage } : undefined } }, { status: e.code === 'unauthorized' ? 401 : 502 });
  }
  const message = e?.message ?? 'Unexpected server error';
  const status = e?.status && Number.isInteger(e.status) ? e.status : 500;
  console.error(`[api] ${req?.method ?? '?'} ${req ? new URL(req.url).pathname : ''} →`, message, developerMode ? e : '');
  return NextResponse.json({
    ok: false,
    error: {
      message: developerMode ? message : 'Something went wrong on the server.',
      code: e?.code ?? 'internal_error',
      hint: developerMode ? undefined : 'Enable Developer Mode in Settings → Advanced for details, then check the server log.',
      details: developerMode && e?.stack ? { stack: String(e.stack).split('\n').slice(0, 6) } : undefined
    }
  }, { status });
}

/** Convenience for reading a JSON body with validation. */
export async function readJson<T>(req: Request): Promise<T> {
  try { return await req.json() as T; } catch { throw badRequest('Request body must be valid JSON'); }
}

export function ok<T>(data: T) { return NextResponse.json({ ok: true, data }); }
