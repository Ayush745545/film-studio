import { api, badRequest, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { enqueue } from '@/lib/queue';
import { getProject, activeTimeline } from '@/lib/project';
import { hasFfmpeg } from '@/lib/media/ffmpeg';
import type { ExportJob } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const db = await getDb();
  const rows = await db.repo('exports').findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' }, take: 40 }) as unknown as ExportJob[];
  return { exports: rows, ffmpeg: await hasFfmpeg() };
});

export const POST = api(async ({ user, params, json }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const tl = await activeTimeline(params.id);
  if (!tl || !tl.durationSec) throw badRequest('The timeline is empty', 'Assemble or edit something first — there is nothing to export.');
  const body = await json<{
    engine?: 'ffmpeg' | 'stems' | 'bundle'; format?: ExportJob['format']; codec?: ExportJob['codec'];
    resolution?: ExportJob['resolution']; fps?: number; aspectRatio?: ExportJob['aspectRatio'];
    quality?: ExportJob['quality']; bitrate?: number; range?: [number, number] | null; label?: string;
    stemBuses?: ('dialogue'|'sfx'|'ambience'|'music')[];
  }>();
  const engine = body.engine ?? 'ffmpeg';
  if (engine === 'ffmpeg' && !(await hasFfmpeg())) {
    throw badRequest('FFmpeg is not available on this server',
      'Install ffmpeg and set FFMPEG_PATH, or use "Export in browser" — the editor renders the same timeline with the canvas/WebCodecs pipeline and produces a real file. Stems and Project Bundle exports work without ffmpeg.');
  }
  const job = await enqueue({
    userId: user.id, projectId: params.id, kind: engine === 'stems' ? 'stems' : engine === 'bundle' ? 'bundle' : 'export',
    label: body.label ?? (engine === 'stems' ? 'Export stems' : engine === 'bundle' ? 'Export project bundle' : `Export ${body.resolution ?? '1080p'} ${body.format ?? 'mp4'}`),
    sublabel: `${engine} · ${body.quality ?? 'high'}`, stage: 'export', priority: 2,
    input: {
      projectId: params.id, timelineId: tl.id, engine,
      format: body.format ?? 'mp4', codec: body.codec ?? 'h264', resolution: body.resolution ?? '1080p',
      fps: body.fps ?? p.settings.fps, aspectRatio: body.aspectRatio ?? p.settings.format,
      quality: body.quality ?? 'high', bitrate: body.bitrate ?? 12, range: body.range ?? null,
      label: body.label, stemBuses: body.stemBuses
    }
  });
  return { job, ffmpeg: await hasFfmpeg(), timelineId: tl.id, durationSec: tl.durationSec };
}, { strict: true });
