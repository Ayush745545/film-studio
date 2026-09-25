import { SR } from './wav';

/** Minimal PCM WAV reader/mixer — real server-side audio, no ffmpeg required. */
export interface PcmBuffer { channels: Float32Array[]; sampleRate: number; length: number }

export function decodeWav(buf: Uint8Array): PcmBuffer | null {
  if (buf.length < 44) return null;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const riff = String.fromCharCode(...Array.from(buf.slice(0, 4)));
  if (riff !== 'RIFF') return null;
  let offset = 12; let fmt: { channels: number; sampleRate: number; bits: number } | null = null;
  let dataOff = -1; let dataLen = 0;
  while (offset + 8 <= buf.length) {
    const id = String.fromCharCode(...Array.from(buf.slice(offset, offset + 4)));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      const bits = view.getUint16(offset + 8 + 14, true);
      fmt = { channels: view.getUint16(offset + 8 + 2, true), sampleRate: view.getUint32(offset + 8 + 4, true), bits };
    } else if (id === 'data') { dataOff = offset + 8; dataLen = size; break; }
    offset += 8 + size + (size % 2);
  }
  if (!fmt || dataOff < 0) return null;
  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const chans: Float32Array[] = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < fmt.channels; c++) {
      const p = dataOff + (i * fmt.channels + c) * bytesPer;
      if (p + bytesPer > buf.length) break;
      chans[c][i] = fmt.bits === 16 ? view.getInt16(p, true) / 32768
        : fmt.bits === 32 ? view.getInt32(p, true) / 2147483648
        : (view.getUint8(p) - 128) / 128;
    }
  }
  return { channels: chans, sampleRate: fmt.sampleRate, length: frames };
}

export function encodeWavBuffer(chans: Float32Array[], sampleRate = SR): Uint8Array {
  const nCh = Math.max(1, chans.length);
  const len = Math.max(0, ...chans.map(c => c.length));
  const out = new Uint8Array(44 + len * nCh * 2);
  const view = new DataView(out.buffer);
  const wstr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  wstr(0, 'RIFF'); view.setUint32(4, out.length - 8, true); wstr(8, 'WAVE');
  wstr(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, nCh, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * nCh * 2, true); view.setUint16(32, nCh * 2, true); view.setUint16(34, 16, true);
  wstr(36, 'data'); view.setUint32(40, len * nCh * 2, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const raw = chans[c]?.[i] ?? 0;
      const v = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
    }
  }
  return out;
}

export interface MixClip {
  src: PcmBuffer | null;
  start: number; duration: number; inPoint: number; speed: number;
  volume: number; pan: number; fadeIn: number; fadeOut: number; loop: boolean;
}

/** Offline mixdown with fades, speed, pan and looping. Deterministic, no deps. */
export function mixdown(clips: MixClip[], totalSec: number, sampleRate = SR): Float32Array[] {
  const len = Math.max(1, Math.ceil(totalSec * sampleRate));
  const L = new Float32Array(len), R = new Float32Array(len);
  for (const c of clips) {
    if (!c.src || c.volume === 0 || c.duration <= 0) continue;
    const startSample = Math.floor(c.start * sampleRate);
    const durSamples = Math.floor(c.duration * sampleRate);
    const fadeIns = Math.floor((c.fadeIn ?? 0) * sampleRate);
    const fadeOuts = Math.floor((c.fadeOut ?? 0) * sampleRate);
    const srcLen = c.src.length;
    const panL = Math.cos(((c.pan ?? 0) + 1) * Math.PI / 4);
    const panR = Math.sin(((c.pan ?? 0) + 1) * Math.PI / 4);
    for (let i = 0; i < durSamples; i++) {
      const out = startSample + i;
      if (out >= len) break;
      let srcPos = c.inPoint * sampleRate + i * (c.speed || 1);
      if (c.loop && srcLen > 0) srcPos = srcPos % srcLen;
      const s0 = Math.floor(srcPos);
      if (s0 >= srcLen) continue;
      const frac = srcPos - s0;
      let g = c.volume;
      if (fadeIns > 0 && i < fadeIns) g *= i / fadeIns;
      if (fadeOuts > 0 && i > durSamples - fadeOuts) g *= Math.max(0, (durSamples - i) / fadeOuts);
      for (let ch = 0; ch < Math.min(2, c.src.channels.length); ch++) {
        const a = c.src.channels[ch][s0] ?? 0;
        const b = c.src.channels[ch][Math.min(srcLen - 1, s0 + 1)] ?? a;
        const v = (a + (b - a) * frac) * g;
        if (ch === 0) { L[out] += v * (c.src.channels.length > 1 ? panL : 1); R[out] += v * (c.src.channels.length > 1 ? panR : 1); }
        else { L[out] += v * panL; R[out] += v * panR; }
      }
      if (c.src.channels.length === 1) { const v = ((c.src.channels[0][s0] ?? 0)) * g; L[out] += v * (panL - 1); R[out] += v * (panR - 1); }
    }
  }
  // soft limiter
  for (let i = 0; i < len; i++) { L[i] = Math.tanh(L[i] * 0.92); R[i] = Math.tanh(R[i] * 0.92); }
  return [L, R];
}

export function peaks(pcm: Float32Array, buckets = 200): number[] {
  const out: number[] = [];
  const per = Math.max(1, Math.floor(pcm.length / buckets));
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    for (let i = b * per; i < Math.min(pcm.length, (b + 1) * per); i++) m = Math.max(m, Math.abs(pcm[i]));
    out.push(Number(m.toFixed(4)));
  }
  return out;
}
