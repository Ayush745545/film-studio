import { api, notFound, badRequest } from '@/lib/api';
import { activeTimeline, loadTimeline, saveTimeline, snapshot } from '@/lib/project';
import { applyOps } from '@/lib/timeline/ops';
import { makeTimeline } from '@/lib/timeline/factory';
import type { Timeline, TimelineOp } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params, query }) => {
  const tl = query().get('id') ? await loadTimeline(params.id, query().get('id')!) : await activeTimeline(params.id);
  if (!tl) throw notFound('No timeline on this project yet');
  return tl;
});

/** Ops are applied server-side so AI proposals, automation and manual edits share one path. */
export const PATCH = api(async ({ user, params, json }) => {
  const body = await json<{ ops?: TimelineOp[]; timeline?: Timeline; reason?: string; snapshot?: boolean }>();
  const current = await activeTimeline(params.id);
  if (!current && !body.timeline) throw notFound('No timeline on this project yet');
  let next = body.timeline ? normalise(body.timeline, params.id) : current!;
  if (body.ops?.length) next = applyOps(next, body.ops);
  if (body.snapshot) await snapshot(params.id, user.id, body.reason ?? 'Timeline edit', 'editor');
  await saveTimeline(next);
  return next;
});

export const POST = api(async ({ user, params, json }) => {
  const body = await json<{ name?: string; fps?: number; aspectRatio?: string; resolution?: string }>();
  const tl = makeTimeline({
    projectId: params.id, name: body.name ?? 'Sequence 2',
    fps: (body.fps as never) ?? 24, aspectRatio: (body.aspectRatio as never) ?? '16:9', resolution: (body.resolution as never) ?? '1080p',
    videoTracks: 4, audioTracks: 4
  });
  await saveTimeline(tl);
  return tl;
});

function normalise(tl: Timeline, projectId: string): Timeline {
  if (!tl || !Array.isArray(tl.tracks)) throw badRequest('Timeline payload must include tracks');
  return { ...tl, projectId, tracks: tl.tracks.map(t => ({ ...t, clips: (t.clips ?? []).map(c => ({ ...c, trackId: t.id })) })) };
}
