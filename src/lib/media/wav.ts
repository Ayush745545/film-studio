import { rng, hashSeed } from '../ids';

/**
 * Real audio DSP — no external binaries, no pretend files.
 *
 * Demo Mode synthesises genuine 16-bit PCM WAV audio: rain beds, room tone,
 * footsteps, door servos, impacts, whooshes, an additive-synthesis score and
 * clearly-labelled scratch dialogue tracks. These are usable stand-ins for
 * timing an edit and they play back anywhere.
 */

export const SR = 44100;

/* ── primitives ───────────────────────────────────────────── */
export function encodeWav(chans: Float32Array[], sampleRate = SR): Buffer {
  const nCh = Math.max(1, chans.length);
  const len = Math.max(...chans.map(c => c.length), 1);
  const bytes = 44 + len * nCh * 2;
  const buf = Buffer.alloc(bytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(bytes - 8, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(nCh, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * nCh * 2, 28); buf.writeUInt16LE(nCh * 2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(len * nCh * 2, 40);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const raw = chans[c]?.[i] ?? 0;
      const v = Number.isFinite(raw) ? Math.max(-1, Math.min(1, raw)) : 0;
      buf.writeInt16LE(v < 0 ? v * 0x8000 : v * 0x7FFF, o); o += 2;
    }
  }
  return buf;
}

const buf = (sec: number) => new Float32Array(Math.max(1, Math.floor(sec * SR)));

/** Biquad — Robert Bristow-Johnson cookbook. */
function biquad(src: Float32Array, type: 'lowpass' | 'highpass' | 'bandpass' | 'peaking', f0: number, q = 0.9, gainDb = 0): Float32Array {
  const w0 = 2 * Math.PI * Math.min(f0, SR / 2 - 50) / SR;
  const cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * q);
  const A = Math.pow(10, gainDb / 40);
  let b0 = 0, b1 = 0, b2 = 0, a0 = 0, a1 = 0, a2 = 0;
  switch (type) {
    case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
    case 'peaking': b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; break;
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
  const out = new Float32Array(src.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < src.length; i++) {
    const x0 = src[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    out[i] = y0;
  }
  return out;
}

function noise(n: number, r: () => number): Float32Array {
  const o = buf(n);
  for (let i = 0; i < o.length; i++) o[i] = r() * 2 - 1;
  return o;
}
/** 1/f pink-ish noise via Voss-McCartney approximation. */
function pink(n: number, r: () => number): Float32Array {
  const o = buf(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < o.length; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520; b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.0168980;
    o[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return o;
}
function env(o: Float32Array, attack = 0.01, release = 0.2, peak = 1): Float32Array {
  const a = Math.floor(attack * SR), r = Math.floor(release * SR);
  for (let i = 0; i < o.length; i++) {
    let g = peak;
    if (i < a) g *= i / Math.max(1, a);
    if (i > o.length - r) g *= Math.max(0, (o.length - i) / Math.max(1, r));
    o[i] *= g;
  }
  return o;
}
function addInto(dst: Float32Array, src: Float32Array, atSec: number, gain = 1) {
  const s = Math.floor(atSec * SR);
  for (let i = 0; i < src.length; i++) { const j = s + i; if (j >= 0 && j < dst.length) dst[j] += src[i] * gain; }
}
function normalize(o: Float32Array, peak = 0.89): Float32Array {
  let m = 0;
  for (let i = 0; i < o.length; i++) {
    const v = o[i];
    if (!Number.isFinite(v)) { o[i] = 0; continue; }
    const a = v < 0 ? -v : v;
    if (a > m) m = a;
  }
  if (!(m > 1e-6)) return o;
  const g = peak / m; for (let i = 0; i < o.length; i++) o[i] *= g;
  return o;
}
/** Read a possibly-shorter source safely (avoids NaN from undefined samples). */
const at = (a: Float32Array, i: number) => (i < a.length ? a[i] : 0);
/** Simple stereo widening reverb: comb + allpass network. */
function reverb(input: Float32Array, amount = 0.3, size = 0.6): [Float32Array, Float32Array] {
  const delays = [0.0297, 0.0371, 0.0411, 0.0437].map(d => Math.floor(d * SR * (0.6 + size)));
  const tails = delays.map(d => new Float32Array(input.length + d * 6));
  for (let i = 0; i < input.length; i++) for (let k = 0; k < delays.length; k++) {
    const d = delays[k];
    tails[k][i] += input[i];
    if (i + d < tails[k].length) tails[k][i + d] += tails[k][i] * 0.72;
  }
  const L = new Float32Array(input.length), R = new Float32Array(input.length);
  for (let k = 0; k < tails.length; k++) {
    const g = amount / tails.length / (k % 2 ? 3.1 : 2.7);
    for (let i = 0; i < input.length; i++) { L[i] += tails[k][i] * g; R[i] += tails[k][i] * g * (k % 2 ? 1.15 : 0.87); }
  }
  for (let i = 0; i < input.length; i++) { L[i] += input[i]; R[i] += input[i]; }
  return [L, R];
}
function tone(freq: number, dur: number, type: 'sine' | 'tri' | 'saw' = 'sine', detune = 0): Float32Array {
  const o = buf(dur);
  for (let i = 0; i < o.length; i++) {
    const t = i / SR, ph = 2 * Math.PI * freq * t;
    const a = Math.sin(ph), b = Math.sin(ph * (1 + detune));
    o[i] = type === 'sine' ? (a + b) / 2 : type === 'tri' ? (Math.asin(a) + Math.asin(b)) / Math.PI : (((ph / Math.PI) % 2) - 1 + ((ph * (1 + detune) / Math.PI) % 2) - 1) / 2;
  }
  return o;
}

/* ── generators ───────────────────────────────────────────── */
export type SoundPreset =
  | 'rain' | 'storm' | 'wind' | 'city-traffic' | 'room-tone' | 'forest' | 'ocean' | 'crowd'
  | 'footsteps' | 'door' | 'impact' | 'whoosh' | 'riser' | 'server-hum' | 'fire' | 'clock'
  | 'score-tension' | 'score-warm' | 'score-epic' | 'score-melancholy' | 'score-drive'
  | 'scratch-voice' | 'ui-click' | 'heartbeat';

export interface SynthOpts { seed?: number; intensity?: number; bpm?: number; pitch?: number; words?: string[] }

export function synth(preset: SoundPreset, durSec: number, opts: SynthOpts = {}): Buffer {
  const r = rng(opts.seed ?? hashSeed(preset + durSec));
  const dur = Math.max(0.4, Math.min(180, durSec));
  const k = opts.intensity ?? 1;
  const out = buf(dur);
  const outR = buf(dur);

  switch (preset) {
    case 'rain': case 'storm': {
      const n = pink(dur, r);
      const hp = biquad(n, 'highpass', preset === 'storm' ? 500 : 900, 0.7);
      const lp = biquad(hp, 'lowpass', preset === 'storm' ? 7200 : 5200, 0.8);
      for (let i = 0; i < lp.length; i++) { out[i] = lp[i] * 0.5 * k; outR[i] = lp[i] * 0.46 * k; }
      // droplet transients
      const drops = Math.floor(dur * (preset === 'storm' ? 60 : 34));
      for (let d = 0; d < drops; d++) {
        const t = r() * dur, f = 1200 + r() * 3600, l = 0.008 + r() * 0.02;
        const click = env(biquad(tone(f, l, 'sine'), 'bandpass', f, 4), 0.001, l);
        addInto(out, click, t, 0.05 * k); addInto(outR, click, t + 0.001, 0.045 * k);
      }
      if (preset === 'storm') {
        for (let s = 0; s < Math.max(1, Math.floor(dur / 9)); s++) {
          const t = 1 + r() * (dur - 2), boom = env(biquad(noise(1.8, r), 'lowpass', 120, 1.2), 0.02, 1.6);
          addInto(out, boom, t, 0.5 * k); addInto(outR, boom, t + 0.02, 0.48 * k);
        }
      }
      break;
    }
    case 'wind': {
      const n = pink(dur, r);
      const bp = biquad(n, 'bandpass', 420, 0.6);
      for (let i = 0; i < bp.length; i++) {
        const lfo = 0.45 + 0.55 * Math.sin(2 * Math.PI * (0.09 + r() * 0.0001) * (i / SR) + i * 0.00001);
        out[i] = bp[i] * lfo * 0.8 * k; outR[i] = bp[i] * (lfo * 0.86) * k;
      }
      break;
    }
    case 'city-traffic': {
      const n = pink(dur, r);
      const lp = biquad(n, 'lowpass', 700, 0.9);
      for (let i = 0; i < lp.length; i++) { out[i] = lp[i] * 0.34 * k; outR[i] = lp[i] * 0.32 * k; }
      for (let c = 0; c < Math.floor(dur / 3.2); c++) {
        const t = r() * dur, pass = env(biquad(noise(2.6, r), 'bandpass', 300 + r() * 700, 1.4), 0.7, 1.1);
        addInto(out, pass, t, 0.16 * k); addInto(outR, pass, t + 0.09, 0.16 * k);
      }
      break;
    }
    case 'room-tone': case 'server-hum': {
      const base = preset === 'server-hum' ? 118 : 62;
      const h1 = tone(base, dur, 'sine'), h2 = tone(base * 2.01, dur, 'sine'), h3 = tone(base * 3.02, dur, 'sine');
      const n = biquad(pink(dur, r), 'lowpass', preset === 'server-hum' ? 2400 : 420, 0.7);
      for (let i = 0; i < out.length; i++) {
        const f = 0.86 + 0.14 * Math.sin(2 * Math.PI * 0.23 * (i / SR));
        out[i] = (h1[i] * 0.24 + h2[i] * 0.1 + h3[i] * 0.05 + n[i] * (preset === 'server-hum' ? 0.16 : 0.1)) * f * k;
        outR[i] = (h1[i] * 0.23 + h2[i] * 0.1 + h3[i] * 0.05 + n[i] * (preset === 'server-hum' ? 0.16 : 0.1)) * f * k;
      }
      if (preset === 'server-hum') for (let b = 0; b < dur * 1.4; b++) {
        const t = r() * dur, blip = env(tone(1800 + r() * 1600, 0.03, 'sine'), 0.002, 0.03);
        addInto(out, blip, t, 0.05 * k); addInto(outR, blip, t, 0.04 * k);
      }
      break;
    }
    case 'forest': {
      const n = biquad(pink(dur, r), 'bandpass', 2600, 0.5);
      for (let i = 0; i < n.length; i++) { out[i] = n[i] * 0.09 * k; outR[i] = n[i] * 0.085 * k; }
      for (let b = 0; b < dur * 2.2; b++) {
        const t = r() * dur, f = 2200 + r() * 2600;
        const chirp = env(biquad(tone(f, 0.09, 'sine'), 'bandpass', f, 8), 0.01, 0.07);
        addInto(out, chirp, t, 0.06 * k); addInto(outR, chirp, t + 0.006, 0.06 * k);
      }
      break;
    }
    case 'ocean': {
      const n = biquad(pink(dur, r), 'lowpass', 900, 0.8);
      for (let i = 0; i < n.length; i++) {
        const wave = Math.max(0, Math.sin(2 * Math.PI * (i / SR) / 7.5)) ** 2;
        out[i] = n[i] * (0.16 + wave * 0.6) * k; outR[i] = n[i] * (0.15 + wave * 0.56) * k;
      }
      break;
    }
    case 'crowd': {
      const bed = biquad(pink(dur, r), 'bandpass', 700, 0.4);
      for (let i = 0; i < bed.length; i++) { out[i] = bed[i] * 0.2 * k; outR[i] = bed[i] * 0.19 * k; }
      for (let v = 0; v < dur * 3; v++) {
        const t = r() * dur, f = 180 + r() * 260, l = 0.18 + r() * 0.5;
        const voice = env(biquad(tone(f, l, 'tri'), 'bandpass', f * 3, 1.6), 0.05, l * 0.6);
        addInto(out, voice, t, 0.05 * k); addInto(outR, voice, t + 0.02, 0.05 * k);
      }
      break;
    }
    case 'footsteps': {
      const steps = Math.max(2, Math.floor(dur / 0.52));
      for (let s = 0; s < steps; s++) {
        const t = s * (dur / steps) + r() * 0.03;
        const thud = env(biquad(noise(0.14, r), 'lowpass', 260 + r() * 160, 1.4), 0.002, 0.1);
        const scuff = env(biquad(noise(0.09, r), 'highpass', 2200, 0.8), 0.004, 0.07);
        const pan = s % 2 ? 0.75 : 1;
        addInto(out, thud, t, 0.5 * k * pan); addInto(outR, thud, t, 0.5 * k * (1.6 - pan));
        addInto(out, scuff, t + 0.01, 0.22 * k * pan); addInto(outR, scuff, t + 0.01, 0.22 * k * (1.6 - pan));
      }
      break;
    }
    case 'door': {
      const creak = buf(dur);
      for (let i = 0; i < creak.length; i++) {
        const t = i / SR, f = 320 + Math.sin(t * 7) * 90 + t * 140;
        creak[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + (r() * 2 - 1) * 0.16) * Math.exp(-t * 1.1);
      }
      const bp = env(biquad(creak, 'bandpass', 900, 3), 0.03, dur * 0.7);
      for (let i = 0; i < bp.length; i++) { out[i] = bp[i] * 0.34 * k; outR[i] = bp[i] * 0.3 * k; }
      const slam = env(biquad(noise(0.24, r), 'lowpass', 340, 1.2), 0.002, 0.2);
      addInto(out, slam, Math.max(0, dur * 0.62), 0.7 * k); addInto(outR, slam, Math.max(0, dur * 0.63), 0.66 * k);
      break;
    }
    case 'impact': {
      const boom = env(biquad(noise(0.9, r), 'lowpass', 150, 1.4), 0.002, 0.85);
      const crack = env(biquad(noise(0.08, r), 'highpass', 2600, 0.9), 0.001, 0.06);
      const sub = env(tone(48, 0.7, 'sine'), 0.004, 0.6);
      for (let i = 0; i < out.length; i++) {
        const b = at(boom, i), c = at(crack, i), s = at(sub, i);
        out[i] = (b * 0.5 + c * 0.22 + s * 0.5) * k;
        outR[i] = (b * 0.48 + c * 0.2 + s * 0.5) * k;
      }
      break;
    }
    case 'whoosh': {
      const n = noise(dur, r);
      const bp = biquad(n, 'bandpass', 800, 0.7);
      for (let i = 0; i < bp.length; i++) {
        const p = i / bp.length;
        const f = Math.sin(Math.PI * p) ** 1.6;
        out[i] = bp[i] * f * 0.7 * k * (1 - p * 0.3);
        outR[i] = bp[i] * f * 0.7 * k * (0.4 + p * 0.6);
      }
      break;
    }
    case 'riser': {
      for (let i = 0; i < out.length; i++) {
        const p = i / out.length;
        const f = 120 * Math.pow(14, p);
        out[i] = (Math.sin(2 * Math.PI * f * (i / SR)) * 0.3 + (r() * 2 - 1) * 0.14 * p) * p * k;
        outR[i] = out[i] * 0.96;
      }
      break;
    }
    case 'fire': {
      const bed = biquad(pink(dur, r), 'bandpass', 900, 0.5);
      for (let i = 0; i < bed.length; i++) { out[i] = bed[i] * 0.22 * k; outR[i] = bed[i] * 0.2 * k; }
      for (let c = 0; c < dur * 22; c++) {
        const t = r() * dur, crack = env(biquad(noise(0.03, r), 'highpass', 1800, 0.9), 0.001, 0.03);
        addInto(out, crack, t, 0.16 * k * (r() > 0.5 ? 1 : 0.4)); addInto(outR, crack, t, 0.16 * k * (r() > 0.5 ? 0.4 : 1));
      }
      break;
    }
    case 'clock': {
      for (let s = 0; s < Math.floor(dur * 2); s++) {
        const t = s * 0.5, tick = env(biquad(noise(0.03, r), 'bandpass', s % 2 ? 2600 : 1500, 6), 0.001, 0.025);
        addInto(out, tick, t, 0.4 * k); addInto(outR, tick, t, 0.34 * k);
      }
      break;
    }
    case 'heartbeat': {
      for (let b = 0; b < Math.floor(dur / 0.85); b++) {
        const t = b * 0.85;
        for (const [off, g] of [[0, 0.9], [0.24, 0.55]] as const) {
          const thump = env(biquad(tone(52, 0.2, 'sine'), 'lowpass', 90, 1.2), 0.006, 0.18);
          addInto(out, thump, t + off, g * k); addInto(outR, thump, t + off, g * k);
        }
      }
      break;
    }
    case 'ui-click': {
      const c = env(biquad(tone(1500, 0.05, 'sine'), 'bandpass', 1500, 3), 0.001, 0.045);
      for (let i = 0; i < out.length; i++) { const v = at(c, i) * 0.4 * k; out[i] = v; outR[i] = v; }
      break;
    }
    case 'scratch-voice': {
      // Clearly a scratch/placeholder track: syllable-timed formant buzz, not speech.
      const words = opts.words?.length ? opts.words : ['placeholder', 'scratch', 'track'];
      const baseF = 108 * (opts.pitch ?? 1);
      let t = 0.06;
      for (const w of words) {
        const syl = Math.max(1, Math.ceil(w.length / 2.4));
        for (let s = 0; s < syl && t < dur - 0.2; s++) {
          const len = 0.075 + r() * 0.05;
          const f = baseF * (0.9 + r() * 0.28);
          const seg = buf(len);
          for (let i = 0; i < seg.length; i++) {
            const ph = 2 * Math.PI * f * (i / SR);
            const buzz = (Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.28 + Math.sin(ph * 3) * 0.14);
            const formant = Math.sin(2 * Math.PI * f * 6.2 * (i / SR)) * 0.35;
            seg[i] = (buzz + formant + (r() * 2 - 1) * 0.05);
          }
          const shaped = env(biquad(seg, 'bandpass', f * 5, 1.2), 0.012, len * 0.5);
          addInto(out, shaped, t, 0.3 * k); addInto(outR, shaped, t, 0.28 * k);
          t += len + 0.028;
        }
        t += 0.12 + r() * 0.1;
      }
      break;
    }
    default: {
      const mood = preset.replace('score-', '') as 'tension' | 'warm' | 'epic' | 'melancholy' | 'drive';
      const chords = CHORDS[mood] ?? CHORDS.warm;
      const bpm = opts.bpm ?? (mood === 'drive' ? 122 : mood === 'epic' ? 92 : 68);
      const beat = 60 / bpm;
      const barLen = beat * 4;
      for (let bar = 0, t = 0; t < dur; bar++, t += barLen) {
        const ch = chords[bar % chords.length];
        // sustained pad — additive saw with slow attack
        for (const f of ch) {
          for (const det of [1, 1.004, 0.9965]) {
            const len = Math.min(barLen * 1.15, dur - t);
            if (len <= 0.05) continue;
            const seg = buf(len);
            for (let i = 0; i < seg.length; i++) {
              const ph = 2 * Math.PI * f * det * (i / SR);
              seg[i] = Math.sin(ph) * 0.6 + Math.sin(ph * 2) * 0.18 + Math.sin(ph * 3) * 0.07 + Math.sin(ph * 4) * 0.03;
            }
            const shaped = env(seg, Math.min(1.1, barLen * 0.4), Math.min(1.2, barLen * 0.5), 0.1 / ch.length);
            addInto(out, shaped, t, 1); addInto(outR, shaped, t + 0.012, 1);
          }
        }
        // bass
        const bassF = ch[0] / 2;
        const bass = env(biquad(tone(bassF, Math.min(barLen * 0.9, dur - t), 'tri'), 'lowpass', 260, 1), 0.04, 0.5, 0.2);
        addInto(out, bass, t, 1); addInto(outR, bass, t, 1);
        // pulse / arp
        const steps = mood === 'drive' ? 8 : mood === 'epic' ? 4 : 2;
        for (let s = 0; s < steps; s++) {
          const st = t + (barLen / steps) * s;
          if (st > dur - 0.1) break;
          const note = ch[(s + bar) % ch.length] * (mood === 'tension' ? 2 : s % 2 ? 2 : 1);
          const pl = env(biquad(tone(note, 0.4, 'tri'), 'lowpass', mood === 'warm' ? 1400 : 2600, 1.1), 0.004, 0.34, mood === 'tension' ? 0.05 : 0.075);
          addInto(out, pl, st, s % 2 ? 0.7 : 1); addInto(outR, pl, st, s % 2 ? 1 : 0.7);
        }
        if (mood === 'epic' && bar % 2 === 0) {
          const hit = env(biquad(noise(0.5, r), 'lowpass', 200, 1.2), 0.002, 0.46);
          addInto(out, hit, t, 0.32 * k); addInto(outR, hit, t, 0.3 * k);
        }
      }
      break;
    }
  }

  const [L, R] = reverb(out, preset.startsWith('score') || preset === 'scratch-voice' ? 0.34 : 0.16, 0.55);
  for (let i = 0; i < R.length; i++) { L[i] += outR[i] * 0.55; R[i] += outR[i] * 0.55; }
  // gentle master curve
  for (const c of [L, R]) { normalize(c, 0.86); for (let i = 0; i < c.length; i++) c[i] = Math.tanh(c[i] * 1.15) * 0.92; }
  // short fades so loops don't click
  const f = Math.floor(0.012 * SR);
  for (let i = 0; i < f; i++) { const g = i / f; L[i] *= g; R[i] *= g; L[L.length - 1 - i] *= g; R[R.length - 1 - i] *= g; }
  return encodeWav([L, R]);
}

const CHORDS: Record<string, number[][]> = {
  tension: [[110, 130.81, 164.81], [116.54, 138.59, 174.61], [103.83, 123.47, 155.56], [110, 130.81, 164.81]],
  warm: [[130.81, 164.81, 196], [174.61, 220, 261.63], [146.83, 174.61, 220], [196, 246.94, 293.66]],
  epic: [[98, 146.83, 196], [110, 164.81, 220], [87.31, 130.81, 174.61], [98, 146.83, 196]],
  melancholy: [[110, 130.81, 164.81], [87.31, 110, 130.81], [98, 116.54, 146.83], [110, 130.81, 164.81]],
  drive: [[82.41, 110, 164.81], [82.41, 110, 164.81], [87.31, 116.54, 174.61], [98, 130.81, 196]]
};
export const CHORD_SETS = Object.keys(CHORDS);

/** Detect a matching preset from a free-text prompt (used by the sound designer). */
export function presetFromPrompt(prompt: string): SoundPreset {
  const t = prompt.toLowerCase();
  const map: [RegExp, SoundPreset][] = [
    [/thunder|storm/, 'storm'], [/rain|drizzle|downpour/, 'rain'], [/wind|breeze|gale/, 'wind'],
    [/traffic|city|street amb|urban/, 'city-traffic'], [/room tone|silence|quiet room|air con|hvac/, 'room-tone'],
    [/forest|birds|jungle|nature/, 'forest'], [/ocean|wave|sea|beach/, 'ocean'], [/crowd|bar amb|restaurant|station amb/, 'crowd'],
    [/footstep|walk|run/, 'footsteps'], [/door|creak|knock/, 'door'], [/impact|hit|crash|slam|punch/, 'impact'],
    [/whoosh|swish|transition/, 'whoosh'], [/riser|build|tension build/, 'riser'],
    [/server|computer|hum|machine|lab/, 'server-hum'], [/fire|flame|campfire/, 'fire'], [/clock|tick/, 'clock'],
    [/heart|pulse/, 'heartbeat'], [/click|ui/, 'ui-click'], [/scratch|placeholder|dialogue temp/, 'scratch-voice'],
    [/suspense|tension|dread|dark score/, 'score-tension'], [/warm|hope|tender|love/, 'score-warm'],
    [/epic|heroic|grand|trailer/, 'score-epic'], [/sad|melanchol|loss|grief/, 'score-melancholy'],
    [/drive|chase|action|pulse score/, 'score-drive']
  ];
  for (const [re, p] of map) if (re.test(t)) return p;
  return /music|score|theme|soundtrack/.test(t) ? 'score-warm' : 'room-tone';
}

/** Peak envelope for timeline waveform display (128 buckets). */
export function peaksFromWav(wav: Buffer, buckets = 128): number[] {
  if (wav.length < 45 || wav.toString('ascii', 0, 4) !== 'RIFF') return [];
  const nCh = wav.readUInt16LE(22) || 1;
  const dataStart = 44;
  const frames = Math.floor((wav.length - dataStart) / (2 * nCh));
  if (frames <= 0) return [];
  const per = Math.max(1, Math.floor(frames / buckets));
  const out: number[] = [];
  for (let b = 0; b < buckets; b++) {
    let m = 0;
    const s = b * per, e = Math.min(frames, s + per);
    for (let i = s; i < e; i++) {
      const v = wav.readInt16LE(dataStart + i * 2 * nCh) / 32768;
      m = Math.max(m, Math.abs(v));
    }
    out.push(Number(m.toFixed(4)));
  }
  return out;
}
