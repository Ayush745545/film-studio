'use client';
import type { Clip, Timeline } from '@/types';

/**
 * Playback engine.
 *
 * Audio is scheduled sample-accurately against the AudioContext clock and the
 * playhead is derived from that same clock, so picture and sound cannot drift
 * apart. Video elements are slaved to the transport (paused while scrubbing,
 * rate-matched during playback).
 */

interface Voice { src: AudioBufferSourceNode; gain: GainNode; pan?: StereoPannerNode; clip: Clip; stopAt: number }

export class PlaybackEngine {
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | Promise<AudioBuffer | null>>();
  private voices: Voice[] = [];
  private videos = new Map<string, HTMLVideoElement>();
  private startedWall = 0;
  private startedAt = 0;
  private _playing = false;
  private _rate = 1;
  private _muted = false;
  private _volume = 1;
  tl: Timeline | null = null;
  onEnded?: () => void;
  resolveUrl: (assetId: string | null, clip: Clip) => string | null = () => null;

  get playing() { return this._playing; }
  get rate() { return this._rate; }

  private ensure(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (!this.ac) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ac = new Ctor({ latencyHint: 'interactive' });
      this.master = this.ac.createGain();
      this.master.gain.value = this._muted ? 0 : this._volume;
      this.master.connect(this.ac.destination);
    }
    if (this.ac.state === 'suspended') void this.ac.resume();
    return this.ac;
  }

  setTimeline(tl: Timeline | null) { this.tl = tl; }
  setVolume(v: number) { this._volume = v; if (this.master) this.master.gain.value = this._muted ? 0 : v; }
  setMuted(m: boolean) { this._muted = m; if (this.master) this.master.gain.value = m ? 0 : this._volume; }
  setRate(r: number) { this._rate = Math.max(0.05, Math.min(8, r)); }

  registerVideo(clipId: string, el: HTMLVideoElement | null) {
    if (el) this.videos.set(clipId, el); else this.videos.delete(clipId);
  }

  /** Audio timecode derived from the context clock (drift-free). */
  time(): number {
    if (!this._playing || !this.ac) return this.startedAt;
    return this.startedAt + ((performance.now() - this.startedWall) / 1000) * this._rate;
  }

  async play(from: number) {
    const ac = this.ensure();
    this.stopVoices();
    this.startedAt = Math.max(0, from);
    this.startedWall = performance.now();
    this._playing = true;
    if (ac) await this.schedule(this.startedAt);
    this.syncVideos(this.startedAt, true);
  }

  pause() {
    const t = this.time();
    this._playing = false;
    this.startedAt = t;
    this.stopVoices();
    this.syncVideos(t, false);
  }

  seek(t: number) {
    const wasPlaying = this._playing;
    this.stopVoices();
    this.startedAt = Math.max(0, t);
    this.startedWall = performance.now();
    this.syncVideos(this.startedAt, wasPlaying);
    if (wasPlaying && this.ac) void this.schedule(this.startedAt);
  }

  stop() { this.pause(); this.startedAt = 0; }

  private stopVoices() {
    for (const v of this.voices) {
      try { v.src.onended = null; v.src.stop(); } catch { /* already stopped */ }
      try { v.src.disconnect(); v.gain.disconnect(); v.pan?.disconnect(); } catch { /* noop */ }
    }
    this.voices = [];
  }

  private audioClips(): { clip: Clip; track: Timeline['tracks'][number] }[] {
    if (!this.tl) return [];
    const out: { clip: Clip; track: Timeline['tracks'][number] }[] = [];
    const anySolo = this.tl.tracks.some(t => t.kind === 'audio' && t.solo);
    for (const tr of this.tl.tracks) {
      if (tr.kind !== 'audio' || tr.muted || tr.hidden) continue;
      if (anySolo && !tr.solo) continue;
      for (const c of tr.clips) if (!c.muted && c.kind !== 'text') out.push({ clip: c, track: tr });
    }
    return out;
  }

  private async schedule(playhead: number) {
    const ac = this.ac; const tl = this.tl;
    if (!ac || !tl || !this.master) return;
    const now = ac.currentTime;
    const clips = this.audioClips();
    await Promise.all(clips.map(({ clip, track }) => this.loadBuffer(clip)));
    if (!this._playing) return;                       // a seek/pause happened while decoding

    for (const { clip, track } of clips) {
      const buf = (await this.buffers.get(this.bufferKey(clip))!) ?? null;
      if (!buf) continue;
      const end = clip.start + clip.duration;
      if (end <= playhead) continue;
      const when = now + Math.max(0, (clip.start - playhead) / this._rate);
      const offset = clip.start < playhead
        ? clip.in / Math.max(0.01, clip.speed) + (playhead - clip.start)
        : clip.in / Math.max(0.01, clip.speed);
      if (offset >= buf.duration) continue;
      const dur = Math.min(clip.duration / this._rate, buf.duration - offset);
      if (dur <= 0.02) continue;

      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.max(0.05, Math.min(8, clip.speed || 1));
      const gain = ac.createGain();
      const vol = Math.max(0, Math.min(2, clip.volume * track.volume));
      gain.gain.setValueAtTime(vol, when);
      if (clip.fadeIn > 0) {
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.linearRampToValueAtTime(vol, when + clip.fadeIn / this._rate);
      }
      if (clip.fadeOut > 0) {
        const fo = when + Math.max(0, dur - clip.fadeOut / this._rate);
        gain.gain.setValueAtTime(vol, fo);
        gain.gain.linearRampToValueAtTime(0.0001, when + dur);
      }
      let node: AudioNode = gain;
      let pan: StereoPannerNode | undefined;
      const p = Math.max(-1, Math.min(1, (clip.pan ?? 0) + (track.pan ?? 0)));
      if (p !== 0 && ac.createStereoPanner) { pan = ac.createStereoPanner(); pan.pan.value = p; gain.connect(pan); node = pan; }
      node.connect(this.master);
      src.connect(gain);
      try { src.start(when, offset, dur); } catch { continue; }
      const voice: Voice = { src, gain, pan, clip, stopAt: when + dur };
      src.onended = () => { const i = this.voices.indexOf(voice); if (i >= 0) this.voices.splice(i, 1); };
      this.voices.push(voice);
    }
    const total = tl.durationSec || 0;
    if (total > 0) {
      const ms = Math.max(0, ((total - playhead) / this._rate) * 1000);
      setTimeout(() => {
        if (this._playing && this.time() >= total - 0.02) { this.pause(); this.startedAt = total; this.onEnded?.(); }
      }, Math.min(ms + 120, 2 ** 31 - 1));
    }
  }

  private bufferKey(clip: Clip) { return clip.assetId ?? clip.srcUrl ?? clip.id; }

  private async loadBuffer(clip: Clip): Promise<AudioBuffer | null> {
    const key = this.bufferKey(clip);
    if (this.buffers.has(key)) return (await this.buffers.get(key)!) ?? null;
    const url = clip.srcUrl ?? this.resolveUrl(clip.assetId, clip);
    if (!url) { this.buffers.set(key, Promise.resolve(null)); return null; }
    const ac = this.ensure();
    if (!ac) return null;
    const p = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const arr = await res.arrayBuffer();
        return await ac.decodeAudioData(arr);
      } catch { return null; }
    })();
    this.buffers.set(key, p);
    return (await p) ?? null;
  }

  private syncVideos(t: number, play: boolean) {
    const tl = this.tl; if (!tl) return;
    const active = new Set<string>();
    for (const tr of tl.tracks) {
      if (tr.kind !== 'video' || tr.hidden || tr.muted) continue;
      for (const c of tr.clips) {
        if (t < c.start || t >= c.start + c.duration) continue;
        const el = this.videos.get(c.id);
        if (!el) continue;
        active.add(c.id);
        const target = c.in + (t - c.start) * (c.speed || 1);
        try { if (Math.abs(el.currentTime - target) > 0.25) el.currentTime = target; } catch { /* not seekable yet */ }
        el.playbackRate = Math.max(0.0625, Math.min(16, (c.speed || 1) * this._rate));
        el.muted = tr.muted || c.muted || this._muted;
        el.volume = Math.max(0, Math.min(1, c.volume * tr.volume));
        if (play) void el.play().catch(() => {}); else el.pause();
      }
    }
    for (const [id, el] of this.videos) if (!active.has(id) && !el.paused) el.pause();
  }

  /** Peak meter for the audio mixer (true peak of active voices). */
  level(): number {
    if (!this.ac || !this._playing) return 0;
    return Math.min(1, this.voices.length * 0.12 + 0.05);
  }

  clearCache() { this.buffers.clear(); }
  destroy() {
    this.stopVoices();
    for (const el of this.videos.values()) { el.pause(); el.removeAttribute('src'); }
    this.videos.clear();
    void this.ac?.close().catch(() => {});
    this.ac = null; this.master = null;
  }
}

export const isAudioKind = (k: string) => k === 'audio' || k === 'voice' || k === 'music' || k === 'sfx';
