'use client';
import { TimelineRenderer } from './renderer';
import type { Clip, Timeline } from '@/types';

/**
 * In-browser export renderer.
 *
 * Runs the exact same compositor and colour pipeline as the program monitor,
 * in real time, into a MediaRecorder. Audio is scheduled on an
 * AudioContext and routed to a MediaStreamDestination so the muxed file has
 * the real mix — dialogue, ambience, foley and score with their fades, pans
 * and clip volumes intact.
 *
 * This is why the app still produces a genuine deliverable on a machine with
 * no ffmpeg: it is a real render, not a screenshot.
 */

export interface RenderOptions {
  mimeType?: string;
  videoBitsPerSecond?: number;
  audioBitsPerSecond?: number;
  scale?: number;                 // 1 = timeline resolution, 0.5 = draft
  fps?: number;
  range?: [number, number] | null;
  onProgress?: (p: number, stage: string) => void;
  signal?: AbortSignal;
  includeAudio?: boolean;
}

export interface RenderResult { blob: Blob; mime: string; durationSec: number; width: number; height: number }

export function supportedMimeTypes(): { mime: string; label: string; ext: string }[] {
  if (typeof MediaRecorder === 'undefined') return [];
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', label: 'MP4 (H.264 + AAC)', ext: 'mp4' },
    { mime: 'video/mp4', label: 'MP4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9,opus', label: 'WebM (VP9 + Opus)', ext: 'webm' },
    { mime: 'video/webm;codecs=vp8,opus', label: 'WebM (VP8 + Opus)', ext: 'webm' },
    { mime: 'video/webm', label: 'WebM', ext: 'webm' }
  ];
  return candidates.filter(c => { try { return MediaRecorder.isTypeSupported(c.mime); } catch { return false; } });
}

export async function renderTimeline(
  tl: Timeline,
  resolveUrl: (assetId: string | null) => string | null,
  resolveMeta: (assetId: string | null) => Record<string, unknown>,
  opts: RenderOptions = {}
): Promise<RenderResult> {
  const scale = opts.scale ?? 1;
  const width = Math.max(2, Math.round(tl.width * scale / 2) * 2);
  const height = Math.max(2, Math.round(tl.height * scale / 2) * 2);
  const fps = opts.fps ?? tl.fps;
  const [from, to] = opts.range ?? [0, tl.durationSec];
  const duration = Math.max(0.2, to - from);

  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const renderer = new TimelineRenderer({ canvas });
  renderer.setResolvers(resolveUrl, resolveMeta);
  renderer.setTimeline(tl);
  renderer.resize(width, height);
  renderer.overlays.safeAreas = false;

  // ── video stream ──────────────────────────────────────────
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const requestFrame = (track as unknown as { requestFrame?: () => void }).requestFrame?.bind(track);

  // ── audio graph ───────────────────────────────────────────
  let ac: AudioContext | null = null;
  let dest: MediaStreamAudioDestinationNode | null = null;
  const sources: AudioBufferSourceNode[] = [];
  if (opts.includeAudio !== false) {
    try {
      ac = new AudioContext();
      dest = ac.createMediaStreamDestination();
      const master = ac.createGain();
      master.gain.value = 1;
      master.connect(dest);
      for (const t of stream.getAudioTracks()) stream.removeTrack(t);
      dest.stream.getAudioTracks().forEach(t => stream.addTrack(t));

      const cache = new Map<string, AudioBuffer | null>();
      const audioClips: { clip: Clip; track: Timeline['tracks'][number] }[] = [];
      const anySolo = tl.tracks.some(t => t.kind === 'audio' && t.solo);
      for (const tr of tl.tracks) {
        if (tr.kind !== 'audio' || tr.muted || tr.hidden) continue;
        if (anySolo && !tr.solo) continue;
        for (const c of tr.clips) if (!c.muted && c.kind !== 'text') audioClips.push({ clip: c, track: tr });
      }
      await Promise.all(audioClips.map(async ({ clip }) => {
        const key = clip.assetId ?? clip.srcUrl ?? clip.id;
        if (cache.has(key)) return;
        const url = clip.srcUrl ?? resolveUrl(clip.assetId);
        if (!url) { cache.set(key, null); return; }
        try {
          const res = await fetch(url);
          const buf = await res.arrayBuffer();
          cache.set(key, await ac!.decodeAudioData(buf));
        } catch { cache.set(key, null); }
      }));
      // schedule everything up front relative to the render clock
      const t0 = ac.currentTime + 0.08;
      for (const { clip, track: tr } of audioClips) {
        const buf = cache.get(clip.assetId ?? clip.srcUrl ?? clip.id);
        if (!buf) continue;
        const end = clip.start + clip.duration;
        if (end <= from || clip.start >= to) continue;
        const when = t0 + Math.max(0, (clip.start - from));
        const offset = clip.start < from ? clip.in / Math.max(0.01, clip.speed) + (from - clip.start) : clip.in / Math.max(0.01, clip.speed);
        if (offset >= buf.duration) continue;
        const dur = Math.min((Math.min(end, to) - Math.max(clip.start, from)) , buf.duration - offset);
        if (dur <= 0.02) continue;
        const src = ac.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = Math.max(0.05, Math.min(8, clip.speed || 1));
        const gain = ac.createGain();
        const vol = Math.max(0, Math.min(2, clip.volume * tr.volume));
        gain.gain.setValueAtTime(vol, when);
        if (clip.fadeIn > 0) { gain.gain.setValueAtTime(0.0001, when); gain.gain.linearRampToValueAtTime(vol, when + clip.fadeIn); }
        if (clip.fadeOut > 0) { const fo = when + Math.max(0, dur - clip.fadeOut); gain.gain.setValueAtTime(vol, fo); gain.gain.linearRampToValueAtTime(0.0001, when + dur); }
        let node: AudioNode = gain;
        const p = Math.max(-1, Math.min(1, (clip.pan ?? 0) + (tr.pan ?? 0)));
        if (p !== 0 && ac.createStereoPanner) { const pan = ac.createStereoPanner(); pan.pan.value = p; gain.connect(pan); node = pan; }
        node.connect(master);
        src.connect(gain);
        try { src.start(when, offset, dur); } catch { continue; }
        sources.push(src);
      }
    } catch {
      ac = null; dest = null;   // video-only export is still a valid deliverable
    }
  }

  // ── recorder ──────────────────────────────────────────────
  const types = supportedMimeTypes();
  const mime = opts.mimeType ?? types[0]?.mime ?? 'video/webm';
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder unavailable). Use the server-side ffmpeg export instead.');
  const recorder = new MediaRecorder(stream, {
    mimeType: MediaRecorder.isTypeSupported(mime) ? mime : undefined,
    videoBitsPerSecond: opts.videoBitsPerSecond ?? 12_000_000,
    audioBitsPerSecond: opts.audioBitsPerSecond ?? 192_000
  });
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>(res => { recorder.onstop = () => res(); });

  const started = performance.now();
  recorder.start(250);
  opts.onProgress?.(0.02, 'starting recorder');

  // ── frame loop, paced to real time so audio stays in sync ──
  for (let t = 0; t <= duration; t += 1 / fps) {
    if (opts.signal?.aborted) break;
    const target = started + t * 1000;
    const wait = target - performance.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    await renderer.render(from + t);
    requestFrame?.();
    opts.onProgress?.(0.02 + (t / duration) * 0.95, `rendering ${(from + t).toFixed(1)}s / ${to.toFixed(1)}s`);
  }
  // hold the final frame briefly so the tail is not dropped
  await new Promise(r => setTimeout(r, 260));
  requestFrame?.();

  if (recorder.state !== 'inactive') recorder.stop();
  await done;
  for (const s of sources) { try { s.stop(); } catch { /* already stopped */ } }
  await ac?.close().catch(() => {});
  renderer.destroy();
  track.stop();

  const blob = new Blob(chunks, { type: recorder.mimeType || mime });
  opts.onProgress?.(1, 'done');
  if (!blob.size) throw new Error('The recorder produced an empty file — this usually means the browser blocked canvas capture or no media was in range.');
  return { blob, mime: recorder.mimeType || mime, durationSec: duration, width, height };
}

export function qualityToBitrate(quality: 'draft' | 'high' | 'master', width: number, height: number, fps: number): number {
  const px = width * height * fps;
  const bpp = quality === 'master' ? 0.20 : quality === 'high' ? 0.11 : 0.05;
  return Math.max(1_500_000, Math.round(px * bpp));
}
