import { api, notFound, forbidden } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { ModelPreset } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = api(async ({ user, params, json }) => {
  const db = await getDb();
  const p = await db.repo('presets').findUnique(params.id) as unknown as ModelPreset | null;
  if (!p) throw notFound('Preset not found');
  if (p.builtIn && p.userId !== user.id) {
    // Editing a built-in clones it into the user's space rather than mutating shared data.
    const body = await json<Partial<ModelPreset>>();
    const clone = await db.repo('presets').create({ ...p, ...body, id: crypto.randomUUID().replace(/-/g, '').slice(0, 20), builtIn: false, userId: user.id, name: `${body.name ?? p.name} (custom)`, createdAt: new Date().toISOString() } as never);
    return clone;
  }
  const body = await json<Partial<ModelPreset>>();
  const patch: Record<string, unknown> = {};
  for (const k of ['name','description','textModel','imageModel','videoModel','voiceModel','musicModel','soundModel','upscaleModel','editingModel','strategy','defaults','fallbacks'] as const) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  return await db.repo('presets').update(params.id, patch as never);
}, { auditAction: 'preset.update' });

export const DELETE = api(async ({ user, params }) => {
  const db = await getDb();
  const p = await db.repo('presets').findUnique(params.id) as unknown as ModelPreset | null;
  if (!p) throw notFound('Preset not found');
  if (p.builtIn) throw forbidden('Built-in presets cannot be deleted.');
  await db.repo('presets').delete(params.id);
  return { deleted: true };
}, { strict: true });
