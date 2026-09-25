import { api, badRequest } from '@/lib/api';
import { recordBrowserExport } from '@/lib/pipeline/export';
import { config } from '@/lib/config';
import type { ExportJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Receives a browser-rendered export (real WebCodecs/MediaRecorder output). */
export const POST = api(async ({ user, req }) => {
  const form = await req.formData().catch(() => null);
  if (!form) throw badRequest('Expected multipart/form-data with a "file" field');
  const file = form.get('file');
  if (!(file instanceof File)) throw badRequest('Missing "file" field');
  const limit = config.maxUploadMb * 1024 * 1024;
  if (file.size > limit) throw badRequest(`Render exceeds the ${config.maxUploadMb}MB upload limit`);
  const projectId = String(form.get('projectId') ?? '');
  const timelineId = String(form.get('timelineId') ?? '');
  if (!projectId || !timelineId) throw badRequest('projectId and timelineId are required');
  const data = new Uint8Array(await file.arrayBuffer());
  const res = await recordBrowserExport({
    userId: user.id, projectId, timelineId,
    label: String(form.get('label') ?? 'Browser render'),
    format: (String(form.get('format') ?? 'webm') as ExportJob['format']),
    codec: (String(form.get('codec') ?? 'vp9') as ExportJob['codec']),
    resolution: (String(form.get('resolution') ?? '1080p') as ExportJob['resolution']),
    fps: Number(form.get('fps') ?? 24),
    aspectRatio: (String(form.get('aspectRatio') ?? '16:9') as ExportJob['aspectRatio']),
    quality: (String(form.get('quality') ?? 'high') as ExportJob['quality']),
    data, mime: file.type || 'video/webm',
    durationSec: Number(form.get('durationSec') ?? 0),
    width: Number(form.get('width') ?? 1920), height: Number(form.get('height') ?? 1080)
  });
  return res;
}, { strict: true });
