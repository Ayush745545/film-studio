import { api, badRequest, conflict } from '@/lib/api';
import { getDb } from '@/lib/db';
import { seedRegistry } from '@/lib/ai/seed';
import { uid, nowIso } from '@/lib/ids';
import type { AspectRatio, Capability, GenKind, ModelDescriptor, Resolution } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  await seedRegistry();
  const db = await getDb();
  const kind = query().get('kind') as GenKind | null;
  const cap = query().get('capability') as Capability | null;
  let models = await db.repo('models').findMany({}) as unknown as ModelDescriptor[];
  if (kind) models = models.filter(m => m.kind === kind || m.capabilities.includes(kindToCap(kind)));
  if (cap) models = models.filter(m => m.capabilities.includes(cap));
  const providers = await db.repo('providers').findMany({}) as unknown as { id: string; name: string; driver: string; enabled: boolean }[];
  const creds = await db.repo('credentials').findMany({ where: { userId: user.id } }) as unknown as { providerId: string; status: string }[];
  const ready = new Set(creds.filter(c => c.status !== 'invalid').map(c => c.providerId));
  return {
    models: models.sort((a, b) => a.kind.localeCompare(b.kind) || b.quality - a.quality),
    providers,
    readyProviders: [...ready]
  };
});

/** "Add custom model" — data-driven, no deploy required. */
export const POST = api(async ({ user, json }) => {
  const body = await json<Partial<ModelDescriptor> & { providerId: string; name: string; driverModel: string; upsert?: boolean }>();
  if (!body.providerId || !body.name?.trim() || !body.driverModel?.trim()) throw badRequest('providerId, name and driverModel are required');
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(body.providerId);
  if (!provider) throw badRequest('Unknown provider');

  // Enforce @@unique([providerId, driverModel]) in the application layer. The
  // embedded file driver has no unique-constraint support, so without this a
  // repeated "Load to app" silently registers the same workflow twice — and in
  // the zero-config mode the README leads with, that is the default path.
  const driverModel = body.driverModel.trim();
  const existing = await db.repo('models').findFirst({ where: { providerId: body.providerId, driverModel } });
  if (existing) {
    if (!body.upsert) {
      throw conflict(
        `"${(existing as unknown as { name?: string }).name ?? driverModel}" is already registered for this provider`,
        'Each model needs a unique driver model id per provider. Rename it, or use the model that is already there.'
      );
    }
    return await db.repo('models').update(existing.id, {
      name: body.name.trim().slice(0, 90), capabilities: body.capabilities ?? ['text'],
      kind: body.kind ?? 'text', quality: body.quality ?? 3, speed: body.speed ?? 3,
      costPerUnit: body.costPerUnit ?? 0, unit: body.unit ?? 'request', config: body.config ?? {},
      features: body.features ?? ['custom'], enabled: body.enabled !== false
    } as never);
  }

  const model = await db.repo('models').create({
    id: uid('mdl'), providerId: body.providerId, name: body.name.trim().slice(0, 90),
    driverModel, capabilities: body.capabilities ?? ['text'],
    kind: body.kind ?? 'text', quality: body.quality ?? 3, speed: body.speed ?? 3,
    costPerUnit: body.costPerUnit ?? 0, unit: body.unit ?? 'request',
    contextWindow: body.contextWindow ?? null, maxDurationSec: body.maxDurationSec ?? null,
    supportedRatios: body.supportedRatios ?? (['16:9','9:16','1:1'] as AspectRatio[]),
    supportedResolutions: body.supportedResolutions ?? (['720p','1080p'] as Resolution[]),
    features: body.features ?? ['custom'], enabled: body.enabled !== false, isDefault: false,
    demo: false, custom: true, config: body.config ?? {}, createdAt: nowIso()
  } as never);
  return model;
}, { auditAction: 'model.create' });

function kindToCap(kind: GenKind): Capability {
  return ({ text: 'text', image: 'image', video: 'video', voice: 'voice', music: 'music', sfx: 'sound', upscale: 'upscale', lipsync: 'lipsync' } as Record<string, Capability>)[kind] ?? 'text';
}
