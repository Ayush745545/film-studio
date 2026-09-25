import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { resolveCredential } from '@/lib/ai/credentials';
import { adapterFor } from '@/lib/ai/adapters';
import { nowIso } from '@/lib/ids';
import type { Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = api(async ({ user, params }) => {
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(params.id) as unknown as Provider | null;
  if (!provider) throw notFound('Provider not found');
  const adapter = adapterFor(provider.driver);
  const cred = await resolveCredential(provider, user.id);
  const started = Date.now();
  let result: { ok: boolean; message: string; detail?: string };
  try {
    result = adapter.testConnection
      ? await adapter.testConnection({ apiKey: cred.apiKey, baseUrl: cred.baseUrl, extra: cred.extra, jobId: 'test', signal: AbortSignal.timeout(30_000), fetchRef: async () => null, log: () => {} })
      : { ok: Boolean(cred.apiKey) || cred.source === 'none', message: cred.apiKey ? 'Key present (this driver has no probe endpoint)' : 'No key required for this provider', detail: cred.baseUrl ?? '' };
  } catch (err) {
    result = { ok: false, message: (err as Error).message, detail: 'Connection failed' };
  }
  const ms = Date.now() - started;
  const rows = await db.repo('credentials').findMany({ where: { providerId: provider.id, userId: user.id } });
  for (const r of rows) {
    await db.repo('credentials').update(r.id, {
      status: result.ok ? 'connected' : 'failed', lastTestedAt: nowIso(),
      lastError: result.ok ? null : (result.detail ?? result.message).slice(0, 400)
    } as never);
  }
  // Never echo key material or raw provider error bodies beyond a short hint.
  return { ok: result.ok, message: result.message, detail: result.detail?.slice(0, 300), latencyMs: ms, source: cred.source };
}, { strict: true });
