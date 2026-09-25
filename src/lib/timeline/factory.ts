import { uid } from '../ids';
import type { AspectRatio, Clip, ColorGrade, Fps, Resolution, Track, Timeline, Transform } from '@/types';
import { ASPECT_DIMS, RES_DIMS, DEFAULT_GRADE } from '@/types';

export function defaultTransform(): Transform {
  return { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, crop: { l: 0, r: 0, t: 0, b: 0 }, flipH: false, flipV: false };
}

export function frameDimsFor(aspect: AspectRatio, resolution: Resolution): { width: number; height: number } {
  const d = ASPECT_DIMS[aspect] ?? { w: 16, h: 9 };
  const short = RES_DIMS[resolution] ?? 1080;
  const landscape = d.w >= d.h;
  const width = landscape ? Math.round(short * d.w / d.h / 2) * 2 : short;
  const height = landscape ? short : Math.round(short * d.h / d.w / 2) * 2;
  return { width, height };
}

export function makeClip(p: Partial<Clip> & { trackId: string; start: number; duration: number }): Clip {
  const duration = Math.max(0.04, p.duration);
  return {
    id: p.id ?? uid('clip'), trackId: p.trackId, kind: p.kind ?? 'video',
    name: p.name ?? 'Clip', assetId: p.assetId ?? null, srcUrl: p.srcUrl ?? null, demo: p.demo ?? false,
    start: Math.max(0, p.start), duration, in: p.in ?? 0, out: p.out ?? duration,
    speed: p.speed ?? 1, opacity: p.opacity ?? 1, blend: p.blend ?? 'normal',
    transform: { ...defaultTransform(), ...(p.transform ?? {}) },
    volume: p.volume ?? 1, pan: p.pan ?? 0, fadeIn: p.fadeIn ?? 0, fadeOut: p.fadeOut ?? 0,
    transitionIn: p.transitionIn ?? 'none', transitionOut: p.transitionOut ?? 'none', transitionDur: p.transitionDur ?? 0.5,
    effects: p.effects ?? [], grade: p.grade ?? null, freeze: p.freeze ?? [],
    text: p.text, markers: p.markers ?? [], locked: p.locked ?? false, muted: p.muted ?? false,
    linked: p.linked ?? [], waveformPeaks: p.waveformPeaks ?? null,
    color: p.color ?? (p.kind === 'audio' ? '#2F4A3A' : '#3A352E'), meta: p.meta ?? {}
  };
}

export function makeTrack(kind: 'video' | 'audio', index: number, name?: string): Track {
  return {
    id: uid('trk'), kind, index,
    name: name ?? (kind === 'video' ? `V${index + 1}` : `A${index + 1}`),
    height: kind === 'video' ? 62 : 44, muted: false, solo: false, locked: false, hidden: false,
    volume: 1, pan: 0, clips: []
  };
}

export function makeTimeline(p: {
  projectId: string; name?: string; fps?: Fps; aspectRatio?: AspectRatio; resolution?: Resolution;
  videoTracks?: number; audioTracks?: number; primary?: boolean;
}): Timeline {
  const aspectRatio = p.aspectRatio ?? '16:9';
  const { width, height } = frameDimsFor(aspectRatio, p.resolution ?? '1080p');
  const tracks: Track[] = [];
  for (let i = 0; i < (p.videoTracks ?? 3); i++) tracks.push(makeTrack('video', i));
  for (let i = 0; i < (p.audioTracks ?? 3); i++) tracks.push(makeTrack('audio', i));
  return {
    id: uid('tl'), projectId: p.projectId, name: p.name ?? 'Main Sequence',
    fps: p.fps ?? 24, width, height, aspectRatio,
    tracks, markers: [], inPoint: null, outPoint: null,
    grade: { ...DEFAULT_GRADE }, nested: [], durationSec: 0,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
}

export function timelineDuration(tl: { tracks: Track[] }): number {
  let max = 0;
  for (const t of tl.tracks) for (const c of t.clips) max = Math.max(max, c.start + c.duration);
  return Math.round(max * 1000) / 1000;
}

export function recalc(tl: Timeline): Timeline {
  const durationSec = timelineDuration(tl);
  return { ...tl, durationSec, updatedAt: new Date().toISOString() };
}

export function trackAt(tl: Timeline, index: number, kind: 'video' | 'audio'): Track | undefined {
  return tl.tracks.filter(t => t.kind === kind).find(t => t.index === index);
}

export function allClips(tl: Timeline): Clip[] { return tl.tracks.flatMap(t => t.clips); }

export function clipAtTime(tl: Timeline, t: number, kind: 'video' | 'audio'): Clip[] {
  return tl.tracks.filter(tr => tr.kind === kind && !tr.muted && !tr.hidden)
    .flatMap(tr => tr.clips.filter(c => !c.muted && t >= c.start && t < c.start + c.duration));
}

/** Timecode HH:MM:SS:FF at a given fps. */
export function timecode(sec: number, fps: number): string {
  const s = Math.max(0, sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}:${String(Math.min(fps - 1, f)).padStart(2, '0')}`;
}

export function parseTimecode(tc: string, fps: number): number {
  const p = tc.split(':').map(Number);
  if (p.length === 4) return p[0] * 3600 + p[1] * 60 + p[2] + (p[3] ?? 0) / fps;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  return Number(tc) || 0;
}

export function formatDuration(sec: number): string {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60); const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function emptyGrade(): ColorGrade { return { ...DEFAULT_GRADE, curves: { rgb: [[0,0],[1,1]], red: [[0,0],[1,1]], green: [[0,0],[1,1]], blue: [[0,0],[1,1]] }, hsl: {} }; }

export const CLIP_COLORS: Record<string, string> = {
  video: '#4A3F2A', image: '#3E4A3A', audio: '#2F4A3A', voice: '#3A4A52',
  music: '#46334F', text: '#4A4232', adjustment: '#3A3A42', solid: '#2E3338', shape: '#42382E'
};
