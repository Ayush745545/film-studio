import { getDb } from './db';
import { storage, makeKey } from './storage';
import { uid, nowIso } from './ids';
import { bus } from './events';
import type { Asset, AssetKind } from '@/types';

export interface SaveAssetInput {
  userId: string;
  projectId?: string | null;
  kind: AssetKind;
  name: string;
  data?: Uint8Array | string;
  mime: string;
  storageKey?: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: number;
  modelId?: string | null;
  providerId?: string | null;
  generationId?: string | null;
  demo?: boolean;
  width?: number; height?: number; durationSec?: number;
  meta?: Record<string, unknown>;
  tags?: string[];
  refIds?: Asset['refIds'];
}

/** Persist bytes to object storage + metadata row. The DB never holds the media. */
export async function saveAsset(input: SaveAssetInput): Promise<Asset> {
  const db = await getDb();
  const st = storage();
  let key = input.storageKey ?? '';
  let bytes = 0;
  if (input.data != null && !key) {
    key = makeKey(scopeFor(input.kind), input.mime, input.name);
    const res = await st.put(key, input.data, input.mime);
    key = res.key; bytes = res.bytes;
  } else if (key) {
    bytes = input.data != null ? Buffer.byteLength(input.data as never) : 0;
  }
  const url = key ? st.url(key) : '';
  const asset = await db.repo('assets').create({
    id: uid('ast'), projectId: input.projectId ?? null, userId: input.userId,
    name: input.name, kind: input.kind, mimeType: input.mime,
    storageKey: key, url, thumbnailUrl: input.kind === 'image' || input.kind === 'storyboard' ? url : null,
    bytes, width: input.width ?? null, height: input.height ?? null, durationSec: input.durationSec ?? null,
    modelId: input.modelId ?? null, providerId: input.providerId ?? null, generationId: input.generationId ?? null,
    prompt: input.prompt ?? '', negativePrompt: input.negativePrompt ?? '', seed: input.seed ?? 0,
    version: 1, tags: input.tags ?? [], meta: input.meta ?? {}, demo: Boolean(input.demo),
    status: 'ready', refIds: input.refIds ?? {}, createdAt: nowIso(), updatedAt: nowIso()
  } as never) as unknown as Asset;

  bus.publish({ type: 'asset:created', asset });
  return asset;
}

function scopeFor(kind: AssetKind): string {
  switch (kind) {
    case 'image': case 'storyboard': case 'character': case 'location': return 'images';
    case 'video': return 'videos';
    case 'audio': case 'voice': case 'music': case 'sfx': return 'audio';
    case 'export': return 'exports';
    case 'lut': return 'luts';
    case 'document': return 'documents';
    default: return 'misc';
  }
}

export async function getAsset(id: string): Promise<Asset | null> {
  const db = await getDb();
  return await db.repo('assets').findUnique(id) as unknown as Asset | null;
}

export async function listAssets(userId: string, filter: { projectId?: string | null; kinds?: AssetKind[]; q?: string; take?: number } = {}) {
  const db = await getDb();
  const rows = await db.repo('assets').findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: filter.take ?? 500 }) as unknown as Asset[];
  let out = rows;
  if (filter.projectId !== undefined) out = out.filter(a => filter.projectId === null ? !a.projectId : a.projectId === filter.projectId);
  if (filter.kinds?.length) out = out.filter(a => filter.kinds!.includes(a.kind));
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter(a =>
      a.name.toLowerCase().includes(q) || a.prompt.toLowerCase().includes(q) ||
      a.tags.some(t => t.toLowerCase().includes(q)) || a.kind.includes(q));
  }
  return out;
}

export async function deleteAsset(id: string, userId: string) {
  const db = await getDb();
  const a = await db.repo('assets').findUnique(id) as unknown as Asset | null;
  if (!a || a.userId !== userId) return false;
  if (a.storageKey) await storage().delete(a.storageKey);
  await db.repo('assets').delete(id);
  return true;
}

export async function renameAsset(id: string, userId: string, name: string) {
  const db = await getDb();
  const a = await db.repo('assets').findUnique(id) as unknown as Asset | null;
  if (!a || a.userId !== userId) return null;
  return await db.repo('assets').update(id, { name, updatedAt: nowIso() } as never) as unknown as Asset;
}

export async function duplicateAsset(id: string, userId: string) {
  const db = await getDb();
  const a = await db.repo('assets').findUnique(id) as unknown as Asset | null;
  if (!a || a.userId !== userId) return null;
  const st = storage();
  const data = a.storageKey ? await st.get(a.storageKey) : null;
  if (!data) return null;
  return saveAsset({ ...a, mime: a.mimeType, userId, name: `${a.name} (copy)`, generationId: null, tags: [...a.tags, 'copy'] });
}

/** Resolve a stored asset to bytes (server-side only). */
export async function readAssetBytes(id: string): Promise<{ data: Uint8Array; mime: string } | null> {
  const a = await getAsset(id);
  if (!a?.storageKey) return null;
  const data = await storage().get(a.storageKey);
  return data ? { data, mime: a.mimeType } : null;
}

export async function storageUsage(userId: string) {
  const db = await getDb();
  const rows = await db.repo('assets').findMany({ where: { userId } }) as unknown as Asset[];
  const byKind: Record<string, { count: number; bytes: number }> = {};
  for (const a of rows) {
    byKind[a.kind] ??= { count: 0, bytes: 0 };
    byKind[a.kind].count++; byKind[a.kind].bytes += a.bytes ?? 0;
  }
  return { count: rows.length, bytes: rows.reduce((s, a) => s + (a.bytes ?? 0), 0), byKind };
}
