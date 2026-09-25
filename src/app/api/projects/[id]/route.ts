import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getProject, deleteProject, updateProject, loadTimeline, listVersions, projectCounts, computeStageStates, touchProject } from '@/lib/project';
import { audit } from '@/lib/security/audit';
import type { Asset, Character, ExportJob, Location, Project, Scene, Shot, SoundCue, VoiceLine, Story, Screenplay } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The full project workspace payload — one request powers every stage. */
export const GET = api(async ({ user, params }) => {
  const project = await getProject(params.id, user.id);
  if (!project) throw notFound('Project not found');
  void touchProject(params.id);
  const db = await getDb();
  const [characters, locations, scenes, shots, voices, sounds, assets, timeline, versions, exports] = await Promise.all([
    db.repo('characters').findMany({ where: { projectId: params.id } }) as unknown as Promise<Character[]>,
    db.repo('locations').findMany({ where: { projectId: params.id } }) as unknown as Promise<Location[]>,
    db.repo('scenes').findMany({ where: { projectId: params.id } }) as unknown as Promise<Scene[]>,
    db.repo('shots').findMany({ where: { projectId: params.id } }) as unknown as Promise<Shot[]>,
    db.repo('voices').findMany({ where: { projectId: params.id } }) as unknown as Promise<VoiceLine[]>,
    db.repo('sounds').findMany({ where: { projectId: params.id } }) as unknown as Promise<SoundCue[]>,
    db.repo('assets').findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' } }) as unknown as Promise<Asset[]>,
    loadTimeline(params.id, project.activeTimelineId ?? undefined),
    listVersions(params.id, 25),
    db.repo('exports').findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' }, take: 20 }) as unknown as Promise<ExportJob[]>
  ]);
  const sortedScenes = scenes.sort((a, b) => a.index - b.index);
  const sortedShots = shots.sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.index - b.index);
  const counts = {
    characters: characters.length, locations: locations.length, scenes: sortedScenes.length, shots: sortedShots.length,
    frames: sortedShots.filter(s => s.frameAssetId).length, videos: sortedShots.filter(s => s.videoAssetId).length,
    voices: voices.filter(v => v.assetId).length, sounds: sounds.filter(s => s.assetId).length,
    timelineClips: timeline ? timeline.tracks.reduce((a, t) => a + t.clips.length, 0) : 0,
    exports: exports.length, assets: assets.length
  };
  return {
    project: { ...project, stageStates: computeStageStates(project, counts) },
    story: project.story as Story | null,
    screenplay: project.screenplay as Screenplay | null,
    characters, locations, scenes: sortedScenes, shots: sortedShots,
    voices, sounds, assets, timeline, versions, exports, counts
  };
});

export const PATCH = api(async ({ user, params, json }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const body = await json<Partial<Project>>();
  const allowed: Partial<Project> = {};
  if (typeof body.name === 'string' && body.name.trim()) allowed.name = body.name.trim().slice(0, 120);
  if (typeof body.description === 'string') allowed.description = body.description.slice(0, 2000);
  if (body.settings) allowed.settings = { ...p.settings, ...body.settings };
  if (body.idea) allowed.idea = { ...p.idea, ...body.idea };
  if (Array.isArray(body.tags)) allowed.tags = body.tags.slice(0, 30).map(String);
  if (body.stage) allowed.stage = body.stage;
  if (body.coverAssetId !== undefined) allowed.coverAssetId = body.coverAssetId;
  if (typeof body.story === 'object' && body.story) allowed.story = body.story;
  if (typeof body.screenplay === 'object' && body.screenplay) allowed.screenplay = body.screenplay;
  const updated = await updateProject(params.id, allowed, { userId: user.id, reason: 'Project settings changed', snapshot: Boolean(body.idea || body.story || body.screenplay) });
  return updated;
});

export const DELETE = api(async ({ user, params, ip }) => {
  const done = await deleteProject(params.id, user.id);
  if (!done) throw notFound('Project not found');
  await audit({ userId: user.id, action: 'project.delete', entity: 'project', entityId: params.id, ip });
  return { deleted: true };
}, { strict: true });
