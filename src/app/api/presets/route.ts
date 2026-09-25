import { api, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { seedRegistry } from '@/lib/ai/seed';
import { uid, nowIso } from '@/lib/ids';
import type { ModelPreset } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async () => {
  await seedRegistry();
  const db = await getDb();
  const presets = await db.repo('presets').findMany({}) as unknown as ModelPreset[];
  return { presets: presets.sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name)) };
});

export const POST = api(async ({ user, json }) => {
  const body = await json<Partial<ModelPreset> & { name: string }>();
  if (!body.name?.trim()) throw badRequest('Preset name is required');
  const db = await getDb();
  const preset = await db.repo('presets').create({
    id: uid('preset'), userId: user.id, name: body.name.trim().slice(0, 60),
    description: body.description ?? '', builtIn: false,
    textModel: body.textModel ?? null, imageModel: body.imageModel ?? null, videoModel: body.videoModel ?? null,
    voiceModel: body.voiceModel ?? null, musicModel: body.musicModel ?? null, soundModel: body.soundModel ?? null,
    upscaleModel: body.upscaleModel ?? null, editingModel: body.editingModel ?? null,
    strategy: body.strategy ?? 'quality',
    defaults: body.defaults ?? { resolution: '1080p', aspectRatio: '16:9', fps: 24 },
    fallbacks: body.fallbacks ?? {}, createdAt: nowIso()
  } as never);
  return preset;
}, { auditAction: 'preset.create' });
