import type { ColorGrade, Timeline, TimelineOp } from '@/types';
import { condenseOps, reframeOps } from './ops';
import { nearestBeat } from '../domain/sound';

/**
 * High-level edit intents → concrete timeline operations.
 *
 * Both the demo rule engine and a real LLM may answer an edit note with
 * intents ("tighten", "grade: noir", "condense to 30s"). This is the single
 * place those become validated, replayable TimelineOps, so an AI proposal is
 * always reviewable as a real diff — and always undoable.
 */

export interface RawOp { op: string; [k: string]: unknown }

const GRADE_PRESETS: Record<string, Partial<ColorGrade>> = {
  cinematic: { contrast: 10, saturation: -6, temperature: -6, shadows: -6, highlights: 4, vignette: 22, grain: 14, fade: 4 },
  noir: { contrast: 24, saturation: -46, blacks: -14, shadows: -18, highlights: 8, vignette: 34, grain: 22, temperature: -12 },
  teal: { temperature: -14, tint: 2, contrast: 12, saturation: 4, shadows: -8 },
  warm: { temperature: 16, tint: 4, saturation: 6, highlights: 6, vibrance: 10, fade: 6 },
  cold: { temperature: -18, tint: -4, saturation: -8, contrast: 10, shadows: -8 },
  epic: { contrast: 18, saturation: 8, blacks: -8, highlights: 8, vignette: 26, grain: 12, temperature: -4 },
  bleach: { contrast: 30, saturation: -34, whites: 12, blacks: -8, sharpness: 22 },
  flat: {}
};

export interface ExpandResult { ops: TimelineOp[]; notes: string[]; followUps: string[] }

export function expandEditOps(raw: RawOp[], tl: Timeline): ExpandResult {
  const ops: TimelineOp[] = [];
  const notes: string[] = [];
  const followUps: string[] = [];
  const videoClips = () => tl.tracks.filter(t => t.kind === 'video').flatMap(t => t.clips);
  const num = (o: RawOp, k: string, d: number) => { const v = Number(o[k]); return Number.isFinite(v) ? v : d; };
  const str = (o: RawOp, k: string, d = '') => String(o[k] ?? d);

  for (const o of raw ?? []) {
    switch (o.op) {
      case 'tighten': {
        const amount = Math.max(0.02, Math.min(0.6, num(o, 'amount', 0.15)));
        let n = 0;
        for (const c of videoClips()) {
          if (c.duration <= 1.2) continue;
          ops.push({ op: 'trimClip', clipId: c.id, duration: Math.max(0.8, Math.round(c.duration * (1 - amount) * 100) / 100) });
          n++;
        }
        notes.push(`Trimmed ${n} clip(s) by ${Math.round(amount * 100)}%.`);
        break;
      }
      case 'removeStatic': {
        const minSec = num(o, 'minSec', 5);
        const long = videoClips().filter(c => c.duration > minSec);
        for (const c of long) ops.push({ op: 'trimClip', clipId: c.id, duration: Math.max(1.5, Math.round(minSec * 100) / 100) });
        notes.push(`Shortened ${long.length} hold(s) longer than ${minSec}s.`);
        break;
      }
      case 'speedUpLong': {
        const threshold = num(o, 'threshold', 6);
        const speed = Math.max(0.5, Math.min(4, num(o, 'speed', 1.12)));
        const targets = videoClips().filter(c => c.duration > threshold);
        for (const c of targets) ops.push({ op: 'retime', clipId: c.id, speed: Math.round((c.speed || 1) * speed * 100) / 100 });
        notes.push(`Retimed ${targets.length} long clip(s) to ${speed.toFixed(2)}×.`);
        break;
      }
      case 'grade': {
        const preset = GRADE_PRESETS[str(o, 'preset', 'cinematic').toLowerCase()] ?? GRADE_PRESETS.cinematic;
        ops.push({ op: 'setGrade', scope: 'timeline', grade: preset });
        notes.push(`Applied the "${str(o, 'preset', 'cinematic')}" grade to the timeline.`);
        break;
      }
      case 'vignette': case 'grain': case 'lowerKey': {
        const key = o.op === 'lowerKey' ? 'exposure' : o.op;
        const amount = Math.max(-100, Math.min(100, num(o, 'amount', o.op === 'grain' ? 0.18 : 0.35) * (o.op === 'grain' ? 100 : 100)));
        ops.push({ op: 'setGrade', scope: 'timeline', grade: { [key]: amount } as Partial<ColorGrade> });
        notes.push(`${key} ${amount > 0 ? '+' : ''}${Math.round(amount)}.`);
        break;
      }
      case 'transitions': {
        const kind = str(o, 'kind', 'crossfade') as never;
        const dur = Math.max(0.05, Math.min(2, num(o, 'dur', 0.4)));
        const clips = videoClips();
        for (const c of clips.slice(1)) ops.push({ op: 'addTransition', clipId: c.id, edge: 'in', kind, dur });
        notes.push(`Added ${dur}s ${String(kind).replace('-', ' ')} to ${Math.max(0, clips.length - 1)} join(s).`);
        break;
      }
      case 'condense': {
        const target = Math.max(5, num(o, 'targetSec', 30));
        ops.push(...condenseOps(tl, target));
        notes.push(`Condensed the spine to about ${target}s.`);
        break;
      }
      case 'buildTrailer': {
        const target = Math.max(20, num(o, 'targetSec', 75));
        ops.push(...condenseOps(tl, target));
        ops.push({ op: 'setGrade', scope: 'timeline', grade: GRADE_PRESETS.epic });
        notes.push(`Built a ${target}s trailer cut with an epic grade.`);
        followUps.push('Add a riser at the midpoint and a title card at the end from the Sound and Text panels.');
        break;
      }
      case 'reframe': {
        const aspect = str(o, 'aspect', '9:16') as '9:16' | '16:9' | '1:1';
        ops.push(...reframeOps(tl, aspect));
        notes.push(`Reframed every clip for ${aspect}.`);
        followUps.push(`Change the timeline aspect ratio to ${aspect} in Project settings so the export matches.`);
        break;
      }
      case 'hookFirst': {
        const clips = videoClips();
        const hookIdx = clips.findIndex(c => /close|extreme close/i.test(c.name));
        if (hookIdx > 0) {
          const hook = clips[hookIdx];
          ops.push({ op: 'moveClip', clipId: hook.id, start: 0 });
          let t = hook.duration;
          for (const c of clips) { if (c.id === hook.id) continue; ops.push({ op: 'moveClip', clipId: c.id, start: Math.round(t * 1000) / 1000 }); t += c.duration; }
          notes.push('Moved the strongest close-up to the front as the hook.');
        } else notes.push('No obvious hook shot found — left the order unchanged.');
        break;
      }
      case 'captions': {
        let n = 0;
        for (const tr of tl.tracks) {
          if (tr.kind !== 'audio') continue;
          for (const c of tr.clips) {
            const text = String((c.meta as Record<string, unknown>)?.caption ?? c.name ?? '');
            if (!text || text.length < 3) continue;
            ops.push({
              op: 'addClip', track: tl.tracks.filter(t => t.kind === 'video').length - 1,
              clip: {
                kind: 'text', name: text.slice(0, 24), start: c.start, duration: Math.max(0.8, c.duration),
                color: '#4A4232',
                text: { content: text.replace(/^[\w\s]+:\s*/, ''), font: 'Inter', size: 40, color: '#FFFFFF', align: 'center', y: 0.86, bg: true, animate: 'none' }
              }
            });
            n++;
          }
        }
        notes.push(n ? `Added ${n} caption(s) inside the lower title-safe area.` : 'No dialogue clips on the timeline to caption yet.');
        break;
      }
      case 'quantizeToBeat': {
        const bpm = Math.max(40, Math.min(220, num(o, 'bpm', 120)));
        let t = 0;
        for (const c of videoClips()) {
          const start = nearestBeat(t, bpm);
          const dur = Math.max(60 / bpm, nearestBeat(c.duration, bpm));
          ops.push({ op: 'moveClip', clipId: c.id, start });
          ops.push({ op: 'trimClip', clipId: c.id, duration: Math.round(dur * 1000) / 1000 });
          t = start + dur;
        }
        notes.push(`Quantised cuts to a ${bpm} BPM grid.`);
        break;
      }
      case 'duck': {
        const amount = Math.max(0.1, Math.min(1, num(o, 'amount', 0.55)));
        for (const tr of tl.tracks) {
          if (tr.kind !== 'audio') continue;
          const isMusic = tr.clips.some(c => String((c.meta as Record<string, unknown>)?.kind ?? '') === 'score' || c.color === '#46334F');
          if (!isMusic) continue;
          for (const c of tr.clips) ops.push({ op: 'updateClip', clipId: c.id, patch: { volume: Math.round(c.volume * amount * 100) / 100 } });
        }
        notes.push(`Ducked the music bus to ${Math.round(amount * 100)}% under dialogue.`);
        break;
      }
      case 'riserAt': {
        const t = Math.max(0, Math.min(tl.durationSec, tl.durationSec * Math.max(0, Math.min(1, num(o, 'ratio', 0.6)))));
        ops.push({ op: 'addMarker', t: Math.round(t * 100) / 100, label: 'riser' });
        followUps.push(`Place a riser sound cue at ${t.toFixed(1)}s from the Sound stage.`);
        break;
      }
      case 'addBed': {
        followUps.push(`Generate a "${str(o, 'mood', 'warm')}" score bed in the Sound stage and lay it under the timeline at ${Math.round(num(o, 'gain', 0.4) * 100)}% — the editor cannot invent media.`);
        break;
      }
      case 'normalize': case 'stems': case 'chapters': case 'sortTimeline': {
        if (o.op === 'sortTimeline') ops.push({ op: 'sortTimeline' });
        else followUps.push(`"${o.op}" happens at export time (${o.op === 'stems' ? 'Export → Stems' : o.op === 'normalize' ? 'loudness is normalised by the limiter on render' : 'chapters come from timeline markers'}).`);
        break;
      }
      default:
        notes.push(`Ignored unknown intent "${o.op}".`);
    }
  }
  ops.push({ op: 'sortTimeline' });
  return { ops, notes, followUps };
}
