import { NextResponse } from 'next/server';
import { ensureBooted } from './boot';
import { HttpError, shape } from './api';
import { authenticateKey, scopeAllows, type KeyScope } from './security/api-keys';
import { rateLimit } from './security/rate-limit';
import { audit } from './security/audit';
import { getUserById } from './security/auth';
import type { User } from '@/types';

/**
 * Wrapper for the public REST API under `/api/open/*`.
 *
 * Authentication is a presented API key instead of a session cookie; everything
 * else — response envelope, error translation, status codes — is shared with
 * `api()` in `src/lib/api.ts` so a client can use one parser for both surfaces.
 *
 * This is a separate wrapper rather than a flag on `api()` on purpose. Sharing
 * one code path would mean every internal route silently became reachable with
 * a key, including the ones that mutate credentials and billing. Here the set of
 * key-accessible routes is exactly the set of files under `src/app/api/open/`,
 * which is easy to audit and impossible to extend by accident.
 *
 * There is deliberately no CSRF check: CSRF defends ambient cookie auth, and a
 * bearer key is not ambient. There is also no cookie fallback — an open route
 * must not work merely because a browser happens to be signed in, or the surface
 * would be unauditable.
 */

export interface OpenCtx<P = Record<string, string>> { params: Promise<P> }

export interface OpenHandlerArg<P = Record<string, string>> {
  req: Request;
  user: User;
  params: P;
  ip: string;
  /** Scopes the presented key carries (empty = unrestricted). */
  scopes: KeyScope[];
  keyId: string;
  keyName: string;
  json<T = any>(): Promise<T>;
  query(): URLSearchParams;
}

type OpenHandler<P, R> = (arg: OpenHandlerArg<P>) => Promise<R> | R;

/** Per-key limit, separate from the per-user session limit in `api()`. */
const OPEN_RATE_MAX = 240;
const OPEN_RATE_WINDOW_MS = 60_000;

function clientIp(req: Request): string {
  return (req.headers.get('x-forwarded-for')?.split(',')[0] ?? req.headers.get('x-real-ip') ?? 'local').trim();
}

export function openApi<P extends Record<string, string> = Record<string, string>, R = unknown>(
  handler: OpenHandler<P, R>,
  opts: { method?: string; scope?: KeyScope; auditAction?: string } = {}
) {
  return async function route(req: Request, ctx: OpenCtx<P>): Promise<NextResponse> {
    const started = Date.now();
    // `developerMode: false` is hard-coded below: an open-API caller is
    // untrusted by definition, so it never gets stack traces or raw provider
    // error bodies, whatever the owning user has enabled for themselves.
    const developerMode = false;
    try {
      await ensureBooted();

      if (opts.method && req.method !== opts.method) {
        throw new HttpError(405, `${req.method} not allowed on this endpoint`, { code: 'method_not_allowed' });
      }

      const ip = clientIp(req);
      const authed = await authenticateKey(req, ip);
      if (!authed) {
        // One message for every failure mode — unknown, malformed, revoked and
        // expired keys are indistinguishable from outside.
        throw new HttpError(401, 'A valid API key is required', {
          code: 'invalid_api_key',
          hint: 'Send it as "Authorization: Bearer afs_…" or "x-api-key: afs_…". Create one in Settings → Developer API. Revoked and expired keys are rejected here too.'
        });
      }

      const user = await getUserById(authed.userId);
      if (!user) {
        throw new HttpError(401, 'A valid API key is required', { code: 'invalid_api_key' });
      }

      // Rate limit on the key, not the user, so one runaway script cannot eat
      // the budget of everything else that user does.
      const rl = rateLimit(`open:${authed.key.id}`, { max: OPEN_RATE_MAX, windowMs: OPEN_RATE_WINDOW_MS });
      if (!rl.ok) {
        return NextResponse.json(
          { ok: false, error: { message: 'Too many requests — slow down for a moment.', code: 'rate_limited', hint: `Retry in ${Math.ceil(rl.retryAfterMs / 1000)}s` } },
          { status: 429, headers: { 'retry-after': String(Math.ceil(rl.retryAfterMs / 1000)) } }
        );
      }

      if (opts.scope && !scopeAllows(authed.scopes, opts.scope)) {
        throw new HttpError(403, `This key does not have the "${opts.scope}" scope`, {
          code: 'insufficient_scope',
          hint: authed.scopes.length
            ? `It is limited to: ${authed.scopes.join(', ')}. Issue a new key with the scope you need.`
            : 'Issue a new key with the scope you need.'
        });
      }

      const params = await (ctx?.params ?? Promise.resolve({} as P));
      const result = await handler({
        req, user, params, ip,
        scopes: authed.scopes, keyId: authed.key.id, keyName: authed.key.name,
        query: () => new URL(req.url).searchParams,
        async json<T = any>(): Promise<T> {
          try { return await req.json() as T; }
          catch { throw new HttpError(400, 'Request body must be valid JSON', { code: 'bad_request' }); }
        }
      });

      if (opts.auditAction) {
        void audit({
          userId: user.id, action: opts.auditAction, entity: 'open-api',
          entityId: (params as any)?.id ?? null, ip,
          meta: { method: req.method, path: new URL(req.url).pathname, keyId: authed.key.id, ms: Date.now() - started }
        });
      }

      return NextResponse.json({ ok: true, data: result ?? null }, {
        status: req.method === 'POST' && !result ? 201 : 200,
        headers: { 'cache-control': 'no-store' }
      });
    } catch (err) {
      return shape(err, developerMode, req);
    }
  };
}
