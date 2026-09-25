import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getProject, restoreVersion } from '@/lib/project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, params }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const db = await getDb();
  const v = await db.repo('projectVersions').findUnique(params.vid) as any;
  if (!v || v.projectId !== params.id) throw notFound('Version not found');
  const snap = v.snapshot ?? {};
  return {
    version: { id: v.id, rev: v.rev, label: v.label, reason: v.reason, stage: v.stage, createdAt: v.createdAt, sizeBytes: v.sizeBytes },
    summary: {
      story: snap.project?.story?.logline ?? null,
      characters: (snap.characters ?? []).map((c: any) => c.name),
      locations: (snap.locations ?? []).map((l: any) => l.name),
      scenes: (snap.scenes ?? []).length,
      shots: (snap.shots ?? []).length,
      voices: (snap.voices ?? []).length,
      sounds: (snap.sounds ?? []).length,
      timelineClips: snap.timeline?.tracks?.reduce((a: number, t: any) => a + (t.clips?.length ?? 0), 0) ?? 0
    }
  };
});
