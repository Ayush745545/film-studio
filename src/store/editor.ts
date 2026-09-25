'use client';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { applyOps, snapTime } from '@/lib/timeline/ops';
import { patch } from '@/lib/client/api';
import { useApp } from './app';
import { describeError } from '@/lib/client/api';
import type { Clip, ColorGrade, Timeline, TimelineOp, TrackKind } from '@/types';

export type Tool = 'select' | 'trim' | 'razor' | 'slip' | 'hand';
export type InspectorTab = 'clip' | 'effects' | 'color' | 'speed' | 'audio' | 'text' | 'track';

/**
 * Editor state: one source of truth for the timeline, with a local undo/redo
 * stack and debounced server persistence. AI proposals and automation write
 * through the same `apply()` so every change is undoable and saved.
 */
interface EditorState {
  timeline: Timeline | null;
  projectId: string | null;
  selection: string[];
  activeTrack: string | null;
  playhead: number;
  playing: boolean;
  rate: number;
  zoom: number;                 // pixels per second
  scrollX: number;
  tool: Tool;
  snap: boolean;
  linked: boolean;
  inPoint: number | null;
  outPoint: number | null;
  inspector: InspectorTab;
  saving: boolean;
  dirty: boolean;
  past: Timeline[];
  future: Timeline[];
  previewScale: number;          // 1 = fit, 0.5, 2
  safeAreas: boolean;
  showWaveforms: boolean;
  gradeTarget: 'timeline' | 'clip';
  loopRange: boolean;
  /** Grade bypass for before/after comparison in the Color stage. */
  bypass: boolean;

  init: (tl: Timeline, projectId: string) => void;
  reset: () => void;
  set: (p: Partial<EditorState>) => void;
  select: (ids: string[], additive?: boolean) => void;
  selectTrack: (id: string | null) => void;
  setPlayhead: (t: number, opts?: { snap?: boolean }) => void;
  nudge: (frames: number) => void;
  setTool: (t: Tool) => void;
  apply: (ops: TimelineOp[], opts?: { label?: string; save?: boolean; coalesce?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  selectedClips: () => Clip[];
  setGrade: (grade: Partial<ColorGrade>, target?: 'timeline' | 'clip') => void;
  resetGrade: (target?: 'timeline' | 'clip') => void;
  addTrack: (kind: TrackKind) => void;
  deleteSelected: (ripple?: boolean) => void;
  splitAtPlayhead: () => void;
  markIn: () => void;
  markOut: () => void;
  clearMarks: () => void;
  addMarker: (label?: string) => void;
  flush: () => Promise<void>;
  duration: () => number;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastOps: { key: string; at: number } | null = null;

const useEditorStore = create<EditorState>()((set, get) => ({
  timeline: null, projectId: null, selection: [], activeTrack: null,
  playhead: 0, playing: false, rate: 1, zoom: 46, scrollX: 0,
  tool: 'select', snap: true, linked: true,
  inPoint: null, outPoint: null, inspector: 'clip',
  saving: false, dirty: false, past: [], future: [],
  previewScale: 1, safeAreas: false, showWaveforms: true,
  gradeTarget: 'timeline', loopRange: false, bypass: false,

  init(tl, projectId) {
    set({ timeline: tl, projectId, selection: [], playhead: 0, past: [], future: [], dirty: false, inPoint: tl.inPoint, outPoint: tl.outPoint });
  },
  reset() { set({ timeline: null, projectId: null, selection: [], playhead: 0, past: [], future: [] }); },
  set(p) { set(p as never); },

  select(ids, additive) {
    if (!additive) { set({ selection: ids }); return; }
    const cur = new Set(get().selection);
    for (const id of ids) cur.has(id) ? cur.delete(id) : cur.add(id);
    set({ selection: [...cur] });
  },
  selectTrack(id) { set({ activeTrack: id }); },

  setPlayhead(t, opts) {
    const tl = get().timeline; if (!tl) { set({ playhead: Math.max(0, t) }); return; }
    let next = Math.max(0, t);
    if (get().snap && opts?.snap !== false) next = snapTime(tl, next, 8 / get().zoom);
    set({ playhead: Math.min(next, Math.max(tl.durationSec + 4, next)) });
  },
  nudge(frames) {
    const tl = get().timeline; if (!tl) return;
    get().setPlayhead(get().playhead + frames / tl.fps, { snap: false });
  },
  setTool(t) { set({ tool: t }); },

  apply(ops, opts) {
    const tl = get().timeline;
    if (!tl || !ops.length) return;
    const before = tl;
    const next = applyOps(tl, ops);
    const past = [...get().past, before].slice(-60);
    // coalesce rapid identical ops (slider drags) into one undo step
    const key = ops.map(o => o.op).join('|');
    const coalesce = opts?.coalesce && lastOps && lastOps.key === key && Date.now() - lastOps.at < 700;
    lastOps = { key, at: Date.now() };
    set({ timeline: next, past: coalesce ? get().past : past, future: [], dirty: true, playhead: Math.min(get().playhead, next.durationSec + 2) });
    if (opts?.save !== false) queueSave();
  },

  undo() {
    const { past, timeline } = get();
    if (!past.length || !timeline) return;
    const prev = past[past.length - 1];
    set({ timeline: prev, past: past.slice(0, -1), future: [timeline, ...get().future].slice(0, 60), dirty: true, selection: get().selection.filter(id => prev.tracks.some(t => t.clips.some(c => c.id === id))) });
    queueSave();
  },
  redo() {
    const { future, timeline } = get();
    if (!future.length || !timeline) return;
    const next = future[0];
    set({ timeline: next, future: future.slice(1), past: [...get().past, timeline].slice(-60), dirty: true });
    queueSave();
  },
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  selectedClips() {
    const tl = get().timeline; if (!tl) return [];
    const sel = new Set(get().selection);
    return tl.tracks.flatMap(t => t.clips).filter(c => sel.has(c.id));
  },

  setGrade(grade, target) {
    const tgt = target ?? get().gradeTarget;
    const sel = get().selectedClips();
    if (tgt === 'clip' && sel.length) {
      get().apply(sel.map(c => ({ op: 'setGrade' as const, scope: 'clip' as const, clipId: c.id, grade })), { coalesce: true, label: 'grade' });
    } else {
      get().apply([{ op: 'setGrade', scope: 'timeline', grade }], { coalesce: true, label: 'grade' });
    }
  },
  resetGrade(target) {
    const tgt = target ?? get().gradeTarget;
    const zero: Partial<ColorGrade> = {
      exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, temperature: 0, tint: 0,
      saturation: 0, vibrance: 0, sharpness: 0, fade: 0, vignette: 0, grain: 0,
      lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0],
      curves: { rgb: [[0, 0], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] },
      splitBalance: 0
    };
    get().setGrade(zero, tgt);
  },

  addTrack(kind) {
    get().apply([{ op: 'addTrack', kind }], { label: 'add track' });
  },
  deleteSelected(ripple) {
    const sel = get().selectedClips();
    if (!sel.length) return;
    const ops: TimelineOp[] = sel.map(c => ripple ? ({ op: 'rippleDelete', clipId: c.id } as TimelineOp) : ({ op: 'removeClip', clipId: c.id } as TimelineOp));
    get().apply(ops, { label: ripple ? 'ripple delete' : 'delete' });
    set({ selection: [] });
  },
  splitAtPlayhead() {
    const tl = get().timeline; if (!tl) return;
    const t = get().playhead;
    const sel = get().selection;
    const targets = sel.length
      ? tl.tracks.flatMap(tr => tr.clips).filter(c => sel.includes(c.id) && t > c.start + 0.02 && t < c.start + c.duration - 0.02)
      : tl.tracks.flatMap(tr => tr.clips).filter(c => t > c.start + 0.02 && t < c.start + c.duration - 0.02);
    if (!targets.length) { useApp.getState().toast({ level: 'info', title: 'Nothing to split at the playhead' }); return; }
    get().apply(targets.map(c => ({ op: 'splitClip', clipId: c.id, at: t })), { label: 'split' });
  },
  markIn() { set({ inPoint: get().playhead }); },
  markOut() { set({ outPoint: Math.max(get().inPoint ?? 0, get().playhead) }); },
  clearMarks() { set({ inPoint: null, outPoint: null }); },
  addMarker(label) {
    const t = get().playhead;
    get().apply([{ op: 'addMarker', t, label: label ?? `Marker ${Math.round(t * 100) / 100}s` }], { label: 'marker' });
  },

  async flush() {
    const { timeline, projectId, dirty } = get();
    if (!timeline || !projectId || !dirty) return;
    set({ saving: true });
    try {
      await patch<Timeline>(`/api/projects/${projectId}/timeline`, { timeline, reason: 'Editor autosave' });
      set({ saving: false, dirty: false });
    } catch (err) {
      set({ saving: false });
      const d = describeError(err);
      useApp.getState().toast({ level: 'error', title: d.title, body: d.body });
    }
  },

  duration() { return get().timeline?.durationSec ?? 0; }
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

export const useEditor = Object.assign(
  function useEditor<T>(selector: (state: EditorState) => T): T {
    return useEditorStore(useShallow(selector));
  },
  {
    getState: useEditorStore.getState,
    setState: useEditorStore.setState,
    subscribe: useEditorStore.subscribe,
    getInitialState: useEditorStore.getInitialState,
    /** Escape hatch: the un-wrapped zustand hook. */
    raw: useEditorStore
  }
);


function queueSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void useEditor.getState().flush(); }, 900);
}

export function useSelectedClip(): Clip | null {
  const tl = useEditor(s => s.timeline);
  const sel = useEditor(s => s.selection);
  if (!tl || !sel.length) return null;
  for (const t of tl.tracks) for (const c of t.clips) if (c.id === sel[0]) return c;
  return null;
}
export function useTimeline() { return useEditor(s => s.timeline); }
