import { api, badRequest } from '@/lib/api';
import { saveAsset } from '@/lib/assets';
import { decodeWav, peaks } from '@/lib/media/wav-io';
import { config } from '@/lib/config';
import { audit } from '@/lib/security/audit';
import type { AssetKind } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const ALLOWED = new Set([
  'image/png','image/jpeg','image/webp','image/svg+xml','image/gif','image/tiff',
  'video/mp4','video/webm','video/quicktime','video/x-matroska',
  'audio/wav','audio/mpeg','audio/mp4','audio/ogg','audio/webm','audio/aac','audio/x-aiff',
  'application/json','text/plain','application/zip','.cube','text/csv'
]);
const KIND_BY_MIME: [RegExp, AssetKind][] = [
  [/^image\//, 'image'], [/^video\//, 'video'], [/^audio\//, 'audio'], [/zip/, 'project'], [/json|plain|csv/, 'document']
];

/** Validated upload path: type allow-list, size cap, and metadata extraction. */
export const POST = api(async ({ user, req, ip }) => {
  const limit = config.maxUploadMb * 1024 * 1024;
  const lenHeader = Number(req.headers.get('content-length') ?? 0);
  if (lenHeader && lenHeader > limit) throw badRequest(`File exceeds the ${config.maxUploadMb}MB limit`, 'Trim or compress the media first, or raise AFS_MAX_UPLOAD_MB.');

  const ct = req.headers.get('content-type') ?? '';
  if (ct.startsWith('multipart/form-data')) {
    const form = await req.formData();
    const projectId = String(form.get('projectId') ?? '') || null;
    const kind = (String(form.get('kind') ?? '') || undefined) as AssetKind | undefined;
    const out = [];
    for (const file of form.getAll('files')) {
      if (!(file instanceof File)) continue;
      if (file.size > limit) throw badRequest(`"${file.name}" exceeds the ${config.maxUploadMb}MB limit`);
      const mime = file.type || 'application/octet-stream';
      if (!ALLOWED.has(mime) && !mime.endsWith('/x-unknown')) throw badRequest(`Unsupported file type: ${mime}`, `Allowed: images, video, audio, JSON, CSV, ZIP.`);
      const data = new Uint8Array(await file.arrayBuffer());
      out.push(await persist(user.id, projectId, file.name, mime, data, kind));
    }
    if (!out.length) throw badRequest('No files in the upload');
    await audit({ userId: user.id, action: 'upload', entity: 'asset', ip, meta: { count: out.length } });
    return { assets: out };
  }

  // raw single-file upload
  const mime = ct.split(';')[0] || 'application/octet-stream';
  const name = req.headers.get('x-filename') || `upload-${Date.now()}`;
  const projectId = new URL(req.url).searchParams.get('projectId');
  if (!ALLOWED.has(mime)) throw badRequest(`Unsupported file type: ${mime}`);
  const data = new Uint8Array(await req.arrayBuffer());
  if (data.byteLength > limit) throw badRequest(`File exceeds the ${config.maxUploadMb}MB limit`);
  const asset = await persist(user.id, projectId, name, mime, data);
  await audit({ userId: user.id, action: 'upload', entity: 'asset', entityId: asset.id, ip });
  return { assets: [asset] };
}, { strict: true });

async function persist(userId: string, projectId: string | null, name: string, mime: string, data: Uint8Array, kind?: AssetKind) {
  const resolvedKind: AssetKind = kind ?? (KIND_BY_MIME.find(([re]) => re.test(mime))?.[1] ?? 'document');
  let width: number | undefined, height: number | undefined, durationSec: number | undefined;
  let meta: Record<string, unknown> = {};
  if (mime === 'image/svg+xml') {
    const svg = new TextDecoder().decode(data.slice(0, 4000));
    const w = /width="(\d+(?:\.\d+)?)/.exec(svg); const h = /height="(\d+(?:\.\d+)?)/.exec(svg);
    if (w) width = Number(w[1]); if (h) height = Number(h[1]);
  } else if (mime.startsWith('audio/')) {
    const pcm = decodeWav(data);
    if (pcm) { durationSec = pcm.length / pcm.sampleRate; meta = { peaks: peaks(pcm.channels[0]), sampleRate: pcm.sampleRate }; }
  }
  return saveAsset({
    userId, projectId, kind: resolvedKind, name: name.slice(0, 160), data, mime,
    prompt: '', demo: false, width, height, durationSec,
    tags: ['upload'], meta: { ...meta, uploaded: true }
  });
}
