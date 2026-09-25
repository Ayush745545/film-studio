import { getDb } from '../db';
import { execute, route } from '../ai/router';
import { spendCredits, refundCredits, InsufficientCredits } from '../credits';
import { setStageState, loadTimeline, saveTimeline } from '../project';
import { normaliseStory, normaliseScript, scriptText, scenesFromScript, extractCharacterNames, titleCase } from '../domain/script';
import { generateShots, matchLocation, matchCharacters } from '../domain/breakdown';
import { designSound } from '../domain/sound';
import { assemble } from '../domain/assembly';
import { STORY_SYSTEM, SCRIPT_SYSTEM, CAST_SYSTEM, WORLD_SYSTEM, EDIT_SYSTEM, storyPrompt, scriptPrompt, castPrompt, worldPrompt, editPrompt, timelineSummary, copilotPrompt, presetFor, shotImagePrompt, shotVideoPrompt } from '../domain/prompts';
import { uid, nowIso, hashSeed, rng, slugToken } from '../ids';
import { expandEditOps, type RawOp } from '../timeline/edit-ops';
import { synthPalette } from '../media/frame-synth';
import { bus } from '../events';
import type { JobContext } from '../queue';
import type { GenerationJob, Character, Idea, Location, Project, Scene, Shot, Story, Screenplay, Timeline, EditProposal, TimelineOp, SoundCue, VoiceLine, WorldBible } from '@/types';
import { DEFAULT_GRADE, STAGES, STAGE_META } from '@/types';

/**
 * Domain workers: story → script → cast → world → breakdown → sound → assemble.
 *
 * Each worker builds a prompt (or uses the demo engine's structured output),
 * normalises whatever came back into the strict domain model, persists it, and
 * advances the project's stage state. Every step is idempotent and versioned.
 */

const SYSTEMS: Record<string, string> = {
  story: STORY_SYSTEM, script: SCRIPT_SYSTEM, cast: CAST_SYSTEM, world: WORLD_SYSTEM, edit: EDIT_SYSTEM
};

async function text(req: {
  job: GenerationJob; ctx: JobContext; task: string; prompt: string; system: string;
  modelId?: string | null; presetId?: string | null; temperature?: number; maxTokens?: number;
  /** Forwarded to the model as structured context. The demo engine reads this
   *  to produce real structured output instead of guessing from prose. */
  meta?: Record<string, unknown>;
}) {
  const decision = await route({
    userId: req.job.userId, kind: 'text', modelId: req.modelId, presetId: req.presetId ?? undefined,
    strategy: 'quality', allowDemo: true
  });
  const est = decision.adapter.estimateCost({ kind: 'text', modelId: decision.model.id, prompt: req.prompt, text: { system: req.system, responseFormat: 'json' } }, decision.model);
  const cost = decision.demo ? 0 : Math.min(6, est.credits);
  let charged = 0;
  if (cost > 0) {
    try { await spendCredits(req.job.userId, cost, { type: 'job', id: req.job.id, description: `${req.job.label} · ${decision.model.name}` }); charged = cost; }
    catch (e) {
      if (e instanceof InsufficientCredits) throw Object.assign(new Error(e.message), { code: 'insufficient_credits', retryable: false, suggestion: 'Top up credits in Settings → Billing.' });
      throw e;
    }
  }
  try {
    await req.ctx.update({ modelId: decision.model.id, providerId: decision.provider.id, demo: decision.demo });
    await req.ctx.log('info', decision.reason);
    const result = await execute({
      kind: 'text', modelId: decision.model.driverModel, prompt: req.prompt,
      text: { system: req.system, temperature: req.temperature ?? 0.85, maxTokens: req.maxTokens ?? 6000, responseFormat: 'json' },
      meta: { task: req.task, providerId: decision.provider.id, ...(req.meta ?? {}) }
    }, {
      jobId: req.job.id, userId: req.job.userId, signal: req.ctx.signal, route: decision,
      onProgress: (p, s) => void req.ctx.progress(p, s),
      onLog: (l, m) => void req.ctx.log(l, m)
    });
    const json = result.json ?? tryParse(result.text ?? '');
    return { json, text: result.text ?? '', demo: result.demo, charged, model: result.modelId, provider: result.providerId };
  } catch (err) {
    if (charged) await refundCredits(req.job.userId, charged, { type: 'job', id: req.job.id, description: `Refund — ${req.job.label} failed` }).catch(() => {});
    throw err;
  }
}

function tryParse(t: string): unknown {
  if (!t) return undefined;
  try { return JSON.parse(t); } catch { /* keep going */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* keep going */ } }
  const obj = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (obj) { try { return JSON.parse(obj[0]); } catch { return undefined; } }
  return undefined;
}

async function project(job: GenerationJob): Promise<Project> {
  const db = await getDb();
  const id = (job.input as any)?.projectId ?? job.projectId;
  const p = await db.repo('projects').findUnique(id) as unknown as Project | null;
  if (!p) throw Object.assign(new Error('Project not found'), { code: 'not_found', retryable: false });
  return p;
}

/* ── STORY ────────────────────────────────────────────────── */
export async function runStory(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const input = job.input as { idea?: Partial<Idea>; mods?: Record<string, boolean>; modelId?: string | null; presetId?: string | null; versionNote?: string };
  const idea = { ...p.idea, ...(input.idea ?? {}) } as Idea;
  if (!idea.text && !idea.genre && !idea.theme) {
    throw Object.assign(new Error('The idea is empty — write a premise first.'), { code: 'empty_idea', retryable: false, suggestion: 'Add at least a sentence of idea, or fill genre/setting/conflict so the story has something to work with.' });
  }
  const prompt = storyPrompt(idea, input.mods ?? {});
  await ctx.progress(0.05, 'Building story brief');
  const res = await text({ job, ctx, task: 'story', prompt, system: SYSTEMS.story, modelId: input.modelId, presetId: input.presetId, temperature: 0.95, maxTokens: 4000, meta: { idea } });
  const story = normaliseStory(res.json ?? { title: p.name }, hashSeed(prompt));
  await ctx.progress(0.9, 'Persisting story');
  const db = await getDb();
  await db.repo('projects').update(p.id, { idea, story, updatedAt: nowIso() } as never);
  await setStageState(p.id, 'story', 'ready');
  await ctx.log('info', `Story: "${story.title}" — ${story.acts.reduce((a, b) => a + b.beats.length, 0)} beats`);
  return { output: { story, demo: res.demo, model: res.model, provider: res.provider }, assetIds: [], creditsUsed: res.charged };
}

/* ── SCRIPT ───────────────────────────────────────────────── */
export async function runScript(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { mods?: Record<string, boolean>; sceneCount?: number; modelId?: string | null; presetId?: string | null };
  if (!p.story?.logline) throw Object.assign(new Error('No story yet'), { code: 'missing_story', retryable: false, suggestion: 'Generate and approve a story first — the screenplay is built from its beats.' });
  const characters = await db.repo('characters').findMany({ where: { projectId: p.id } }) as unknown as Character[];
  const locations = await db.repo('locations').findMany({ where: { projectId: p.id } }) as unknown as Location[];
  const sceneCount = input.sceneCount ?? Math.max(4, Math.min(14, Math.round((p.settings.durationSec ?? 60) / 12)));
  const prompt = scriptPrompt(p.story, characters, locations, { ...(input.mods ?? {}), sceneCount });
  await ctx.progress(0.05, 'Outlining scenes');
  const res = await text({ job, ctx, task: 'script', prompt, system: SYSTEMS.script, modelId: input.modelId, presetId: input.presetId, temperature: 0.9, maxTokens: 8000, meta: { story: p.story, idea: p.idea, sceneCount } });
  const sp = normaliseScript(res.json ?? { title: p.story.title }, p.story.title);
  sp.draft = (p.screenplay?.draft ?? 0) + 1;
  await ctx.progress(0.85, 'Formatting screenplay');
  await db.repo('projects').update(p.id, { screenplay: sp, updatedAt: nowIso() } as never);
  await db.repo('scripts').upsert(uid('scr'), { id: sp.id, projectId: p.id, title: sp.title, author: sp.author, draft: sp.draft, logline: sp.logline, elements: sp.elements, fadeIn: sp.fadeIn ?? null, fadeOut: sp.fadeOut ?? null, rev: sp.draft } as never);
  await setStageState(p.id, 'script', 'ready');
  await ctx.log('info', `Screenplay: ${sp.elements.length} elements, ${sp.elements.filter(e => e.type === 'scene-heading').length} scenes`);
  return { output: { screenplay: sp, text: scriptText(sp), demo: res.demo, model: res.model }, assetIds: [], creditsUsed: res.charged };
}

/* ── CHARACTERS ───────────────────────────────────────────── */
export async function runCast(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { modelId?: string | null; presetId?: string | null };
  if (!p.screenplay?.elements?.length) throw Object.assign(new Error('No screenplay yet'), { code: 'missing_script', retryable: false, suggestion: 'Generate the script first; characters are extracted from it.' });
  const text0 = scriptText(p.screenplay);
  await ctx.progress(0.1, 'Reading screenplay for characters');
  const res = await text({ job, ctx, task: 'characters', prompt: castPrompt(text0, p.story ?? { title: p.name, logline: '', premise: '', acts: [], themes: [], ending: '', tone: '', genre: '', id: '' }), system: SYSTEMS.cast, modelId: input.modelId, presetId: input.presetId, temperature: 0.8, maxTokens: 4000, meta: { story: p.story, idea: p.idea, scriptText: text0 } });

  const raw = ((res.json as any)?.characters ?? []) as any[];
  const fallback = raw.length ? [] : extractCharacterNames(p.screenplay).map(c => ({ name: c.name, role: 'supporting' }));
  const source = raw.length ? raw : fallback;
  if (!source.length) throw Object.assign(new Error('No characters found in the screenplay'), { code: 'no_characters', retryable: false, suggestion: 'Check the script has character cues, or add them manually.' });

  const existing = await db.repo('characters').findMany({ where: { projectId: p.id } }) as unknown as Character[];
  const byName = new Map(existing.map(c => [c.name.toUpperCase(), c]));
  const palette = ['#D99A32', '#63A9E9', '#4CCB8A', '#C58BE9', '#E9836A', '#5BC8C8', '#E0B341', '#9AA7E9'];
  const saved: Character[] = [];

  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    const name = String(s.name ?? `Character ${i + 1}`).trim();
    const prior = byName.get(name.toUpperCase());
    if (prior?.locked) { saved.push(prior); await ctx.log('warn', `${name} is locked — identity preserved, not overwritten.`); continue; }
    const accent = palette[i % palette.length];
    const identity = String(s.identityPrompt ?? s.physical ?? '').trim() ||
      `${name}, ${s.age ?? 'adult'}, ${s.physical ?? 'distinctive appearance'}, wearing ${s.wardrobe ?? 'contemporary wardrobe'}`;
    const ch: Character = {
      id: prior?.id ?? uid('chr'), projectId: p.id,
      token: prior?.token ?? slugToken('character', name, i + 1),
      name, role: String(s.role ?? 'supporting'), age: String(s.age ?? ''),
      description: String(s.description ?? ''), personality: String(s.personality ?? ''),
      wardrobe: String(s.wardrobe ?? ''), physical: String(s.physical ?? ''),
      voiceProfile: String(s.voiceProfile ?? ''), arc: String(s.arc ?? ''),
      identityPrompt: identity, locked: prior?.locked ?? false, approved: prior?.approved ?? false,
      referenceAssetId: prior?.referenceAssetId ?? null, lookAssetId: prior?.lookAssetId ?? null,
      looks: prior?.looks ?? [], color: prior?.color ?? accent, scenes: prior?.scenes ?? []
    };
    await db.repo('characters').upsert(ch.id, ch as never);
    saved.push(ch);
    await ctx.progress(0.2 + (i / source.length) * 0.6, `Designed ${name}`);
  }
  await setStageState(p.id, 'characters', 'ready');
  await ctx.log('info', `${saved.length} character(s) — each has a persistent identity token injected into every prompt.`);
  return { output: { characters: saved, demo: res.demo, model: res.model }, assetIds: [], creditsUsed: res.charged };
}

/* ── WORLD / LOCATIONS ────────────────────────────────────── */
export async function runWorld(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { modelId?: string | null; presetId?: string | null };
  if (!p.screenplay?.elements?.length) throw Object.assign(new Error('No screenplay yet'), { code: 'missing_script', retryable: false });
  const t = scriptText(p.screenplay);
  await ctx.progress(0.1, 'Scanning slug lines');
  const res = await text({ job, ctx, task: 'locations', prompt: worldPrompt(t, p.story ?? { title: p.name, logline: '', premise: '', acts: [], themes: [], ending: '', tone: '', genre: '', id: '' }), system: SYSTEMS.world, modelId: input.modelId, presetId: input.presetId, temperature: 0.8, maxTokens: 4000, meta: { story: p.story, idea: p.idea, script: p.screenplay } });

  const raw = ((res.json as any)?.locations ?? []) as any[];
  const slugNames = [...new Set(p.screenplay.elements.filter(e => e.type === 'scene-heading').map(e => titleCase(e.meta?.location ?? '')))].filter(Boolean);
  const source = raw.length ? raw : slugNames.map(n => ({ name: n, description: '' }));
  if (!source.length) throw Object.assign(new Error('No locations found'), { code: 'no_locations', retryable: false });

  const existing = await db.repo('locations').findMany({ where: { projectId: p.id } }) as unknown as Location[];
  const byName = new Map(existing.map(l => [l.name.toUpperCase(), l]));
  const saved: Location[] = [];
  for (let i = 0; i < source.length; i++) {
    const s = source[i];
    const name = titleCase(String(s.name ?? `Location ${i + 1}`).trim());
    const prior = byName.get(name.toUpperCase());
    if (prior?.locked) { saved.push(prior); continue; }
    const seed = hashSeed(`${p.id}-${name}`);
    const palette: string[] = (Array.isArray(s.palette) && s.palette.length ? s.palette.map(String) : synthPalette(seed, `${name} ${s.description ?? ''}`)).slice(0, 8);
    const loc: Location = {
      id: prior?.id ?? uid('loc'), projectId: p.id,
      token: prior?.token ?? slugToken('location', name, i + 1),
      name, description: String(s.description ?? ''), architecture: String(s.architecture ?? ''),
      timeOfDay: String(s.timeOfDay ?? ''), lighting: String(s.lighting ?? ''), weather: String(s.weather ?? ''),
      palette, props: (Array.isArray(s.props) ? s.props : []).map(String).slice(0, 10),
      identityPrompt: String(s.identityPrompt ?? s.description ?? '').trim() || `${name}: ${s.architecture ?? ''}, ${s.lighting ?? ''}`.trim(),
      locked: prior?.locked ?? false, approved: prior?.approved ?? false,
      referenceAssetIds: prior?.referenceAssetIds ?? [], assetId: prior?.assetId ?? null,
      scenes: prior?.scenes ?? []
    };
    await db.repo('locations').upsert(loc.id, loc as never);
    saved.push(loc);
    await ctx.progress(0.2 + (i / source.length) * 0.6, `Designed ${name}`);
  }

  const wb = (res.json as any)?.world;
  if (wb) {
    const bible: WorldBible = {
      id: uid('wb'), projectId: p.id, era: String(wb.era ?? ''), geography: String(wb.geography ?? ''),
      rules: String(wb.rules ?? ''), moodBoard: String(wb.moodBoard ?? ''),
      colorScript: Array.isArray(wb.colorScript) ? wb.colorScript : []
    };
    await db.repo('worldBibles').upsert(bible.id, bible as never);
    await db.repo('projects').update(p.id, { worldBible: bible, updatedAt: nowIso() } as never);
  }
  await setStageState(p.id, 'world', 'ready');
  return { output: { locations: saved, demo: res.demo, model: res.model }, assetIds: [], creditsUsed: res.charged };
}

/* ── SCENE BREAKDOWN + SHOTS ──────────────────────────────── */
export async function runBreakdown(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { shotsPerScene?: number; regenerateShots?: boolean; presetId?: string };
  if (!p.screenplay?.elements?.length) throw Object.assign(new Error('No screenplay yet'), { code: 'missing_script', retryable: false });

  await ctx.progress(0.1, 'Breaking down scenes');
  const derived = scenesFromScript(p.screenplay);
  const characters = await db.repo('characters').findMany({ where: { projectId: p.id } }) as unknown as Character[];
  const locations = await db.repo('locations').findMany({ where: { projectId: p.id } }) as unknown as Location[];
  const existingScenes = await db.repo('scenes').findMany({ where: { projectId: p.id } }) as unknown as Scene[];
  const existingShots = await db.repo('shots').findMany({ where: { projectId: p.id } }) as unknown as Shot[];
  const presetId = input.presetId ?? presetForId(p.settings.style);

  // clear old (unless we're only refreshing shots)
  if (!input.regenerateShots) {
    await db.repo('shots').deleteWhere({ where: { projectId: p.id } } as never);
    await db.repo('scenes').deleteWhere({ where: { projectId: p.id } } as never);
  }

  const scenes: Scene[] = [];
  for (let i = 0; i < derived.length; i++) {
    const d = derived[i];
    const prior = existingScenes.find(s => s.index === i + 1);
    const loc = matchLocation({ ...d, locationName: d.locationName } as Scene, locations);
    const scene: Scene = {
      ...d, projectId: p.id, index: i + 1,
      locationId: loc?.id ?? null,
      locationName: loc?.name ?? d.locationName,
      characterIds: matchCharacterIds(d, characters),
      colorPalette: loc?.palette?.length ? loc.palette : synthPalette(hashSeed(`${p.id}-${i}-${d.heading}`), d.heading + d.action).slice(0, 6),
      emotion: d.emotion || 'tension',
      music: prior?.music ?? '',
      approved: prior?.approved ?? false,
      id: prior?.id ?? d.id
    };
    await db.repo('scenes').upsert(scene.id, scene as never);
    scenes.push(scene);
    await ctx.progress(0.15 + (i / derived.length) * 0.35, `Scene ${i + 1}: ${scene.heading}`);
  }

  await ctx.progress(0.55, 'Planning coverage');
  const allShots: Shot[] = [];
  for (const scene of scenes) {
    const loc = locations.find(l => l.id === scene.locationId) ?? null;
    const chars = characters.filter(c => scene.characterIds.includes(c.id) || scene.characterIds.some(id => id.toUpperCase() === c.name.toUpperCase()));
    const keep = existingShots.filter(s => s.sceneId === scene.id && (s.frameAssetId || s.videoAssetId) && !input.regenerateShots);
    let shots: Shot[];
    if (keep.length && !input.regenerateShots) {
      shots = keep;
      await ctx.log('info', `Scene ${scene.index}: kept ${keep.length} existing shot(s) with generated media`);
    } else {
      shots = generateShots(scene, { characters: chars, location: loc, style: p.settings.style, presetId, seed: hashSeed(`${p.id}-${scene.heading}`), negativePrompt: p.settings.negativePrompt });
      if (input.shotsPerScene) shots = shots.slice(0, Math.max(1, input.shotsPerScene));
    }
    for (const s of shots) {
      s.prompt = shotImagePrompt({ shot: s, scene, characters: chars, location: loc, style: p.settings.style, presetId, negative: p.settings.negativePrompt }).prompt;
      s.negativePrompt = p.settings.negativePrompt;
      await db.repo('shots').upsert(s.id, { ...s, sceneId: scene.id, projectId: p.id } as never);
      allShots.push(s);
    }
    await db.repo('scenes').update(scene.id, { shotIds: shots.map(s => s.id), durationSec: shots.reduce((a, s) => a + s.durationSec, 0) } as never);
  }

  await setStageState(p.id, 'scenes', 'ready');
  await setStageState(p.id, 'shots', 'ready');
  await ctx.log('info', `${scenes.length} scenes → ${allShots.length} shots (${allShots.reduce((a, s) => a + s.durationSec, 0).toFixed(1)}s of screen time)`);
  return { output: { scenes, shots: allShots, sceneCount: scenes.length, shotCount: allShots.length, runtimeSec: allShots.reduce((a, s) => a + s.durationSec, 0) }, assetIds: [], creditsUsed: 0 };
}

function matchCharacterIds(scene: Scene, characters: Character[]): string[] {
  if (!scene.characterIds.length) return [];
  const out: string[] = [];
  for (const raw of scene.characterIds) {
    const n = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const hit = characters.find(c => c.name.toUpperCase().replace(/[^A-Z0-9]/g, '') === n || n.includes(c.name.split(' ')[0].toUpperCase()));
    out.push(hit ? hit.id : raw);
  }
  return out;
}

function presetForId(style: string): string {
  const s = (style ?? '').toLowerCase();
  if (s.includes('anime')) return 'anime';
  if (s.includes('horror') || s.includes('dark')) return 'dark-horror';
  if (s.includes('sci')) return 'sci-fi';
  if (s.includes('fantasy')) return 'fantasy';
  if (s.includes('documentary')) return 'documentary';
  if (s.includes('commercial')) return 'commercial';
  if (s.includes('hollywood')) return 'hollywood';
  return 'cinematic-realism';
}

/* ── SHOT PROMPT REFRESH (video prompt building) ──────────── */
export function buildVideoPromptFor(shot: Shot, scene: Scene, characters: Character[], location: Location | null, style: string, motion: string) {
  return shotVideoPrompt({ shot, scene, characters, location, style, motion });
}

/* ── SOUND DESIGN ─────────────────────────────────────────── */
export async function runSoundDesign(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const scenes = await db.repo('scenes').findMany({ where: { projectId: p.id } }) as unknown as Scene[];
  if (!scenes.length) throw Object.assign(new Error('No scenes yet'), { code: 'missing_scenes', retryable: false, suggestion: 'Run the scene breakdown first — sound design reads it.' });
  await ctx.progress(0.2, 'Reading scene breakdown');
  const cues = designSound(scenes.sort((a, b) => a.index - b.index), { withScore: true, withAmbience: true, withFoley: true });
  const existing = await db.repo('sounds').findMany({ where: { projectId: p.id } }) as unknown as SoundCue[];
  // keep user edits: only replace auto-detected cues that have no generated audio
  const keep = existing.filter(c => !c.autoDetected || c.assetId);
  await db.repo('sounds').deleteWhere({ where: { projectId: p.id } } as never);
  for (const c of keep) await db.repo('sounds').upsert(c.id, c as never);
  for (const c of cues) await db.repo('sounds').create(c as never);
  await ctx.progress(0.9, `${cues.length} cues proposed`);
  await setStageState(p.id, 'sound', 'ready');
  return { output: { cues, count: cues.length, kept: keep.length }, assetIds: [], creditsUsed: 0 };
}

/* ── DIALOGUE LINES FROM SCRIPT ───────────────────────────── */
export async function runDialogueExtract(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  if (!p.screenplay?.elements?.length) throw Object.assign(new Error('No screenplay yet'), { code: 'missing_script', retryable: false });
  const characters = await db.repo('characters').findMany({ where: { projectId: p.id } }) as unknown as Character[];
  const scenes = await db.repo('scenes').findMany({ where: { projectId: p.id } }) as unknown as Scene[];
  const lines: VoiceLine[] = [];
  let sceneIdx = -1; let speaker: string | null = null;
  for (const el of p.screenplay.elements) {
    if (el.type === 'scene-heading') { sceneIdx++; speaker = null; continue; }
    if (el.type === 'character') { speaker = titleCase(el.text.replace(/\s*\(.*\)\s*$/, '')); continue; }
    if (el.type === 'dialogue' && speaker) {
      const scene = scenes[sceneIdx] ?? null;
      const ch = characters.find(c => c.name.toUpperCase() === speaker!.toUpperCase()) ?? null;
      lines.push({
        id: uid('vl'), projectId: p.id, sceneId: scene?.id ?? null, characterId: ch?.id ?? null,
        speaker, text: el.text.trim(), voiceId: ch?.voiceProfile ? voiceFromProfile(ch) : 'narrator',
        language: p.settings.language || 'en', emotion: emotionFor(scene, ch), speed: 1, pitch: 0,
        stability: 0.6, clarity: 0.78, assetId: null, status: 'none', take: 1, durationSec: 0, modelId: null, demo: false
      });
      speaker = null;
    }
  }
  const existing = await db.repo('voices').findMany({ where: { projectId: p.id } }) as unknown as VoiceLine[];
  const withAudio = existing.filter(v => v.assetId);
  await db.repo('voices').deleteWhere({ where: { projectId: p.id } } as never);
  for (const v of withAudio) await db.repo('voices').upsert(v.id, v as never);
  const keptIds = new Set(withAudio.map(v => `${v.speaker}|${v.text}`));
  for (const l of lines) if (!keptIds.has(`${l.speaker}|${l.text}`)) await db.repo('voices').create(l as never);
  await ctx.progress(0.9, `${lines.length} dialogue lines`);
  await setStageState(p.id, 'voice', 'ready');
  return { output: { lines, count: lines.length, kept: withAudio.length }, assetIds: [], creditsUsed: 0 };
}

function voiceFromProfile(c: Character): string {
  const t = c.voiceProfile.toLowerCase();
  if (/deep|low|resonant|baritone/.test(t)) return 'onyx';
  if (/bright|warm|female|soft/.test(t)) return 'nova';
  if (/clipped|precise|british/.test(t)) return 'george';
  return 'alloy';
}
function emotionFor(scene: Scene | null, ch: Character | null): string {
  if (scene?.emotion) return scene.emotion;
  if (ch?.arc && /grief|loss/.test(ch.arc.toLowerCase())) return 'grief';
  return 'neutral';
}

/* ── ASSEMBLE TIMELINE ────────────────────────────────────── */
export async function runAssemble(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { mode?: 'full' | 'trailer' | 'short30' | 'social'; grade?: string; addCaptions?: boolean; includeStills?: boolean; includeMusic?: boolean; transition?: string };
  await ctx.progress(0.1, 'Loading project media');
  const [scenes, shots, assets, voices, sounds] = await Promise.all([
    db.repo('scenes').findMany({ where: { projectId: p.id } }) as unknown as Promise<Scene[]>,
    db.repo('shots').findMany({ where: { projectId: p.id } }) as unknown as Promise<Shot[]>,
    db.repo('assets').findMany({ where: { projectId: p.id } }) as unknown as Promise<Asset2[]>,
    db.repo('voices').findMany({ where: { projectId: p.id } }) as unknown as Promise<VoiceLine[]>,
    db.repo('sounds').findMany({ where: { projectId: p.id } }) as unknown as Promise<SoundCue[]>
  ]) as [Scene[], Shot[], Asset2[], VoiceLine[], SoundCue[]];
  let tl = await loadTimeline(p.id, p.activeTimelineId ?? undefined);
  if (!tl) throw Object.assign(new Error('No timeline on this project'), { code: 'no_timeline', retryable: false });
  tl = JSON.parse(JSON.stringify(tl)) as Timeline;

  await ctx.progress(0.4, 'Placing shots on the spine');
  const res = assemble({ project: p, timeline: tl, scenes, shots, assets, voices, sounds, opts: { mode: input.mode ?? 'full', grade: (input.grade as never) ?? 'cinematic', addCaptions: input.addCaptions, includeStills: input.includeStills !== false, includeMusic: input.includeMusic !== false, transition: (input.transition as never) ?? 'cut' } });
  await ctx.progress(0.8, `Saving timeline (${res.timeline.durationSec.toFixed(1)}s)`);
  await saveTimeline(res.timeline);
  await db.repo('projects').update(p.id, { activeTimelineId: res.timeline.id, updatedAt: nowIso() } as never);
  for (const s of ['aiedit', 'editor', 'color'] as const) await setStageState(p.id, s, 'ready');
  for (const w of res.warnings) await ctx.log('warn', w);
  await ctx.log('info', `Placed ${res.placed} clip(s), skipped ${res.skipped}`);
  bus.publish({ type: 'project:update', projectId: p.id, patch: { activeTimelineId: res.timeline.id } });
  return { output: { timelineId: res.timeline.id, placed: res.placed, skipped: res.skipped, warnings: res.warnings, durationSec: res.timeline.durationSec }, assetIds: [], creditsUsed: 0 };
}
type Asset2 = import('@/types').Asset;

/* ── AI EDIT (proposed timeline ops) ──────────────────────── */
export async function runEditPlan(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { command: string; modelId?: string | null; presetId?: string | null };
  const tl = await loadTimeline(p.id, p.activeTimelineId ?? undefined);
  if (!tl) throw Object.assign(new Error('No timeline to edit'), { code: 'no_timeline', retryable: false, suggestion: 'Assemble the timeline first (AI Edit needs something to cut).' });
  const assets = await db.repo('assets').findMany({ where: { projectId: p.id } }) as unknown as Asset2[];
  const prompt = editPrompt(input.command, tl, assets.map(a => a.name));
  await ctx.progress(0.2, 'Reading the timeline');
  const res = await text({ job, ctx, task: 'edit-plan', prompt, system: SYSTEMS.edit, modelId: input.modelId, presetId: input.presetId, temperature: 0.35, maxTokens: 3000, meta: { command: input.command } });
  await ctx.progress(0.85, 'Validating operations');
  const plan = sanitisePlan(res.json, input.command, tl);
  const proposal: EditProposal = {
    id: uid('prop'), command: input.command, summary: plan.summary, rationale: plan.rationale,
    changes: plan.changes, credits: Number(plan.credits ?? 0) || 0, risky: Boolean(plan.risky),
    ops: plan.ops, createdAt: nowIso()
  };
  const followUps = plan.followUps ?? [];
  await db.repo('kv').upsert(`proposal:${proposal.id}`, { id: `proposal:${proposal.id}`, key: `proposal:${proposal.id}`, value: { ...proposal, projectId: p.id, demo: res.demo }, updatedAt: nowIso() } as never);
  for (const f of followUps) await ctx.log('warn', f);
  return { output: { proposal, followUps, notes: plan.notes ?? [], demo: res.demo, model: res.model, provider: res.provider }, assetIds: [], creditsUsed: res.charged };
}

/** Never let a model emit an op we don't implement or an id we don't have. */
function sanitisePlan(raw: unknown, command: string, tl: Timeline): { summary: string; rationale: string; ops: TimelineOp[]; changes: EditProposal['changes']; credits: number; risky: boolean; notes?: string[]; followUps?: string[] } {
  const o = (raw ?? {}) as any;
  const knownIds = new Set(tl.tracks.flatMap(t => t.clips.map(c => c.id)));
  const ALLOWED = new Set(['addClip', 'removeClip', 'updateClip', 'moveClip', 'splitClip', 'trimClip', 'addTrack', 'removeTrack', 'rippleDelete', 'setGrade', 'addMarker', 'retime', 'addTransition', 'sortTimeline']);

  // High-level intents ("tighten", "grade: noir", "condense") become real ops.
  const rawOps = (Array.isArray(o.ops) ? o.ops : []) as RawOp[];
  const highLevel = rawOps.filter(x => x && !ALLOWED.has(String(x.op)));
  const expanded = highLevel.length ? expandEditOps(highLevel, tl) : { ops: [], notes: [], followUps: [] };

  const ops: TimelineOp[] = [...expanded.ops];
  for (const op of rawOps) {
    if (!op || !ALLOWED.has(String(op.op))) continue;
    const c: any = { ...op };
    if (c.clipId && !knownIds.has(c.clipId)) continue;
    if (c.op === 'moveClip' || c.op === 'trimClip') c.start = clampNum(c.start, 0, 86400);
    if (c.op === 'trimClip' && c.duration != null) c.duration = clampNum(c.duration, 0.04, 3600);
    if (c.op === 'splitClip') c.at = clampNum(c.at, 0, tl.durationSec);
    if (c.op === 'retime') c.speed = clampNum(c.speed, 0.1, 8);
    if (c.op === 'setGrade') {
      const g: any = {};
      for (const k of ['exposure','contrast','highlights','shadows','whites','blacks','temperature','tint','saturation','vibrance','sharpness','fade','vignette','grain','lutAmount','splitBalance']) {
        if (typeof c.grade?.[k] === 'number') g[k] = clampNum(c.grade[k], -100, 100);
      }
      c.grade = g; c.scope = c.scope === 'clip' ? 'clip' : 'timeline';
    }
    ops.push(c as TimelineOp);
  }
  const changes = ops.slice(0, 40).map((op: any) => ({
    path: `timeline.${op.op}`, label: describeOp(op), from: undefined, to: op, kind: 'set' as const
  }));
  return {
    summary: String(o.summary ?? 'Applied the note').slice(0, 120),
    rationale: [String(o.rationale ?? ''), ...expanded.notes].filter(Boolean).join(' ').slice(0, 900),
    ops, changes,
    credits: clampNum(o.credits, 0, 100000),
    risky: Boolean(o.risky) || ops.some(op => ['removeClip', 'rippleDelete', 'removeTrack'].includes((op as any).op)),
    notes: expanded.notes,
    followUps: expanded.followUps
  };
}
function clampNum(v: unknown, lo: number, hi: number): number {
  const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}
function describeOp(op: any): string {
  switch (op.op) {
    case 'trimClip': return op.duration != null ? `Trim clip to ${Number(op.duration).toFixed(2)}s` : `Trim clip start to ${Number(op.start).toFixed(2)}s`;
    case 'moveClip': return `Move clip to ${Number(op.start).toFixed(2)}s`;
    case 'removeClip': return 'Remove clip';
    case 'rippleDelete': return 'Ripple delete clip';
    case 'splitClip': return `Split clip at ${Number(op.at).toFixed(2)}s`;
    case 'retime': return `Retime clip to ${Number(op.speed).toFixed(2)}×`;
    case 'setGrade': return `Adjust grade (${Object.keys(op.grade ?? {}).join(', ')})`;
    case 'addTransition': return `Add ${op.kind} transition (${Number(op.dur).toFixed(2)}s)`;
    case 'addMarker': return `Marker at ${Number(op.t).toFixed(2)}s — ${op.label}`;
    case 'addTrack': return `Add ${op.kind} track`;
    case 'addClip': return `Add clip at ${Number(op.start).toFixed(2)}s`;
    default: return String(op.op);
  }
}

/* ── COPILOT ──────────────────────────────────────────────── */
export async function runCopilot(job: GenerationJob, ctx: JobContext) {
  const p = await project(job);
  const db = await getDb();
  const input = job.input as { command: string; history?: { role: string; content: string }[]; modelId?: string | null };
  const [characters, locations, scenes, assets] = await Promise.all([
    db.repo('characters').findMany({ where: { projectId: p.id } }) as unknown as Promise<Character[]>,
    db.repo('locations').findMany({ where: { projectId: p.id } }) as unknown as Promise<Location[]>,
    db.repo('scenes').findMany({ where: { projectId: p.id } }) as unknown as Promise<Scene[]>,
    db.repo('assets').count({ where: { projectId: p.id } })
  ]) as [Character[], Location[], Scene[], number];
  const tl = await loadTimeline(p.id, p.activeTimelineId ?? undefined);
  const prompt = copilotPrompt(input.command, {
    projectName: p.name, stage: STAGE_META[p.stage]?.label ?? p.stage,
    story: p.story, characters, locations, scenes, timeline: tl, assets
  });
  const res = await text({ job, ctx, task: 'copilot', prompt, system: SYSTEMS.edit, modelId: input.modelId, temperature: 0.5, maxTokens: 2000, meta: { command: input.command, ctx: { projectName: p.name, stage: p.stage, counts: { characters: characters.length, locations: locations.length, scenes: scenes.length, assets } } } });
  const plan = sanitisePlan(res.json, input.command, tl ?? { tracks: [], markers: [], durationSec: 0 } as unknown as Timeline);
  const o = (res.json ?? {}) as any;
  return {
    output: {
      reply: String(o.reply ?? res.text ?? 'I can help with that.'),
      willModify: Array.isArray(o.willModify) ? o.willModify : plan.changes.map(c => ({ target: c.path, change: c.label })),
      ops: plan.ops, stageOps: Array.isArray(o.stageOps) ? o.stageOps.slice(0, 20) : [],
      credits: plan.credits, risky: plan.risky, demo: res.demo,
      context: { timeline: tl ? timelineSummary(tl, { maxClips: 20 }) : 'no timeline yet', characters: characters.length, scenes: scenes.length }
    },
    assetIds: [], creditsUsed: res.charged
  };
}

/* ── analysis: describe an asset (vision) ─────────────────── */
export async function runAnalysis(job: GenerationJob, ctx: JobContext) {
  const input = job.input as { prompt: string; refs?: { key?: string; url?: string; mime?: string }[]; modelId?: string | null };
  const decision = await route({ userId: job.userId, kind: 'text', capability: 'vision', modelId: input.modelId, strategy: 'quality', allowDemo: true });
  const result = await execute({
    kind: 'text', modelId: decision.model.driverModel, prompt: input.prompt,
    referenceImages: input.refs ?? [], text: { temperature: 0.3, maxTokens: 1200 }
  }, { jobId: job.id, userId: job.userId, signal: ctx.signal, route: decision, onProgress: (p2, s) => void ctx.progress(p2, s) });
  return { output: { text: result.text ?? '', json: result.json ?? null, demo: result.demo, model: result.modelId }, assetIds: [], creditsUsed: 0 };
}

export const STAGE_LIST = STAGES;
export const DEFAULT_TIMELINE_GRADE = DEFAULT_GRADE;
export { presetFor, shotImagePrompt, rng };
