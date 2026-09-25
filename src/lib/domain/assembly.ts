import type { Asset, Clip, Project, Scene, Shot, SoundCue, Timeline, VoiceLine } from '@/types';
import { makeClip, recalc, timelineDuration } from '../timeline/factory';
import { DEFAULT_GRADE } from '@/types';

/**
 * AI Assemble — turns everything the pipeline produced into a real timeline.
 *
 * Rules an editor would recognise: one continuous V1 spine in scene/shot order,
 * stills used when a shot has no motion yet, dialogue on A1 with a little
 * handle, ambience on A2, foley/SFX on A3, score on A4 with a duck under
 * dialogue. Nothing is invented: if the media doesn't exist it isn't placed.
 */

export interface AssembleInput {
  project: Project;
  timeline: Timeline;
  scenes: Scene[];
  shots: Shot[];
  assets: Asset[];
  voices: VoiceLine[];
  sounds: SoundCue[];
  opts?: {
    mode?: 'full' | 'trailer' | 'short30' | 'social';
    includeStills?: boolean;
    includeMusic?: boolean;
    includeAmbience?: boolean;
    includeDialogue?: boolean;
    addCaptions?: boolean;
    grade?: 'none' | 'cinematic' | 'noir' | 'warm' | 'cold';
    transition?: Clip['transitionOut'];
  };
}

const GRADES: Record<string, Partial<typeof DEFAULT_GRADE>> = {
  none: {},
  cinematic: { contrast: 8, saturation: -6, temperature: -6, shadows: -6, highlights: 4, vignette: 22, grain: 14, fade: 4 },
  noir: { contrast: 22, saturation: -46, blacks: -14, shadows: -18, highlights: 8, vignette: 34, grain: 22, temperature: -12 },
  warm: { temperature: 16, tint: 4, saturation: 6, highlights: 6, shadows: 4, vibrance: 10, fade: 6 },
  cold: { temperature: -18, tint: -4, saturation: -8, contrast: 10, shadows: -8, highlights: 2 }
};

export function assemble(input: AssembleInput): { timeline: Timeline; placed: number; skipped: number; warnings: string[] } {
  const { timeline, scenes, shots, assets, voices, sounds } = input;
  const opts = input.opts ?? {};
  const assetById = new Map(assets.map(a => [a.id, a]));
  const warnings: string[] = [];
  let placed = 0; let skipped = 0;

  const vids = timeline.tracks.filter(t => t.kind === 'video').sort((a, b) => a.index - b.index);
  const auds = timeline.tracks.filter(t => t.kind === 'audio').sort((a, b) => a.index - b.index);
  const v1 = vids[0]; const v2 = vids[1] ?? vids[0];
  const a1 = auds[0]; const a2 = auds[1] ?? auds[0]; const a3 = auds[2] ?? auds[0]; const a4 = auds[3] ?? auds[2] ?? auds[0];
  if (!v1) return { timeline, placed: 0, skipped: 0, warnings: ['Timeline has no video track'] };

  // reset the spine so assembly is idempotent
  for (const t of timeline.tracks) t.clips = [];

  const orderedScenes = scenes.slice().sort((a, b) => a.index - b.index);
  const grade = { ...DEFAULT_GRADE, ...(GRADES[opts.grade ?? 'none'] ?? {}) };
  let cursor = 0;

  for (const scene of orderedScenes) {
    const sceneShots = shots.filter(s => s.sceneId === scene.id).sort((a, b) => a.index - b.index);
    const list = sceneShots.length ? sceneShots : [{ id: `synthetic-${scene.id}`, sceneId: scene.id, index: 1, durationSec: scene.durationSec, videoAssetId: null, frameAssetId: null, prompt: scene.heading, size: 'Wide', lens: '24mm', move: 'Static' } as unknown as Shot];

    for (const shot of list) {
      const video = shot.videoAssetId ? assetById.get(shot.videoAssetId) : null;
      const still = shot.frameAssetId ? assetById.get(shot.frameAssetId) : null;
      const dur = Math.max(0.5, shot.durationSec ?? scene.durationSec ?? 3);
      const use = video ?? (opts.includeStills === false ? null : still);
      if (!use) { skipped++; continue; }

      const clip = makeClip({
        trackId: (video ? v1 : v2).id,
        kind: video ? (video.mimeType.startsWith('video') ? 'video' : 'video') : 'image',
        name: `SC${String(scene.index).padStart(2, '0')} SH${String(shot.index).padStart(2, '0')} · ${shot.size ?? 'Shot'}`,
        assetId: use.id, srcUrl: use.url, demo: use.demo,
        start: cursor, duration: dur, in: 0, out: dur,
        grade: opts.grade && opts.grade !== 'none' ? grade : null,
        transitionOut: opts.transition ?? 'cut',
        color: video ? '#4A3F2A' : '#3E4A3A',
        meta: { shotId: shot.id, sceneId: scene.id, prompt: shot.prompt, lens: (shot as Shot).lens, move: (shot as Shot).move, motion: use.meta?.motion ?? undefined }
      });
      (video ? v1 : v2).clips.push(clip);
      placed++;
      cursor += dur;
    }

    // scene marker at the head
    if (!timeline.markers.some(m => Math.abs(m.t - (cursor - scene.durationSec)) < 0.01)) {
      timeline.markers.push({ id: `mk-${scene.id}`, t: Math.max(0, Math.round((cursor - scene.durationSec) * 100) / 100), label: `SC ${scene.index}`, color: '#D99A32' });
    }
  }

  const totalDur = Math.max(cursor, timelineDuration(timeline));

  /* ── dialogue ─────────────────────────────────────────── */
  if (opts.includeDialogue !== false && a1) {
    const lines = voices.filter(v => v.assetId && assetById.has(v.assetId))
      .sort((a, b) => (a.sceneId ?? '').localeCompare(b.sceneId ?? '') || a.id.localeCompare(b.id));
    let t = 0.6;
    for (const line of lines) {
      const asset = assetById.get(line.assetId!)!;
      const dur = Math.max(0.4, asset.durationSec ?? line.durationSec ?? 2);
      if (t + dur > totalDur + 2) break;
      a1.clips.push(makeClip({
        trackId: a1.id, kind: 'audio', name: `${line.speaker}: ${line.text.slice(0, 24)}`,
        assetId: asset.id, srcUrl: asset.url, demo: asset.demo,
        start: t, duration: dur, in: 0, out: dur,
        volume: 1, fadeIn: 0.02, fadeOut: 0.06, color: '#3A4A52',
        waveformPeaks: (asset.meta?.peaks as number[]) ?? null,
        meta: { voiceLineId: line.id, sceneId: line.sceneId, emotion: line.emotion, scratch: Boolean(asset.meta?.scratch) }
      }));
      t += dur + 0.35;
      placed++;
    }
    if (!lines.length && voices.length) warnings.push(`${voices.length} dialogue lines exist but none have generated audio yet.`);
  }

  /* ── ambience / foley / sfx ───────────────────────────── */
  if (opts.includeAmbience !== false) {
    for (const cue of sounds) {
      if (!cue.assetId) continue;
      const asset = assetById.get(cue.assetId);
      if (!asset) continue;
      const track = cue.kind === 'ambience' ? a2 : a3;
      if (!track) continue;
      const dur = Math.min(Math.max(0.5, cue.durationSec), Math.max(1, totalDur - cue.startSec));
      if (dur <= 0.2) continue;
      track.clips.push(makeClip({
        trackId: track.id, kind: 'audio', name: cue.name,
        assetId: asset.id, srcUrl: asset.url, demo: asset.demo,
        start: Math.max(0, cue.startSec), duration: dur, in: 0, out: dur,
        volume: cue.volume, fadeIn: cue.loop ? 0.6 : 0.01, fadeOut: cue.loop ? 0.6 : 0.25,
        color: cue.kind === 'ambience' ? '#2F4A3A' : '#42382E',
        waveformPeaks: (asset.meta?.peaks as number[]) ?? null,
        meta: { cueId: cue.id, loop: cue.loop, kind: cue.kind, sceneId: cue.sceneId }
      }));
      placed++;
    }
  }

  /* ── score / music ────────────────────────────────────── */
  if (opts.includeMusic !== false && a4) {
    const music = sounds.filter(c => (c.kind === 'score' || c.kind === 'music') && c.assetId).sort((a, b) => a.startSec - b.startSec);
    for (const cue of music) {
      const asset = assetById.get(cue.assetId!)!;
      const dur = Math.min(Math.max(1, cue.durationSec), Math.max(1, totalDur - cue.startSec + 1));
      a4.clips.push(makeClip({
        trackId: a4.id, kind: 'audio', name: cue.name,
        assetId: asset.id, srcUrl: asset.url, demo: asset.demo,
        start: Math.max(0, cue.startSec), duration: dur, in: 0, out: dur,
        volume: cue.volume, fadeIn: 1.2, fadeOut: 1.6, color: '#46334F',
        waveformPeaks: (asset.meta?.peaks as number[]) ?? null,
        meta: { cueId: cue.id, kind: cue.kind, duck: 0.55 }
      }));
      placed++;
    }
    if (!music.length) warnings.push('No score generated yet — the music bus is empty.');
  }

  /* ── captions ─────────────────────────────────────────── */
  if (opts.addCaptions) {
    const captionTrack = vids[vids.length - 1];
    if (captionTrack) {
      let t = 0.6;
      for (const line of voices.filter(v => v.text.trim())) {
        const dur = Math.max(1, (line.assetId ? (assetById.get(line.assetId)?.durationSec ?? 2) : line.text.split(/\s+/).length / 2.6));
        captionTrack.clips.push(makeClip({
          trackId: captionTrack.id, kind: 'text', name: line.text.slice(0, 24),
          start: t, duration: dur, color: '#4A4232',
          text: { content: line.text, font: 'Inter', size: 40, color: '#FFFFFF', align: 'center', y: 0.86, bg: true, animate: 'none' }
        }));
        t += dur + 0.3;
      }
    }
  }

  if (!placed) warnings.push('Nothing was placed — generate shots, video, voice or sound first.');
  for (const t of timeline.tracks) t.clips.sort((a, b) => a.start - b.start);
  timeline.markers.sort((a, b) => a.t - b.t);

  const out = recalc(timeline);
  return applyMode(out, opts.mode ?? 'full', totalDur);
}

/** Post-assembly shaping for the common deliverable variants. */
function applyMode(tl: Timeline, mode: string, totalDur: number): { timeline: Timeline; placed: number; skipped: number; warnings: string[] } {
  const v1 = tl.tracks.filter(t => t.kind === 'video').sort((a, b) => a.index - b.index)[0];
  if (!v1) return { timeline: tl, placed: 0, skipped: 0, warnings: [] };
  if (mode === 'full') return { timeline: tl, placed: v1.clips.length, skipped: 0, warnings: [] };

  if (mode === 'trailer' || mode === 'short30' || mode === 'social') {
    const target = mode === 'trailer' ? Math.min(75, totalDur) : mode === 'short30' ? 30 : 45;
    const keep = v1.clips.length ? Math.max(3, Math.min(v1.clips.length, Math.round(target / 3.2))) : 0;
    // pick the most "informative" shots: prefer variety of size, keep the last one
    const scored = v1.clips.map((c, i) => ({
      c, i,
      score: (c.name.includes('Close') ? 1.4 : 1) * (i === v1.clips.length - 1 ? 2 : 1) * (0.6 + (i % 3) * 0.3) + Math.min(1.5, c.duration / 4)
    })).sort((a, b) => b.score - a.score).slice(0, keep).sort((a, b) => a.i - b.i).map(x => x.c);

    let t = 0;
    for (const c of scored) {
      c.start = t; c.duration = Math.max(0.9, Math.min(c.duration, 3.6)); c.out = c.in + c.duration;
      c.transitionOut = mode === 'trailer' ? 'dip-black' : 'cut';
      c.transitionDur = 0.28;
      t += c.duration;
    }
    const removed = new Set(v1.clips.filter(c => !scored.includes(c)).map(c => c.id));
    for (const tr of tl.tracks) tr.clips = tr.clips.filter(c => !removed.has(c.id) || tr.kind !== 'video');
    // compress audio to match
    for (const tr of tl.tracks) if (tr.kind === 'audio') for (const c of tr.clips) { if (c.start > t) { c.start = Math.max(0, c.start * (t / Math.max(1, totalDur))); } c.duration = Math.min(c.duration, Math.max(0.4, t - c.start)); }
    tl.markers = [];
    return { timeline: recalc(tl), placed: scored.length, skipped: removed.size, warnings: [`Cut to ${mode === 'trailer' ? 'a trailer' : mode === 'short30' ? '30 seconds' : 'a social version'} — ${removed.size} shot(s) held out. They are still in the asset library and can be restored from a version.`] };
  }
  return { timeline: tl, placed: v1.clips.length, skipped: 0, warnings: [] };
}

/** A blank-but-sensible starting timeline for "New Video" projects. */
export function editorStarterNotes(): string[] {
  return [
    'Drop media from the left panel onto a track, or press A to add the selected asset at the playhead.',
    'S splits at the playhead · I/O mark in/out · Delete removes · Shift+Delete ripple-deletes.',
    'Everything you generate in the AI stages lands in this project\'s asset library automatically.'
  ];
}
