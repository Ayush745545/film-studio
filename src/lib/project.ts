import { getDb } from './db';
import { uid, nowIso, slugify } from './ids';
import { bus } from './events';
import { makeTimeline } from './timeline/factory';
import type {
  Character, Idea, Location, Project, ProjectSettings, ProjectType, ProjectVersion,
  Scene, Screenplay, Shot, SoundCue, StageId, StageState, Story, Timeline, VoiceLine, Asset
} from '@/types';
import { EMPTY_IDEA, STAGES } from '@/types';

export const DEFAULT_SETTINGS: ProjectSettings = {
  type: 'short-film', format: '16:9', durationSec: 60, style: 'Cinematic',
  presetId: null, fps: 24, resolution: '1080p', language: 'en', seed: 0,
  negativePrompt: 'watermark, text, logo, subtitles, deformed hands, extra limbs, blurry, low quality',
  motionStyle: 'Cinematic', autoApprove: false
};

const emptyStageStates = (): Record<StageId, StageState> =>
  Object.fromEntries(STAGES.map(s => [s, 'empty'])) as Record<StageId, StageState>;

export async function createProject(userId: string, input: {
  name: string; type?: ProjectType; settings?: Partial<ProjectSettings>; idea?: Partial<Idea>; description?: string; tags?: string[];
}): Promise<Project> {
  const db = await getDb();
  const settings: ProjectSettings = { ...DEFAULT_SETTINGS, type: input.type ?? 'short-film', ...(input.settings ?? {}) };
  const id = uid('prj');
  const project = await db.repo('projects').create({
    id, userId, name: input.name.trim() || 'Untitled project', slug: slugify(input.name || 'untitled'),
    type: settings.type, description: input.description ?? '', stage: 'idea',
    stageStates: emptyStageStates(), settings,
    idea: { ...EMPTY_IDEA, ...(input.idea ?? {}) },
    story: null, screenplay: null, worldBible: null,
    activeTimelineId: null, rev: 1, coverAssetId: null, tags: input.tags ?? [],
    creditsSpent: 0, generationsCount: 0,
    createdAt: nowIso(), updatedAt: nowIso(), lastOpenedAt: nowIso()
  } as never) as unknown as Project;

  // Every project is born with a timeline so "New Video" and AI projects share one editor.
  const tl = makeTimeline({
    projectId: id, fps: settings.fps, aspectRatio: settings.format, resolution: settings.resolution,
    videoTracks: 4, audioTracks: 4, primary: true
  });
  await saveTimeline(tl, true);
  await db.repo('projects').update(id, { activeTimelineId: tl.id } as never);
  project.activeTimelineId = tl.id;

  await snapshot(id, userId, 'Project created', 'idea');
  bus.publish({ type: 'project:update', projectId: id, patch: project });
  return project;
}

export async function listProjects(userId: string, q?: string): Promise<Project[]> {
  const db = await getDb();
  const rows = await db.repo('projects').findMany({ where: { userId }, orderBy: { lastOpenedAt: 'desc' } }) as unknown as Project[];
  if (!q) return rows;
  const s = q.toLowerCase();
  return rows.filter(p => p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s) || p.tags.some(t => t.toLowerCase().includes(s)));
}

export async function getProject(id: string, userId?: string): Promise<Project | null> {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(id) as unknown as Project | null;
  if (!p) return null;
  if (userId && p.userId !== userId) return null;
  return p;
}

export async function touchProject(id: string) {
  const db = await getDb();
  await db.repo('projects').update(id, { lastOpenedAt: nowIso(), updatedAt: nowIso() } as never);
}

export async function updateProject(id: string, patch: Partial<Project>, opts: { userId?: string; reason?: string; stage?: StageId; snapshot?: boolean } = {}): Promise<Project | null> {
  const db = await getDb();
  const updated = await db.repo('projects').update(id, { ...patch, updatedAt: nowIso() } as never) as unknown as Project | null;
  if (!updated) return null;
  bus.publish({ type: 'project:update', projectId: id, patch: updated });
  if (opts.snapshot && opts.userId) await snapshot(id, opts.userId, opts.reason ?? 'Edit', opts.stage ?? updated.stage);
  return updated;
}

export async function setStage(id: string, stage: StageId, state?: StageState): Promise<Project | null> {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(id) as unknown as Project | null;
  if (!p) return null;
  const states = { ...(p.stageStates ?? emptyStageStates()) };
  if (state) states[stage] = state;
  return await db.repo('projects').update(id, { stageStates: states, stage, updatedAt: nowIso() } as never) as unknown as Project;
}

export async function setStageState(id: string, stage: StageId, state: StageState) {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(id) as unknown as Project | null;
  if (!p) return;
  const states = { ...(p.stageStates ?? emptyStageStates()) };
  states[stage] = state;
  await db.repo('projects').update(id, { stageStates: states, updatedAt: nowIso() } as never);
  bus.publish({ type: 'project:update', projectId: id, patch: { stageStates: states } as Partial<Project> });
}

/** Derive stage state from what actually exists — never trust a stale flag. */
export function computeStageStates(p: Project, counts: { characters: number; locations: number; scenes: number; shots: number; frames: number; videos: number; voices: number; sounds: number; timelineClips: number; exports: number }): Record<StageId, StageState> {
  const s = { ...(p.stageStates ?? emptyStageStates()) };
  const keep = (k: StageId, ready: boolean) => { if (s[k] !== 'generating' && s[k] !== 'error') s[k] = ready ? (s[k] === 'approved' ? 'approved' : 'ready') : (s[k] === 'ready' || s[k] === 'approved' ? s[k] : 'empty'); };
  keep('idea', Boolean(p.idea?.text && p.idea.text.trim().length > 4));
  keep('story', Boolean(p.story?.logline));
  keep('script', Boolean(p.screenplay?.elements?.length));
  keep('characters', counts.characters > 0);
  keep('world', counts.locations > 0);
  keep('scenes', counts.scenes > 0);
  keep('storyboard', counts.frames > 0);
  keep('shots', counts.shots > 0);
  keep('video', counts.videos > 0);
  keep('voice', counts.voices > 0);
  keep('sound', counts.sounds > 0);
  keep('aiedit', counts.timelineClips > 0);
  keep('editor', counts.timelineClips > 0);
  keep('color', counts.timelineClips > 0);
  keep('export', counts.exports > 0);
  return s;
}

export async function projectCounts(projectId: string) {
  const db = await getDb();
  const [characters, locations, scenes, shots, voices, sounds, assets, exportsCount] = await Promise.all([
    db.repo('characters').count({ where: { projectId } }),
    db.repo('locations').count({ where: { projectId } }),
    db.repo('scenes').count({ where: { projectId } }),
    db.repo('shots').count({ where: { projectId } }),
    db.repo('voices').count({ where: { projectId } }),
    db.repo('sounds').count({ where: { projectId } }),
    db.repo('assets').count({ where: { projectId } }),
    db.repo('exports').count({ where: { projectId } })
  ]);
  const shotsRows = await db.repo('shots').findMany({ where: { projectId } }) as unknown as Shot[];
  const tl = await activeTimeline(projectId);
  return {
    characters, locations, scenes, shots, voices, sounds, assets, exports: exportsCount,
    frames: shotsRows.filter(s => s.frameAssetId).length,
    videos: shotsRows.filter(s => s.videoAssetId).length,
    timelineClips: tl ? tl.tracks.reduce((a, t) => a + t.clips.length, 0) : 0
  };
}

/* ── timelines ──────────────────────────────────────────────── */
export async function saveTimeline(tl: Timeline, primary = false): Promise<Timeline> {
  const db = await getDb();
  const next = recalcLocal(tl);
  const existing = await db.repo('timelines').findUnique(next.id) as unknown as Timeline | null;
  if (existing) {
    await db.repo('timelines').update(next.id, {
      name: next.name, fps: next.fps, width: next.width, height: next.height, aspectRatio: next.aspectRatio,
      markers: next.markers, inPoint: next.inPoint, outPoint: next.outPoint, grade: next.grade,
      nested: next.nested, durationSec: next.durationSec, updatedAt: nowIso()
    } as never);
    // Tracks/clips are stored flat so they can be queried and partially updated.
    const dbTracks = await db.repo('tracks').findMany({ where: { timelineId: next.id } }) as unknown as { id: string }[];
    const seen = new Set<string>();
    for (const t of next.tracks) {
      seen.add(t.id);
      await db.repo('tracks').upsert(t.id, {
        id: t.id, timelineId: next.id, kind: t.kind, name: t.name, index: t.index, height: t.height,
        muted: t.muted, solo: t.solo, locked: t.locked, hidden: t.hidden, volume: t.volume, pan: t.pan
      } as never);
      const dbClips = await db.repo('clips').findMany({ where: { trackId: t.id } }) as unknown as { id: string }[];
      const seenClips = new Set<string>();
      for (const c of t.clips) {
        seenClips.add(c.id);
        await db.repo('clips').upsert(c.id, {
          id: c.id, trackId: t.id, assetId: c.assetId, kind: c.kind, name: c.name, srcUrl: c.srcUrl, demo: c.demo,
          start: c.start, duration: c.duration, in: c.in, out: c.out, speed: c.speed, opacity: c.opacity,
          blend: c.blend, transform: c.transform, volume: c.volume, pan: c.pan, fadeIn: c.fadeIn, fadeOut: c.fadeOut,
          transitionIn: c.transitionIn, transitionOut: c.transitionOut, transitionDur: c.transitionDur,
          effects: c.effects, grade: c.grade, freeze: c.freeze, text: c.text, markers: c.markers,
          locked: c.locked, muted: c.muted, linked: c.linked, waveformPeaks: c.waveformPeaks, color: c.color, meta: c.meta
        } as never);
      }
      for (const dc of dbClips) if (!seenClips.has(dc.id)) await db.repo('clips').delete(dc.id);
    }
    for (const dt of dbTracks) if (!seen.has(dt.id)) await db.repo('tracks').delete(dt.id);
    return next;
  }
  await db.repo('timelines').create({
    id: next.id, projectId: next.projectId, name: next.name, fps: next.fps, width: next.width, height: next.height,
    aspectRatio: next.aspectRatio, markers: next.markers, inPoint: next.inPoint, outPoint: next.outPoint,
    grade: next.grade, nested: next.nested, durationSec: next.durationSec, isPrimary: primary,
    createdAt: nowIso(), updatedAt: nowIso()
  } as never);
  for (const t of next.tracks) {
    await db.repo('tracks').create({ ...t, timelineId: next.id, clips: undefined as never } as never);
    for (const c of t.clips) await db.repo('clips').create({ ...c, trackId: t.id, text: c.text ?? null } as never);
  }
  return next;
}

function recalcLocal(tl: Timeline): Timeline {
  let max = 0;
  for (const t of tl.tracks) for (const c of t.clips) max = Math.max(max, c.start + c.duration);
  return { ...tl, durationSec: Math.round(max * 1000) / 1000, updatedAt: nowIso() };
}

export async function loadTimeline(projectId: string, timelineId?: string): Promise<Timeline | null> {
  const db = await getDb();
  const tl = timelineId
    ? await db.repo('timelines').findUnique(timelineId) as unknown as Timeline | null
    : await db.repo('timelines').findFirst({ where: { projectId }, orderBy: { updatedAt: 'desc' } }) as unknown as Timeline | null;
  if (!tl) return null;
  const tracks = await db.repo('tracks').findMany({ where: { timelineId: tl.id } }) as unknown as Track2[];
  const clips = await db.repo('clips').findMany({}) as unknown as Clip2[];
  const byTrack = new Map<string, Clip2[]>();
  for (const c of clips) {
    const arr = byTrack.get(c.trackId) ?? []; arr.push(c); byTrack.set(c.trackId, arr);
  }
  tl.tracks = tracks.sort((a, b) => a.index - b.index).map(t => ({
    ...t, clips: (byTrack.get(t.id) ?? []).map(c => ({ ...c, text: c.text ?? undefined })).sort((a, b) => a.start - b.start)
  })) as Timeline['tracks'];
  return recalcLocal(tl);
}
type Track2 = Timeline['tracks'][number] & { timelineId: string };
type Clip2 = Timeline['tracks'][number]['clips'][number] & { trackId: string };

export async function activeTimeline(projectId: string): Promise<Timeline | null> {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(projectId) as unknown as Project | null;
  return loadTimeline(projectId, p?.activeTimelineId ?? undefined);
}

/* ── versioning ─────────────────────────────────────────────── */
export async function snapshot(projectId: string, userId: string, reason: string, stage?: StageId | null): Promise<ProjectVersion | null> {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(projectId) as unknown as Project | null;
  if (!p) return null;
  const [characters, locations, scenes, shots, voices, sounds] = await Promise.all([
    db.repo('characters').findMany({ where: { projectId } }),
    db.repo('locations').findMany({ where: { projectId } }),
    db.repo('scenes').findMany({ where: { projectId } }),
    db.repo('shots').findMany({ where: { projectId } }),
    db.repo('voices').findMany({ where: { projectId } }),
    db.repo('sounds').findMany({ where: { projectId } })
  ]);
  const tl = await loadTimeline(projectId, p.activeTimelineId ?? undefined);
  const payload = {
    project: { ...p, stageStates: p.stageStates }, characters, locations, scenes, shots, voices, sounds,
    timeline: tl ? { ...tl, tracks: tl.tracks.map(t => ({ ...t, clips: t.clips.map(c => ({ ...c })) })) } : null
  };
  const json = JSON.stringify(payload);
  if (json.length > 12_000_000) {
    // Guard: never write a snapshot so large it would stall the DB. Drop clip-level detail.
    delete (payload as any).timeline;
  }
  const rev = (p.rev ?? 1) + 1;
  const version = await db.repo('projectVersions').create({
    id: uid('rev'), projectId, userId, rev, label: `rev ${rev}`, reason, stage: stage ?? p.stage,
    snapshot: payload, sizeBytes: Buffer.byteLength(JSON.stringify(payload)), createdAt: nowIso()
  } as never) as unknown as ProjectVersion;
  await db.repo('projects').update(projectId, { rev } as never);
  await pruneVersions(projectId, 60);
  return version;
}

async function pruneVersions(projectId: string, keep: number) {
  const db = await getDb();
  const all = await db.repo('projectVersions').findMany({ where: { projectId }, orderBy: { rev: 'desc' } }) as unknown as ProjectVersion[];
  for (const v of all.slice(keep)) await db.repo('projectVersions').delete(v.id);
}

export async function listVersions(projectId: string, take = 40) {
  const db = await getDb();
  const rows = await db.repo('projectVersions').findMany({ where: { projectId }, orderBy: { rev: 'desc' }, take }) as unknown as (ProjectVersion & { snapshot?: unknown })[];
  return rows.map(({ snapshot: _s, ...rest }) => rest);
}

export async function restoreVersion(projectId: string, versionId: string, userId: string): Promise<Project | null> {
  const db = await getDb();
  const v = await db.repo('projectVersions').findUnique(versionId) as unknown as (ProjectVersion & { snapshot: any }) | null;
  if (!v || v.projectId !== projectId) return null;
  await snapshot(projectId, userId, `Before restoring ${v.label}`, null);
  const snap = v.snapshot ?? {};
  const p = snap.project;
  if (p) {
    await db.repo('projects').update(projectId, {
      name: p.name, description: p.description, stage: p.stage, stageStates: p.stageStates,
      settings: p.settings, idea: p.idea, story: p.story, screenplay: p.screenplay,
      worldBible: p.worldBible, tags: p.tags, activeTimelineId: p.activeTimelineId
    } as never);
  }
  // restore collections wholesale
  if (Array.isArray(snap.characters)) await replaceCollection('characters', projectId, snap.characters);
  if (Array.isArray(snap.locations)) await replaceCollection('locations', projectId, snap.locations);
  if (Array.isArray(snap.scenes)) await replaceCollection('scenes', projectId, snap.scenes);
  if (Array.isArray(snap.shots)) await replaceCollection('shots', projectId, snap.shots);
  if (Array.isArray(snap.voices)) await replaceCollection('voices', projectId, snap.voices);
  if (Array.isArray(snap.sounds)) await replaceCollection('sounds', projectId, snap.sounds);
  if (snap.timeline) await saveTimeline(snap.timeline as Timeline);
  const out = await db.repo('projects').findUnique(projectId) as unknown as Project | null;
  if (out) bus.publish({ type: 'project:update', projectId, patch: out });
  return out;
}

async function replaceCollection(name: 'characters' | 'locations' | 'scenes' | 'shots' | 'voices' | 'sounds', projectId: string, rows: any[]) {
  const db = await getDb();
  const repo = db.repo(name);
  await repo.deleteWhere({ where: { projectId } } as never);
  for (const r of rows) await repo.create({ ...r, projectId } as never);
}

/* ── typed accessors ────────────────────────────────────────── */
export async function getStory(projectId: string): Promise<Story | null> {
  const p = await (await getDb()).repo('projects').findUnique(projectId) as unknown as Project | null;
  return p?.story ?? null;
}
export async function getScreenplay(projectId: string): Promise<Screenplay | null> {
  const p = await (await getDb()).repo('projects').findUnique(projectId) as unknown as Project | null;
  return p?.screenplay ?? null;
}
export async function getCharacters(projectId: string) { return (await (await getDb()).repo('characters').findMany({ where: { projectId } })) as unknown as Character[]; }
export async function getLocations(projectId: string) { return (await (await getDb()).repo('locations').findMany({ where: { projectId } })) as unknown as Location[]; }
export async function getScenes(projectId: string) {
  const rows = await (await getDb()).repo('scenes').findMany({ where: { projectId } }) as unknown as Scene[];
  return rows.sort((a, b) => a.index - b.index);
}
export async function getShots(projectId: string) {
  const rows = await (await getDb()).repo('shots').findMany({ where: { projectId } }) as unknown as Shot[];
  return rows.sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.index - b.index);
}
export async function getVoices(projectId: string) { return (await (await getDb()).repo('voices').findMany({ where: { projectId } })) as unknown as VoiceLine[]; }
export async function getSounds(projectId: string) { return (await (await getDb()).repo('sounds').findMany({ where: { projectId } })) as unknown as SoundCue[]; }
export async function getAssets(projectId: string | null) { return (await (await getDb()).repo('assets').findMany({ where: projectId ? { projectId } : {} })) as unknown as Asset[]; }

export async function deleteProject(projectId: string, userId: string): Promise<boolean> {
  const db = await getDb();
  const p = await db.repo('projects').findUnique(projectId) as unknown as Project | null;
  if (!p || p.userId !== userId) return false;
  for (const c of ['projectVersions', 'characters', 'locations', 'scenes', 'shots', 'storyboards', 'voices', 'sounds', 'exports', 'automations', 'runs', 'assets', 'jobs'] as const) {
    await db.repo(c).deleteWhere({ where: { projectId } } as never).catch(() => {});
  }
  const tls = await db.repo('timelines').findMany({ where: { projectId } }) as unknown as Timeline[];
  for (const tl of tls) {
    const tracks = await db.repo('tracks').findMany({ where: { timelineId: tl.id } }) as unknown as { id: string }[];
    for (const t of tracks) await db.repo('clips').deleteWhere({ where: { trackId: t.id } } as never);
    await db.repo('tracks').deleteWhere({ where: { timelineId: tl.id } } as never);
    await db.repo('timelines').delete(tl.id);
  }
  await db.repo('projects').delete(projectId);
  return true;
}

export async function duplicateProject(projectId: string, userId: string): Promise<Project | null> {
  const db = await getDb();
  const src = await db.repo('projects').findUnique(projectId) as unknown as Project | null;
  if (!src) return null;
  const copy = await createProject(userId, { name: `${src.name} (copy)`, type: src.type, settings: src.settings, idea: src.idea, description: src.description, tags: src.tags });
  await db.repo('projects').update(copy.id, { story: src.story, screenplay: src.screenplay, worldBible: src.worldBible, stage: src.stage, stageStates: src.stageStates } as never);
  for (const name of ['characters', 'locations', 'scenes', 'shots', 'voices', 'sounds'] as const) {
    const rows = await db.repo(name).findMany({ where: { projectId } }) as unknown as any[];
    for (const r of rows) await db.repo(name).create({ ...r, id: uid(name.slice(0, 4)), projectId: copy.id } as never);
  }
  return await db.repo('projects').findUnique(copy.id) as unknown as Project;
}
