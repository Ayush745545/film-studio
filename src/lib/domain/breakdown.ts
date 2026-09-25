import { uid, hashSeed, rng } from '../ids';
import type { CameraMove, Character, Location, Scene, Shot, ShotSize, LENSES } from '@/types';
import { shotImagePrompt } from './prompts';
import { titleCase } from './script';

/**
 * Scene breakdown + shot grammar.
 *
 * Deterministic coverage planning: real editors think in establishing →
 * medium → close → reaction → insert, with lens and movement implied by the
 * shot size and the scene's emotional register. Everything produced here is
 * fully editable afterwards — this is a first pass, not a verdict.
 */

const LENS_FOR: Record<ShotSize, (typeof LENSES)[number]> = {
  'Extreme Wide': '18mm', 'Wide': '24mm', 'Full': '28mm', 'Medium Wide': '28mm',
  'Medium': '35mm', 'Medium Close': '50mm', 'Close-up': '85mm', 'Extreme Close-up': '105mm',
  'Over Shoulder': '50mm', 'POV': '35mm', 'Insert': '105mm', 'Two Shot': '35mm'
};

const ANGLE_FOR: Record<ShotSize, string> = {
  'Extreme Wide': 'High angle, deep staging', 'Wide': 'Eye level, wide staging', 'Full': 'Eye level',
  'Medium Wide': 'Eye level', 'Medium': 'Eye level', 'Medium Close': 'Slightly low, intimate',
  'Close-up': 'Eye level, tight', 'Extreme Close-up': 'Eye level, macro', 'Over Shoulder': 'Over-shoulder, dirty frame',
  'POV': 'Subjective, first person', 'Insert': 'Top-down insert', 'Two Shot': 'Eye level, two-shot profile'
};

interface CoveragePlan { size: ShotSize; move: CameraMove; why: string; weight: number }

function planCoverage(scene: Scene, seed: number): CoveragePlan[] {
  const r = rng(seed);
  const dialogueLines = scene.dialogue.split('\n').filter(Boolean).length;
  const isExt = scene.intExt.includes('EXT');
  const emotion = scene.emotion.toLowerCase();
  const tense = /dread|fury|tension|fear/.test(emotion);
  const tender = /tenderness|grief|hope|love/.test(emotion);
  const plan: CoveragePlan[] = [];

  // 1. establish — exteriors and new locations always get one
  if (isExt || scene.index === 1 || r() > 0.35) {
    plan.push({
      size: isExt ? 'Extreme Wide' : 'Wide',
      move: isExt ? (tense ? 'Slow Push' : 'Crane') : 'Static',
      why: isExt ? 'Establish geography and weather before we meet anyone' : 'Establish the room and its light',
      weight: 1.4
    });
  }
  // 2. master / two-shot when two or more people speak
  if (dialogueLines >= 3) {
    plan.push({ size: 'Two Shot', move: tense ? 'Handheld' : 'Static', why: 'Hold the relationship in one frame so the cut can break it later', weight: 1.2 });
  }
  // 3. mediums per speaker
  const speakers = Math.max(1, Math.min(3, scene.characterIds.length || Math.ceil(dialogueLines / 2)));
  for (let i = 0; i < speakers; i++) {
    plan.push({
      size: tender ? 'Medium Close' : 'Medium',
      move: i === 0 && tense ? 'Slow Push' : 'Static',
      why: i === 0 ? 'Primary coverage on the scene driver' : 'Reaction coverage — the audience reads the listener',
      weight: 1
    });
  }
  // 4. the turn — a close-up where the scene changes
  if (dialogueLines > 0 || scene.durationSec > 12) {
    plan.push({
      size: tense ? 'Extreme Close-up' : 'Close-up',
      move: tense ? 'Handheld' : tender ? 'Slow Push' : 'Static',
      why: tense ? 'Isolate the moment the situation turns' : 'Land the emotional turn without cutting away',
      weight: 1.3
    });
  }
  // 5. insert when the action names an object
  if (scene.props.length) {
    plan.push({ size: 'Insert', move: 'Rack Focus', why: `Object detail: ${scene.props[0]} carries the information`, weight: 0.8 });
  }
  // 6. exit shot for longer scenes
  if (scene.durationSec > 24) {
    plan.push({ size: 'Wide', move: 'Pull Back', why: 'Release the scene — pull away before the cut', weight: 0.9 });
  }
  return plan.slice(0, 8);
}

function distributeDurations(total: number, plan: CoveragePlan[]): number[] {
  const weights = plan.map(p => p.weight);
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map(w => (w / sum) * total);
  // enforce a 2.5s minimum and a 14s maximum per shot, then rebalance
  const out = raw.map(v => Math.max(2.5, Math.min(14, v)));
  const drift = total - out.reduce((a, b) => a + b, 0);
  if (Math.abs(drift) > 0.4 && out.length) {
    const per = drift / out.length;
    for (let i = 0; i < out.length; i++) out[i] = Math.max(2, Math.round((out[i] + per) * 2) / 2);
  }
  return out.map(v => Math.round(v * 2) / 2);
}

export function generateShots(scene: Scene, opts: {
  characters: Character[]; location: Location | null; style: string; presetId: string;
  seed?: number; negativePrompt?: string;
}): Shot[] {
  const seed = opts.seed ?? hashSeed(`${scene.heading}-${scene.index}`);
  const plan = planCoverage(scene, seed);
  const durations = distributeDurations(scene.durationSec, plan);
  const chars = scene.characterIds.length
    ? opts.characters.filter(c => scene.characterIds.some(id => id === c.id || id === c.name))
    : opts.characters.slice(0, 2);
  const useChars = chars.length ? chars : opts.characters.slice(0, 2);

  return plan.map((p, i) => {
    const shot: Shot = {
      id: uid('shot'), projectId: scene.projectId, sceneId: scene.id, index: i + 1,
      size: p.size, lens: LENS_FOR[p.size], move: p.move,
      durationSec: durations[i] ?? 5, angle: ANGLE_FOR[p.size],
      description: buildDescription(scene, p, useChars, i),
      dialogue: dialogueForShot(scene, i, plan.length),
      lighting: scene.lighting,
      prompt: '', negativePrompt: opts.negativePrompt ?? '',
      seed: seed + i * 7919,
      frameAssetId: null, videoAssetId: null,
      frameStatus: 'none', videoStatus: 'none',
      variations: [], take: 1, notes: p.why
    };
    const built = shotImagePrompt({
      shot, scene, characters: useChars, location: opts.location,
      style: opts.style, presetId: opts.presetId, negative: opts.negativePrompt
    });
    shot.prompt = built.prompt;
    shot.negativePrompt = built.negative;
    return shot;
  });
}

function buildDescription(scene: Scene, p: CoveragePlan, chars: Character[], i: number): string {
  const who = chars[i % Math.max(1, chars.length)]?.name;
  const action = scene.action.split(/(?<=[.!?])\s+/).filter(Boolean);
  const base = action[i % Math.max(1, action.length)] ?? scene.heading;
  if (p.size === 'Insert' && scene.props[0]) return `Insert on ${scene.props[0]}. ${base}`;
  if (who && /Close|Medium|Two Shot|POV/.test(p.size)) return `${who}: ${base}`.trim();
  return base;
}

function dialogueForShot(scene: Scene, i: number, total: number): string {
  const lines = scene.dialogue.split('\n').filter(Boolean);
  if (!lines.length) return '';
  const per = Math.ceil(lines.length / total);
  return lines.slice(i * per, i * per + per).join('\n');
}

/** Attach generated shots back onto scenes. */
export function attachShots(scenes: Scene[], shotsByScene: Record<string, Shot[]>): Scene[] {
  return scenes.map(s => ({ ...s, shotIds: (shotsByScene[s.id] ?? []).map(x => x.id) }));
}

export function sceneDurationFromShots(shots: Shot[]): number {
  return Math.round(shots.reduce((a, s) => a + s.durationSec, 0) * 10) / 10;
}

export function estimateShotCount(scenes: Scene[]): number {
  return scenes.reduce((a, s) => a + generateShots(s, { characters: [], location: null, style: 'cinematic', presetId: 'cinematic-realism' }).length, 0);
}

/** Location matching: fuzzy-name a scene's slug onto a designed location. */
export function matchLocation(scene: Scene, locations: Location[]): Location | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const slug = norm(scene.locationName);
  let best: { loc: Location; score: number } | null = null;
  for (const loc of locations) {
    const n = norm(loc.name);
    let score = 0;
    if (n === slug) score = 1;
    else if (slug.includes(n) || n.includes(slug)) score = 0.8;
    else {
      const a = new Set(slug.split(' ')); const b = new Set(n.split(' '));
      const inter = [...a].filter(x => b.has(x)).length;
      score = inter / Math.max(1, Math.max(a.size, b.size));
    }
    if (score > 0.34 && (!best || score > best.score)) best = { loc, score };
  }
  return best?.loc ?? null;
}

/** Character matching against script names. */
export function matchCharacters(scene: Scene, characters: Character[]): Character[] {
  if (!scene.characterIds.length) return [];
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return characters.filter(c => scene.characterIds.some(id => {
    const n = norm(id);
    return n === norm(c.name) || n === c.id || n.includes(norm(c.name.split(' ')[0]));
  }));
}

export { titleCase };
