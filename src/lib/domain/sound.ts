import { uid } from '../ids';
import type { Scene, Shot, SoundCue, SoundKind } from '@/types';
import { presetFromPrompt, type SoundPreset } from '../media/wav';

/**
 * Sound design mapping.
 *
 * Reads the scene breakdown and proposes a real cue sheet: ambience beds per
 * location, foley for named actions, score for emotional arcs. Each cue can be
 * regenerated, retimed or deleted — this is a starting point an editor would
 * recognise, not random noise.
 */

interface CueRule { re: RegExp; kind: SoundKind; name: string; prompt: string; dur: number; volume: number; loop?: boolean; tags: string[] }

const RULES: CueRule[] = [
  { re: /\brain\b|\bdownpour\b|\bstorm\b|\bwet street\b/, kind: 'ambience', name: 'Rain bed', prompt: 'steady rain on hard surfaces, distant thunder, no wind howl', dur: 30, volume: 0.5, loop: true, tags: ['weather'] },
  { re: /\bwind\b|\bgale\b|\bbreeze\b/, kind: 'ambience', name: 'Wind bed', prompt: 'cold wind across an open space, intermittent gusts', dur: 30, volume: 0.42, loop: true, tags: ['weather'] },
  { re: /\bcity\b|\bstreet\b|\btraffic\b|\bdowntown\b/, kind: 'ambience', name: 'City ambience', prompt: 'distant traffic, occasional horn, urban hum, no dialogue', dur: 30, volume: 0.38, loop: true, tags: ['urban'] },
  { re: /\bapartment\b|\broom\b|\boffice\b|\binterior\b|\bbedroom\b/, kind: 'ambience', name: 'Room tone', prompt: 'quiet interior room tone, faint air handling, no music', dur: 30, volume: 0.3, loop: true, tags: ['interior'] },
  { re: /\blaborator(y|y)\b|\bserver\b|\bcomputer room\b|\bmachine\b/, kind: 'ambience', name: 'Machine hum', prompt: 'server room hum, cooling fans, intermittent electronic beeps', dur: 30, volume: 0.44, loop: true, tags: ['tech'] },
  { re: /\bforest\b|\bwoods\b|\bjungle\b|\bfield\b/, kind: 'ambience', name: 'Forest ambience', prompt: 'woodland ambience, sparse birdsong, leaves, no traffic', dur: 30, volume: 0.42, loop: true, tags: ['nature'] },
  { re: /\bocean\b|\bsea\b|\bbeach\b|\bwaterfront\b|\bharbo/, kind: 'ambience', name: 'Water ambience', prompt: 'slow waves on a shore, distant gulls', dur: 30, volume: 0.45, loop: true, tags: ['nature'] },
  { re: /\bstation\b|\btrain\b|\bcrowd\b|\bdiner\b|\bbar\b|\bairport\b/, kind: 'ambience', name: 'Crowd ambience', prompt: 'indoor crowd murmur, no intelligible dialogue, footsteps, distant announcements', dur: 30, volume: 0.36, loop: true, tags: ['crowd'] },
  { re: /\bdoor\b|\bopens?\b|\bcloses?\b|\bknock\b/, kind: 'sfx', name: 'Door', prompt: 'interior door opens, handle mechanism, closes with a soft latch', dur: 2.4, volume: 0.75, tags: ['foley'] },
  { re: /\bfootstep|\bwalks?\b|\bruns?\b|\bpaces?\b|\bsteps?\b/, kind: 'foley', name: 'Footsteps', prompt: 'footsteps on a hard interior floor, measured pace, two people', dur: 5, volume: 0.6, tags: ['foley'] },
  { re: /\bglass\b|\bcup\b|\bbottle\b|\bpours?\b|\bdrinks?\b/, kind: 'foley', name: 'Glass handle', prompt: 'glass set down on a wooden table, liquid settles', dur: 1.6, volume: 0.6, tags: ['foley'] },
  { re: /\bphone\b|\bcall\b|\bmessage\b|\btexts?\b/, kind: 'sfx', name: 'Phone', prompt: 'mobile phone vibration on a hard surface, short', dur: 1.2, volume: 0.55, tags: ['prop'] },
  { re: /\bcrash\b|\bslam\b|\bbreaks?\b|\bsmash\b|\bfalls?\b/, kind: 'sfx', name: 'Impact', prompt: 'heavy impact, wood and glass, short reverb tail', dur: 2.2, volume: 0.85, tags: ['impact'] },
  { re: /\bgunshot\b|\bshot\b|\bexplosion\b|\bblast\b/, kind: 'sfx', name: 'Gunshot / blast', prompt: 'single distant gunshot in an interior, sharp crack, long tail', dur: 3, volume: 0.9, tags: ['impact'] },
  { re: /\bcar\b|\bengine\b|\bdrives?\b|\bvehicle\b/, kind: 'sfx', name: 'Vehicle pass', prompt: 'car passes close by, doppler, wet road', dur: 4, volume: 0.6, tags: ['vehicle'] },
  { re: /\bcomputer\b|\bkeyboard\b|\btyping\b|\bterminal\b/, kind: 'foley', name: 'Keyboard', prompt: 'mechanical keyboard typing, steady, close perspective', dur: 4, volume: 0.5, tags: ['tech'] },
  { re: /\bheart\b|\bpulse\b|\bbreath\b|\bbreathing\b/, kind: 'foley', name: 'Breath / heartbeat', prompt: 'close anxious breathing, faint heartbeat underneath', dur: 6, volume: 0.45, tags: ['body'] }
];

const SCORE_BY_EMOTION: Record<string, { name: string; prompt: string; preset: SoundPreset; volume: number }> = {
  dread: { name: 'Tension figure', prompt: 'low sustained strings, dissonant cluster, slow pulse, no melody', preset: 'score-tension', volume: 0.4 },
  tension: { name: 'Tension figure', prompt: 'low sustained strings, dissonant cluster, slow pulse, no melody', preset: 'score-tension', volume: 0.38 },
  fury: { name: 'Percussive drive', prompt: 'driving low percussion, aggressive strings, no melody', preset: 'score-drive', volume: 0.45 },
  grief: { name: 'Grief theme', prompt: 'solo piano and cello, slow, sparse, minor', preset: 'score-melancholy', volume: 0.36 },
  melancholy: { name: 'Melancholy theme', prompt: 'solo piano and cello, slow, sparse, minor', preset: 'score-melancholy', volume: 0.34 },
  tenderness: { name: 'Warm theme', prompt: 'warm strings and piano, gentle, hopeful', preset: 'score-warm', volume: 0.34 },
  hope: { name: 'Hopeful theme', prompt: 'warm strings, rising figure, restrained', preset: 'score-warm', volume: 0.36 },
  wonder: { name: 'Wonder theme', prompt: 'shimmering pads, high strings, slow arpeggio', preset: 'score-epic', volume: 0.36 },
  shame: { name: 'Sparse underscore', prompt: 'single sustained tone, very sparse, uncomfortable', preset: 'score-tension', volume: 0.3 },
  relief: { name: 'Resolve theme', prompt: 'strings resolve to major, soft, warm', preset: 'score-warm', volume: 0.34 },
  longing: { name: 'Longing theme', prompt: 'melancholy piano with warm string pad', preset: 'score-melancholy', volume: 0.34 }
};

export function designSound(scenes: Scene[], opts: { withScore?: boolean; withAmbience?: boolean; withFoley?: boolean } = {}): SoundCue[] {
  const withScore = opts.withScore !== false;
  const withAmbience = opts.withAmbience !== false;
  const withFoley = opts.withFoley !== false;
  const cues: SoundCue[] = [];
  let cursor = 0;

  for (const scene of scenes) {
    const text = `${scene.heading} ${scene.action} ${scene.dialogue} ${scene.lighting}`.toLowerCase();
    const sceneStart = cursor;

    if (withAmbience) {
      const matched = RULES.filter(r => r.loop && r.re.test(text)).slice(0, 2);
      for (const rule of matched) {
        cues.push(cue(scene, rule, sceneStart, Math.min(rule.dur, Math.max(6, scene.durationSec)), rule.volume));
      }
      if (!matched.length) {
        cues.push(cue(scene, RULES[3], sceneStart, Math.max(6, scene.durationSec), 0.26)); // default room tone
      }
    }

    if (withFoley) {
      const hits = RULES.filter(r => !r.loop && r.re.test(text)).slice(0, 4);
      hits.forEach((rule, i) => {
        const at = sceneStart + Math.max(0.5, (scene.durationSec / (hits.length + 1)) * (i + 1) - rule.dur / 2);
        cues.push(cue(scene, rule, Math.round(at * 100) / 100, rule.dur, rule.volume));
      });
    }

    if (withScore) {
      const score = SCORE_BY_EMOTION[scene.emotion.toLowerCase()] ?? SCORE_BY_EMOTION.tension;
      if (/ACT|climax|final/i.test(scene.heading) || scene.durationSec > 14 || cues.filter(c => c.kind.startsWith('score')).length % 2 === 0) {
        cues.push({
          id: uid('cue'), projectId: scene.projectId, sceneId: scene.id, kind: 'score',
          name: score.name, description: score.prompt, prompt: score.prompt,
          startSec: Math.round(sceneStart * 100) / 100, durationSec: Math.round(Math.min(60, Math.max(8, scene.durationSec)) * 10) / 10,
          volume: score.volume, loop: false, assetId: null, status: 'none', modelId: null, demo: false,
          autoDetected: true, tags: ['score', scene.emotion]
        });
      }
    }
    cursor += scene.durationSec;
  }
  return cues;
}

function cue(scene: Scene, rule: CueRule, start: number, dur: number, volume: number): SoundCue {
  return {
    id: uid('cue'), projectId: scene.projectId, sceneId: scene.id, kind: rule.kind,
    name: rule.name, description: rule.prompt, prompt: rule.prompt,
    startSec: Math.round(start * 100) / 100, durationSec: Math.round(dur * 10) / 10,
    volume, loop: Boolean(rule.loop), assetId: null, status: 'none', modelId: null, demo: false,
    autoDetected: true, tags: rule.tags
  };
}

export function presetForCue(cue: SoundCue): SoundPreset { return presetFromPrompt(`${cue.name} ${cue.prompt}`); }

/** Beat grid for "sync cuts to beat". */
export function beatGrid(bpm: number, durationSec: number, offset = 0): number[] {
  const beat = 60 / bpm;
  const out: number[] = [];
  for (let t = offset; t <= durationSec; t += beat) out.push(Math.round(t * 1000) / 1000);
  return out;
}

export function nearestBeat(t: number, bpm: number, offset = 0): number {
  const beat = 60 / bpm;
  const n = Math.round((t - offset) / beat);
  return Math.round((offset + n * beat) * 1000) / 1000;
}

export function loudnessTarget(kind: 'dialogue' | 'music' | 'sfx' | 'ambience'): number {
  return { dialogue: -16, music: -24, sfx: -18, ambience: -30 }[kind];
}

/** Suggested mix for a finished film: dialogue forward, music ducked under it. */
export function suggestMix(cues: SoundCue[]): SoundCue[] {
  return cues.map(c => ({
    ...c,
    volume: c.kind === 'score' || c.kind === 'music' ? Math.min(0.42, c.volume)
      : c.kind === 'ambience' ? Math.min(0.34, c.volume)
      : c.volume
  }));
}
