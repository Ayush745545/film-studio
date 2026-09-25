'use client';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { get as apiGet, post, patch as apiPatch, del } from '@/lib/client/api';
import { useApp } from './app';
import type {
  Asset, Character, ExportJob, GenerationJob, Idea, Location, Project, ProjectVersion,
  Scene, Screenplay, Shot, SoundCue, StageId, Story, Timeline, VoiceLine, WorldBible
} from '@/types';
import { STAGES } from '@/types';

export interface ProjectBundle {
  project: Project;
  story: Story | null;
  screenplay: Screenplay | null;
  characters: Character[];
  locations: Location[];
  scenes: Scene[];
  shots: Shot[];
  voices: VoiceLine[];
  sounds: SoundCue[];
  assets: Asset[];
  timeline: Timeline | null;
  versions: ProjectVersion[];
  exports: ExportJob[];
  counts: Record<string, number>;
}

type SaveState = 'saved' | 'saving' | 'error';

interface ProjectState extends ProjectBundle {
  id: string | null;
  stage: StageId;
  loading: boolean;
  error: string | null;
  saveState: SaveState;
  lastSavedAt: number | null;
  pendingJobs: string[];

  load: (id: string, stage?: StageId) => Promise<void>;
  unload: () => void;
  setStage: (s: StageId) => void;
  nextStage: () => void;
  prevStage: () => void;
  refresh: () => Promise<void>;
  refreshTimeline: () => Promise<void>;

  patchProject: (patch: Partial<Project>, opts?: { snapshot?: boolean; reason?: string }) => Promise<void>;
  saveIdea: (idea: Partial<Idea>) => Promise<void>;
  saveStory: (story: Partial<Story>) => Promise<void>;
  saveScript: (script: Partial<Screenplay>) => Promise<void>;

  generate: (action: string, params?: Record<string, unknown>, opts?: { modelId?: string | null; presetId?: string | null; strategy?: string }) => Promise<{ jobs: { id: string; label: string }[]; [k: string]: unknown }>;
  estimate: (action: string, params?: Record<string, unknown>) => Promise<Record<string, any>>;

  updateEntity: <T extends { id: string }>(kind: 'characters' | 'locations' | 'scenes' | 'shots' | 'voices' | 'sounds', id: string, patch: Partial<T>) => Promise<void>;
  deleteEntity: (kind: 'characters' | 'locations' | 'scenes' | 'shots' | 'voices' | 'sounds', id: string) => Promise<void>;
  createEntity: (kind: 'characters' | 'locations' | 'scenes' | 'shots' | 'voices' | 'sounds', data: Record<string, unknown>) => Promise<void>;

  saveTimelineOps: (ops: unknown[]) => Promise<void>;
  setTimeline: (tl: Timeline) => void;
  restoreVersion: (versionId: string) => Promise<void>;
  takeSnapshot: (reason: string) => Promise<void>;
  applyJobEvent: (job: GenerationJob) => void;
  markStage: (stage: StageId, state: string) => void;
}

const EMPTY: ProjectBundle = {
  project: null as unknown as Project, story: null, screenplay: null,
  characters: [], locations: [], scenes: [], shots: [], voices: [], sounds: [],
  assets: [], timeline: null, versions: [], exports: [], counts: {}
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingIdea: Partial<Idea> | null = null;

const useProjectStore = create<ProjectState>()((set, get) => ({
  ...EMPTY,
  id: null, stage: 'idea', loading: false, error: null,
  saveState: 'saved', lastSavedAt: null, pendingJobs: [],

  async load(id, stage) {
    if (get().id === id && get().project) { if (stage) set({ stage }); return; }
    set({ id, loading: true, error: null });
    try {
      const bundle = await apiGet<ProjectBundle>(`/api/projects/${id}`);
      const s = (stage && STAGES.includes(stage) ? stage : (bundle.project.stage ?? 'idea')) as StageId;
      set({ ...bundle, id, stage: s, loading: false, saveState: 'saved', lastSavedAt: Date.now() });
    } catch (err) {
      set({ loading: false, error: (err as Error).message });
    }
  },

  unload() { set({ ...EMPTY, id: null, stage: 'idea' }); },

  setStage(s) {
    set({ stage: s });
    if (typeof window !== 'undefined' && get().id) {
      window.history.replaceState(null, '', `/project/${get().id}?stage=${s}`);
    }
  },
  nextStage() {
    const i = STAGES.indexOf(get().stage);
    if (i >= 0 && i < STAGES.length - 1) get().setStage(STAGES[i + 1]);
  },
  prevStage() {
    const i = STAGES.indexOf(get().stage);
    if (i > 0) get().setStage(STAGES[i - 1]);
  },

  async refresh() {
    const id = get().id; if (!id) return;
    const bundle = await apiGet<ProjectBundle>(`/api/projects/${id}`);
    set({ ...bundle, lastSavedAt: Date.now() });
  },
  async refreshTimeline() {
    const id = get().id; if (!id) return;
    const tl = await apiGet<Timeline>(`/api/projects/${id}/timeline`);
    set({ timeline: tl });
  },

  async patchProject(p, opts) {
    const id = get().id; if (!id) return;
    set({ saveState: 'saving' });
    const proj = get().project;
    set({ project: { ...proj, ...p } });
    try {
      const updated = await apiPatch<Project>(`/api/projects/${id}`, p);
      set({ project: { ...get().project, ...updated }, saveState: 'saved', lastSavedAt: Date.now() });
      if (opts?.snapshot) await get().takeSnapshot(opts.reason ?? 'Change');
    } catch {
      set({ saveState: 'error' });
    }
  },

  saveIdea(idea) {
    pendingIdea = { ...(pendingIdea ?? {}), ...idea };
    set({ saveState: 'saving', project: { ...get().project, idea: { ...get().project.idea, ...idea } } });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      const payload = pendingIdea ?? {}; pendingIdea = null;
      const id = get().id; if (!id) return;
      try {
        await apiPatch(`/api/projects/${id}`, { idea: { ...get().project.idea, ...payload } });
        set({ saveState: 'saved', lastSavedAt: Date.now() });
        const states = { ...get().project.stageStates };
        if (payload.text && states.idea !== 'generating') states.idea = 'ready';
        set({ project: { ...get().project, stageStates: states } });
      } catch { set({ saveState: 'error' }); }
    }, 700);
    return Promise.resolve();
  },

  async saveStory(story) {
    const id = get().id; if (!id || !get().story) return;
    const next = { ...get().story!, ...story };
    set({ story: next, saveState: 'saving' });
    await apiPatch(`/api/projects/${id}`, { story: next });
    set({ saveState: 'saved', lastSavedAt: Date.now() });
  },

  async saveScript(script) {
    const id = get().id; if (!id || !get().screenplay) return;
    const next = { ...get().screenplay!, ...script };
    set({ screenplay: next, saveState: 'saving' });
    await apiPatch(`/api/projects/${id}`, { screenplay: next });
    set({ saveState: 'saved', lastSavedAt: Date.now() });
  },

  async generate(action, params, opts) {
    const id = get().id; if (!id) throw new Error('No project loaded');
    const res = await post<{ jobs: { id: string; label: string }[] } & Record<string, unknown>>(
      `/api/projects/${id}/generate`, { action, params: params ?? {}, modelId: opts?.modelId ?? null, presetId: opts?.presetId ?? null, strategy: opts?.strategy }
    );
    const stages: Record<string, StageId> = { story: 'story', script: 'script', cast: 'characters', world: 'world', breakdown: 'scenes', frames: 'storyboard', videos: 'video', 'character-look': 'characters', 'location-image': 'world', voices: 'voice', cues: 'sound', assemble: 'aiedit', 'edit-plan': 'aiedit', copilot: 'aiedit' };
    const st = stages[action];
    if (st) get().markStage(st, 'generating');
    set({ pendingJobs: [...get().pendingJobs, ...(res.jobs ?? []).map(j => j.id)] });
    return res;
  },

  async estimate(action, params) {
    const id = get().id; if (!id) return {};
    return post<Record<string, any>>(`/api/projects/${id}/estimate`, { action, params: params ?? {} });
  },

  async updateEntity(kind, id, p) {
    set({ saveState: 'saving' });
    const key = kind as keyof ProjectBundle;
    const list = (get()[key] as { id: string }[]) ?? [];
    set({ [key]: list.map(x => x.id === id ? { ...x, ...p } : x) } as never);
    const route = { characters: 'characters', locations: 'locations', scenes: 'scenes', shots: 'shots', voices: 'voices', sounds: 'sounds' }[kind];
    try {
      await apiPatch(`/api/${route}/${id}`, p);
      set({ saveState: 'saved', lastSavedAt: Date.now() });
    } catch (err) {
      set({ saveState: 'error' });
      useApp.getState().toast({ level: 'error', title: 'Could not save', body: (err as Error).message });
    }
  },

  async deleteEntity(kind, id) {
    const route = { characters: 'characters', locations: 'locations', scenes: 'scenes', shots: 'shots', voices: 'voices', sounds: 'sounds' }[kind];
    await del(`/api/${route}/${id}`);
    const key = kind as keyof ProjectBundle;
    set({ [key]: ((get()[key] as { id: string }[]) ?? []).filter(x => x.id !== id) } as never);
  },

  async createEntity(kind, data) {
    const id = get().id; if (!id) return;
    const route = { characters: 'characters', locations: 'locations', scenes: 'scenes', shots: 'shots', voices: 'voices', sounds: 'sounds' }[kind];
    const created = await post<never>(`/api/projects/${id}/${route}`, data);
    const key = kind as keyof ProjectBundle;
    set({ [key]: [...((get()[key] as unknown[]) ?? []), created] } as never);
  },

  async saveTimelineOps(ops) {
    const id = get().id; if (!id) return;
    const tl = await apiPatch<Timeline>(`/api/projects/${id}/timeline`, { ops });
    set({ timeline: tl, lastSavedAt: Date.now() });
  },
  setTimeline(tl) { set({ timeline: tl }); },

  async restoreVersion(versionId) {
    const id = get().id; if (!id) return;
    await post(`/api/projects/${id}/versions/${versionId}/restore`, {});
    await get().refresh();
  },
  async takeSnapshot(reason) {
    const id = get().id; if (!id) return;
    await post(`/api/projects/${id}/versions`, { reason });
  },

  applyJobEvent(job) {
    if (job.projectId && job.projectId !== get().id) return;
    if (job.status === 'succeeded' || job.status === 'failed') {
      const stage = job.stage;
      if (stage) get().markStage(stage, job.status === 'succeeded' ? 'ready' : 'error');
      set({ pendingJobs: get().pendingJobs.filter(x => x !== job.id) });
      // keep counts roughly fresh without a full reload
      if (job.status === 'succeeded' && job.assetIds?.length) {
        void get().refresh().catch(() => {});
      }
    }
  },

  markStage(stage, state) {
    const states = { ...(get().project?.stageStates ?? {}) } as Record<string, string>;
    const prev = states[stage];
    if (state === 'ready' && prev === 'approved') return;
    states[stage] = state;
    set({ project: { ...get().project, stageStates: states as never } });
  }
}));

/* ─────────────────────────────────────────────────────────────
   Shallow-by-default store hook.

   Zustand v5 passes `api.getInitialState` to React as getServerSnapshot. If a
   selector allocates a fresh array/object on each call, React's snapshot
   comparison never settles and you get:

     "The result of getServerSnapshot should be cached to avoid an infinite loop"

   Wrapping every selector in `useShallow` makes that structurally impossible:
   a structurally-equal result keeps its previous identity. Primitives and
   store-owned references behave exactly as before (Object.is), so this is pure
   upside — fewer re-renders, and no way to reintroduce the bug by accident.
   ───────────────────────────────────────────────────────────── */

export const useProject = Object.assign(
  function useProject<T>(selector: (state: ProjectState) => T): T {
    return useProjectStore(useShallow(selector));
  },
  {
    getState: useProjectStore.getState,
    setState: useProjectStore.setState,
    subscribe: useProjectStore.subscribe,
    getInitialState: useProjectStore.getInitialState,
    /** Escape hatch: the un-wrapped zustand hook. */
    raw: useProjectStore
  }
);


export function useStageState(stage: StageId) {
  return useProject(s => (s.project?.stageStates?.[stage] ?? 'empty') as string);
}
