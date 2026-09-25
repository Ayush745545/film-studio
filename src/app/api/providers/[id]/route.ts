import { api, notFound, forbidden, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { registeredDrivers } from '@/lib/ai/adapters';
import { normalizeProviderBaseUrl } from '@/lib/ai/credentials';
import type { Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function owned(id: string) {
  const db = await getDb();
  const p = await db.repo('providers').findUnique(id) as unknown as Provider | null;
  if (!p) throw notFound('Provider not found');
  return p;
}

export const GET = api(async ({ params }) => owned(params.id));

export const PATCH = api(async ({ params, json }) => {
  const p = await owned(params.id);
  const body = await json<Partial<Provider>>();
  const db = await getDb();
  const patch: Record<string, unknown> = {};
  if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim().slice(0, 80);
  if (typeof body.baseUrl === 'string') {
    try { patch.baseUrl = normalizeProviderBaseUrl(body.baseUrl); }
    catch (error) { throw badRequest((error as Error).message, 'Paste the provider API endpoint URL, not an API key.'); }
  }
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
  if (Array.isArray(body.capabilities)) patch.capabilities = body.capabilities;
  if (typeof body.notes === 'string') patch.notes = body.notes.slice(0, 2000);
  if (typeof body.priority === 'number') patch.priority = Math.max(0, Math.min(9999, body.priority));
  if (body.driver && registeredDrivers().includes(String(body.driver))) patch.driver = body.driver;
  return await db.repo('providers').update(p.id, patch as never);
}, { auditAction: 'provider.update' });

export const DELETE = api(async ({ params }) => {
  const p = await owned(params.id);
  if (p.builtIn) throw forbidden('Built-in providers cannot be deleted — disable them instead.');
  const db = await getDb();
  await db.repo('providers').delete(p.id);
  return { deleted: true };
}, { strict: true });
