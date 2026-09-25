import { uid } from '../ids';
import type { Clip, ColorGrade, Timeline, TimelineOp, Track, TrackKind, TransitionKind } from '@/types';
import { DEFAULT_GRADE } from '@/types';
import { makeClip, makeTrack, recalc, timelineDuration } from './factory';

/**
 * Pure timeline operations.
 *
 * One implementation, three consumers: the editor UI (with undo/redo), the AI
 * edit stage (ops come out of a model and are shown as a diff before applying)
 * and the automation engine. Because ops are pure and serialisable, an AI
 * proposal is reviewable, undoable and replayable.
 */

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Some callers tag audio clips with their content kind; all of them belong on audio tracks. */
export function isAudioKind(k?: string): boolean {
  return k === 'audio' || k === 'voice' || k === 'music' || k === 'sfx';
}

function findClip(tl: Timeline, clipId: string): { track: Track; clip: Clip; ti: number; ci: number } | null {
  for (let ti = 0; ti < tl.tracks.length; ti++) {
    const tr = tl.tracks[ti];
    const ci = tr.clips.findIndex(c => c.id === clipId);
    if (ci >= 0) return { track: tr, clip: tr.clips[ci], ti, ci };
  }
  return null;
}

function videoTracks(tl: Timeline) { return tl.tracks.filter(t => t.kind === 'video').sort((a, b) => a.index - b.index); }
function audioTracks(tl: Timeline) { return tl.tracks.filter(t => t.kind === 'audio').sort((a, b) => a.index - b.index); }

/** Snap a time to clip edges / playhead / markers within `tol` seconds. */
export function snapTime(tl: Timeline, t: number, tol: number, extra: number[] = []): number {
  const candidates = new Set<number>([0, ...extra]);
  for (const tr of tl.tracks) for (const c of tr.clips) { candidates.add(c.start); candidates.add(c.start + c.duration); }
  for (const m of tl.markers) candidates.add(m.t);
  let best = t; let bestD = tol;
  for (const c of candidates) { const d = Math.abs(c - t); if (d < bestD) { bestD = d; best = c; } }
  return Math.max(0, Math.round(best * 1000) / 1000);
}

export function applyOps(tl: Timeline, ops: TimelineOp[]): Timeline {
  let out = clone(tl);
  for (const op of ops) out = applyOp(out, op);
  return recalc(out);
}

export function applyOp(tl: Timeline, op: TimelineOp): Timeline {
  switch (op.op) {
    case 'addClip': {
      const kind: TrackKind = isAudioKind(op.clip.kind) ? 'audio' : 'video';
      const list = kind === 'video' ? videoTracks(tl) : audioTracks(tl);
      const track = list[op.track] ?? list[list.length - 1];
      if (!track) return tl;
      const clip = makeClip({ ...op.clip, trackId: track.id, kind: (op.clip.kind ?? kind) as Clip['kind'] } as never);
      track.clips.push(clip);
      track.clips.sort((a, b) => a.start - b.start);
      return tl;
    }
    case 'removeClip': {
      const f = findClip(tl, op.clipId);
      if (f) f.track.clips.splice(f.ci, 1);
      return tl;
    }
    case 'rippleDelete': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      const { start, duration } = f.clip;
      f.track.clips.splice(f.ci, 1);
      for (const tr of tl.tracks) {
        if (tr.kind !== f.track.kind) continue;
        for (const c of tr.clips) if (c.start >= start + duration - 1e-6) c.start = Math.max(0, c.start - duration);
      }
      return tl;
    }
    case 'updateClip': {
      const f = findClip(tl, op.clipId);
      if (f) Object.assign(f.clip, stripUndef(op.patch), { id: f.clip.id, trackId: f.clip.trackId });
      return tl;
    }
    case 'moveClip': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      f.clip.start = Math.max(0, op.start);
      if (op.trackId && op.trackId !== f.track.id) {
        const target = tl.tracks.find(t => t.id === op.trackId);
        if (target) { f.track.clips.splice(f.ci, 1); f.clip.trackId = target.id; target.clips.push(f.clip); target.clips.sort((a, b) => a.start - b.start); }
      } else f.track.clips.sort((a, b) => a.start - b.start);
      return tl;
    }
    case 'splitClip': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      const local = op.at - f.clip.start;
      if (local <= 0.02 || local >= f.clip.duration - 0.02) return tl;
      const left = clone(f.clip);
      const right = clone(f.clip);
      right.id = uid('clip');
      right.start = f.clip.start + local;
      right.duration = f.clip.duration - local;
      // source in/out follow the speed-adjusted position
      const srcAt = right.in + local * (right.speed || 1);
      right.in = Math.min(right.out, srcAt);
      left.duration = local;
      left.out = left.in + local * (left.speed || 1);
      left.transitionOut = 'none'; right.transitionIn = 'none';
      left.linked = [right.id]; right.linked = [left.id];
      f.track.clips.splice(f.ci, 1, left, right);
      f.track.clips.sort((a, b) => a.start - b.start);
      return tl;
    }
    case 'trimClip': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      if (op.start != null) {
        const newStart = Math.max(0, op.start);
        const delta = newStart - f.clip.start;
        f.clip.duration = Math.max(0.04, f.clip.duration - delta);
        f.clip.in = Math.max(0, f.clip.in + delta * (f.clip.speed || 1));
        f.clip.start = newStart;
      }
      if (op.duration != null) f.clip.duration = Math.max(0.04, op.duration);
      return tl;
    }
    case 'addTrack': {
      const kind = op.kind;
      const list = kind === 'video' ? videoTracks(tl) : audioTracks(tl);
      const t = makeTrack(kind, op.at ?? list.length, op.name);
      tl.tracks.push(t);
      reindex(tl, kind);
      return tl;
    }
    case 'removeTrack': {
      const i = tl.tracks.findIndex(t => t.id === op.trackId);
      if (i < 0) return tl;
      const kind = tl.tracks[i].kind;
      tl.tracks.splice(i, 1);
      reindex(tl, kind);
      return tl;
    }
    case 'setGrade': {
      if (op.scope === 'timeline') tl.grade = { ...DEFAULT_GRADE, ...tl.grade, ...op.grade } as ColorGrade;
      else if (op.clipId) {
        const f = findClip(tl, op.clipId);
        if (f) f.clip.grade = { ...DEFAULT_GRADE, ...(tl.grade ?? {}), ...(f.clip.grade ?? {}), ...op.grade } as ColorGrade;
      }
      return tl;
    }
    case 'addMarker': {
      tl.markers.push({ id: uid('mk'), t: Math.max(0, op.t), label: op.label, color: '#D99A32' });
      tl.markers.sort((a, b) => a.t - b.t);
      return tl;
    }
    case 'retime': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      const speed = Math.max(0.05, Math.min(32, op.speed));
      const sourceDur = (f.clip.out - f.clip.in) || f.clip.duration * (f.clip.speed || 1);
      f.clip.speed = speed;
      f.clip.duration = Math.max(0.04, sourceDur / speed);
      return tl;
    }
    case 'addTransition': {
      const f = findClip(tl, op.clipId);
      if (!f) return tl;
      const kind: TransitionKind = op.kind;
      if (op.edge === 'in') f.clip.transitionIn = kind; else f.clip.transitionOut = kind;
      f.clip.transitionDur = Math.max(0.05, Math.min(3, op.dur));
      return tl;
    }
    case 'sortTimeline': {
      for (const tr of tl.tracks) tr.clips.sort((a, b) => a.start - b.start);
      return tl;
    }
    default:
      return tl;
  }
}

function reindex(tl: Timeline, kind: TrackKind) {
  const list = tl.tracks.filter(t => t.kind === kind).sort((a, b) => a.index - b.index);
  list.forEach((t, i) => { t.index = i; t.name = t.name.replace(/^[VA]\d+$/, `${kind === 'video' ? 'V' : 'A'}${i + 1}`); });
}

function stripUndef<T extends object>(o: Partial<T>): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as Partial<T>;
}

/* ── higher-level editor actions (built from ops) ─────────── */
export function rippleTrim(tl: Timeline, clipId: string, edge: 'in' | 'out', newTime: number): TimelineOp[] {
  const f = findClip(tl, clipId);
  if (!f) return [];
  if (edge === 'out') {
    const dur = Math.max(0.04, newTime - f.clip.start);
    const delta = dur - f.clip.duration;
    const ops: TimelineOp[] = [{ op: 'trimClip', clipId, duration: dur }];
    if (Math.abs(delta) > 1e-6) {
      for (const tr of tl.tracks) {
        if (tr.kind !== f.track.kind) continue;
        for (const c of tr.clips) {
          if (c.id === clipId) continue;
          if (c.start >= f.clip.start + f.clip.duration - 1e-6) ops.push({ op: 'moveClip', clipId: c.id, start: Math.max(0, c.start + delta) });
        }
      }
    }
    return ops;
  }
  const start = Math.max(0, Math.min(newTime, f.clip.start + f.clip.duration - 0.04));
  const delta = start - f.clip.start;
  const ops: TimelineOp[] = [{ op: 'trimClip', clipId, start, duration: f.clip.duration - delta }];
  for (const tr of tl.tracks) {
    if (tr.kind !== f.track.kind) continue;
    for (const c of tr.clips) {
      if (c.id === clipId) continue;
      if (c.start >= f.clip.start - 1e-6 && c.start < start) ops.push({ op: 'removeClip', clipId: c.id });
      else if (c.start >= f.clip.start) ops.push({ op: 'moveClip', clipId: c.id, start: Math.max(0, c.start + delta) });
    }
  }
  return ops;
}

/** Cut every clip under the playhead (a real "split at playhead"). */
export function splitAllAt(tl: Timeline, t: number): TimelineOp[] {
  const ops: TimelineOp[] = [];
  for (const tr of tl.tracks) {
    for (const c of tr.clips) {
      if (t > c.start + 0.02 && t < c.start + c.duration - 0.02) ops.push({ op: 'splitClip', clipId: c.id, at: t });
    }
  }
  return ops;
}

export function insertClip(tl: Timeline, clip: Partial<Clip> & { start: number; duration: number }, preferTrack?: string): TimelineOp[] {
  const kind: TrackKind = isAudioKind(clip.kind) ? 'audio' : 'video';
  const list = kind === 'video' ? videoTracks(tl) : audioTracks(tl);
  let track = preferTrack ? tl.tracks.find(t => t.id === preferTrack) : undefined;
  if (!track) {
    track = list.find(t => !t.clips.some(c => c.start < clip.start + clip.duration && c.start + c.duration > clip.start)) ?? list[0];
  }
  if (!track) return [{ op: 'addTrack', kind }, { op: 'addClip', track: 0, clip }];
  return [{ op: 'addClip', track: track.index, clip: { ...clip, trackId: track.id } }];
}

export function addAdjustmentLayer(tl: Timeline, start: number, duration: number, grade?: Partial<ColorGrade>): TimelineOp[] {
  const list = videoTracks(tl);
  const top = list[list.length - 1];
  const ops: TimelineOp[] = [];
  let track = top;
  if (!track || track.clips.some(c => c.kind === 'adjustment')) {
    ops.push({ op: 'addTrack', kind: 'video' });
    track = makeTrack('video', list.length, `V${list.length + 1}`);
  }
  ops.push({
    op: 'addClip', track: track.index,
    clip: { kind: 'adjustment', name: 'Adjustment', start, duration, color: '#3A3A42', grade: { ...DEFAULT_GRADE, ...grade } }
  });
  return ops;
}

export function addTextClip(tl: Timeline, text: string, start: number, duration: number, opts?: Partial<Clip['text']>): TimelineOp[] {
  const list = videoTracks(tl);
  const track = list[list.length - 1] ?? makeTrack('video', 0);
  return [{
    op: 'addClip', track: track.index,
    clip: {
      kind: 'text', name: text.slice(0, 28) || 'Text', start, duration, color: '#4A4232',
      text: { content: text, font: 'Inter', size: 46, color: 'rgb(var(--ink-rgb))', align: 'center', y: 0.72, bg: false, animate: 'fade', ...opts }
    }
  }];
}

export function freezeFrame(tl: Timeline, clipId: string, at: number, dur: number): TimelineOp[] {
  const f = findClip(tl, clipId);
  if (!f) return [];
  return [{ op: 'updateClip', clipId, patch: { freeze: [...f.clip.freeze, { at: Math.max(0, at - f.clip.start), dur }] } }];
}

export function setSpeedRamp(tl: Timeline, clipId: string, from: number, to: number): TimelineOp[] {
  const f = findClip(tl, clipId);
  if (!f) return [];
  const eff = f.clip.effects.find(e => e.type === 'speed-ramp') ?? {
    id: uid('fx'), type: 'speed-ramp', name: 'Speed Ramp', enabled: true, intensity: 1, params: {}, keyframes: {}
  };
  eff.params.from = from; eff.params.to = to;
  const effects = f.clip.effects.some(e => e.type === 'speed-ramp') ? f.clip.effects.map(e => e.type === 'speed-ramp' ? eff : e) : [...f.clip.effects, eff];
  return [{ op: 'updateClip', clipId, patch: { effects, speed: (from + to) / 2 } }];
}

export function nestClips(tl: Timeline, clipIds: string[], name: string): Timeline {
  const chosen = clipIds.map(id => findClip(tl, id)).filter(Boolean) as { track: Track; clip: Clip }[];
  if (chosen.length < 2) return tl;
  const start = Math.min(...chosen.map(c => c.clip.start));
  const end = Math.max(...chosen.map(c => c.clip.start + c.clip.duration));
  const next = clone(tl);
  for (const c of chosen) {
    const f = findClip(next, c.clip.id);
    if (f) { f.clip.start -= start; f.track.clips.splice(f.ci, 1); }
  }
  const track = videoTracks(next)[0];
  if (track) {
    track.clips.push(makeClip({
      trackId: track.id, kind: 'video', name, start, duration: end - start,
      color: '#4A4232', meta: { nested: chosen.map(c => ({ ...c.clip, start: c.clip.start })) }
    }));
    track.clips.sort((a, b) => a.start - b.start);
  }
  return recalc(next);
}

export function compoundClips(tl: Timeline, clipIds: string[], name: string): Timeline {
  const chosen = clipIds.map(id => findClip(tl, id)).filter(Boolean) as { track: Track; clip: Clip }[];
  if (chosen.length < 2) return tl;
  const next = clone(tl);
  const start = Math.min(...chosen.map(c => c.clip.start));
  const end = Math.max(...chosen.map(c => c.clip.start + c.clip.duration));
  const first = chosen[0];
  const f = findClip(next, first.clip.id);
  if (f) {
    f.clip.name = name; f.clip.start = start; f.clip.duration = end - start; f.clip.color = '#46334F';
    f.clip.meta = { ...(f.clip.meta ?? {}), compound: chosen.map(c => c.clip.id) };
  }
  for (const c of chosen.slice(1)) {
    const g = findClip(next, c.clip.id);
    if (g) g.track.clips.splice(g.ci, 1);
  }
  return recalc(next);
}

export function chromaKey(clip: Clip, color: string, tolerance = 0.4): Clip {
  const fx = clip.effects.find(e => e.type === 'chroma-key');
  const next = { ...clip, effects: clip.effects.slice() };
  const inst = fx ?? { id: uid('fx'), type: 'chroma-key', name: 'Chroma Key', enabled: true, intensity: 1, params: {}, keyframes: {} };
  inst.params = { ...inst.params, color, tolerance, spill: 0.3 };
  next.effects = fx ? next.effects.map(e => e.type === 'chroma-key' ? inst : e) : [...next.effects, inst];
  return next;
}

export function addEffect(clip: Clip, type: string, name: string, params: Record<string, number | string | boolean> = {}): Clip {
  const next = { ...clip, effects: clip.effects.slice() };
  if (next.effects.some(e => e.type === type)) return next;
  next.effects.push({ id: uid('fx'), type, name, enabled: true, intensity: 1, params, keyframes: {} });
  return next;
}

export function setKeyframe(clip: Clip, effectId: string, param: string, t: number, v: number, ease: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' = 'ease-in-out'): Clip {
  const next = { ...clip, effects: clip.effects.map(e => {
    if (e.id !== effectId) return e;
    const kf = { ...(e.keyframes ?? {}) };
    const arr = (kf[param] ?? []).filter(k => Math.abs(k.t - t) > 1e-4);
    arr.push({ t, v, ease }); arr.sort((a, b) => a.t - b.t);
    kf[param] = arr;
    return { ...e, keyframes: kf };
  }) };
  return next;
}

export function sampleKeyframes(kf: { t: number; v: number; ease: string }[] | undefined, t: number, fallback: number): number {
  if (!kf?.length) return fallback;
  if (t <= kf[0].t) return kf[0].v;
  const last = kf[kf.length - 1];
  if (t >= last.t) return last.v;
  for (let i = 0; i < kf.length - 1; i++) {
    const a = kf[i]; const b = kf[i + 1];
    if (t >= a.t && t <= b.t) {
      const p = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const e = b.ease;
      const q = e === 'linear' ? p : e === 'ease-in' ? p * p : e === 'ease-out' ? 1 - (1 - p) ** 2 : e === 'hold' ? 0 : p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      return a.v + (b.v - a.v) * q;
    }
  }
  return fallback;
}

/* ── AI edit primitives (used by /api/projects/[id]/edit) ─── */
export function tightenOps(tl: Timeline, amount: number): TimelineOp[] {
  const ops: TimelineOp[] = [];
  const cuts = amount > 0.5 ? 0.35 : amount;
  for (const tr of tl.tracks) {
    if (tr.kind !== 'video') continue;
    for (const c of tr.clips) {
      if (c.duration > 3) ops.push({ op: 'trimClip', clipId: c.id, duration: Math.max(1.2, c.duration * (1 - cuts)) });
    }
  }
  return ops;
}

export function condenseOps(tl: Timeline, targetSec: number): TimelineOp[] {
  const total = timelineDuration(tl);
  if (total <= targetSec || total <= 0) return [];
  const ratio = targetSec / total;
  const ops: TimelineOp[] = [];
  let cursor = 0;
  const vids = videoTracks(tl)[0];
  if (!vids) return [];
  for (const c of vids.clips) {
    const dur = Math.max(0.8, c.duration * ratio);
    ops.push({ op: 'moveClip', clipId: c.id, start: Math.round(cursor * 1000) / 1000 });
    ops.push({ op: 'trimClip', clipId: c.id, duration: Math.round(dur * 1000) / 1000 });
    cursor += dur;
  }
  ops.push({ op: 'sortTimeline' });
  return ops;
}

export function reframeOps(tl: Timeline, aspect: '9:16' | '16:9' | '1:1'): TimelineOp[] {
  return tl.tracks.flatMap(t => t.clips.map(c => ({
    op: 'updateClip' as const, clipId: c.id,
    patch: { transform: { ...c.transform, scale: aspect === '9:16' ? 1.78 : aspect === '1:1' ? 1.33 : 1 } }
  })));
}

export function captionOpsFromLines(lines: { start: number; end: number; text: string }[], trackIndex = 0): TimelineOp[] {
  return lines.map(l => ({
    op: 'addClip' as const, track: trackIndex,
    clip: {
      kind: 'text' as const, name: l.text.slice(0, 24), start: l.start, duration: Math.max(0.6, l.end - l.start),
      color: '#4A4232',
      text: { content: l.text, font: 'Inter', size: 40, color: '#FFFFFF', align: 'center' as const, y: 0.86, bg: true, animate: 'none' as const }
    }
  }));
}
