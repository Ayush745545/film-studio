import { api, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { providerStatusMap, normalizeProviderBaseUrl } from '@/lib/ai/credentials';
import { seedRegistry } from '@/lib/ai/seed';
import { PROVIDERS } from '@/lib/ai/registry';
import { registeredDrivers } from '@/lib/ai/adapters';
import { uid, nowIso } from '@/lib/ids';
import type { Capability, Provider, ProviderDriver } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Providers are returned WITHOUT any key material — only status flags. */
export const GET = api(async ({ user }) => {
  await seedRegistry();
  const db = await getDb();
  const providers = await db.repo('providers').findMany({ orderBy: { priority: 'asc' } }) as unknown as Provider[];
  const statuses = await providerStatusMap(user.id);
  return {
    providers: providers.map(p => ({ ...p, credentialStatus: statuses[p.id] ?? 'missing' })),
    drivers: registeredDrivers(),
    capabilities: ['text','image','video','voice','music','sound','upscale','lipsync','3d','vision','editing'] as Capability[]
  };
});

export const POST = api(async ({ user, json }) => {
  const body = await json<{ name: string; driver: ProviderDriver; baseUrl?: string; capabilities?: Capability[]; notes?: string; envKeyVar?: string }>();
  if (!body.name?.trim()) throw badRequest('Provider name is required');
  if (!registeredDrivers().includes(body.driver)) throw badRequest(`Unknown driver "${body.driver}"`, `Available drivers: ${registeredDrivers().join(', ')}`);
  let baseUrl: string | null;
  try { baseUrl = normalizeProviderBaseUrl(body.baseUrl); }
  catch (error) { throw badRequest((error as Error).message, 'Paste the provider API endpoint URL, not an API key.'); }
  const db = await getDb();
  const id = uid('prov');
  const created = await db.repo('providers').create({
    id, name: body.name.trim().slice(0, 80), driver: body.driver, baseUrl,
    enabled: true, builtIn: false, capabilities: body.capabilities ?? ['text'],
    docsUrl: null, envKeyVar: body.envKeyVar ?? null, notes: body.notes ?? '', priority: 500, createdAt: nowIso()
  } as never);
  return { provider: created, templates: PROVIDERS.map(p => ({ id: p.id, name: p.name, driver: p.driver })) };
}, { auditAction: 'provider.create' });
