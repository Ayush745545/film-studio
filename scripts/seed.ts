/**
 * Seed a complete, fully-generated demo project.
 *
 *   npm run seed            # then: npm run dev  →  open the project
 *
 * Runs the real pipeline against the real database and object storage using
 * the built-in Demo Studio Engine, so you can open AI Film Studio and see a
 * finished production — story, screenplay, cast with locked identities, world,
 * scenes, storyboard plates, motion, dialogue, sound design, an assembled and
 * graded timeline, and exported stems — without configuring a single API key.
 *
 * Nothing here is mocked: every asset on disk was produced by the same code
 * paths the UI uses.
 */
import { getDb } from '../src/lib/db';
import { ensureBooted } from '../src/lib/boot';
import { enqueue, waitForJob } from '../src/lib/queue';
import { ensureLocalUser } from '../src/lib/security/auth';
import { getSubscription } from '../src/lib/credits';
import { seedRegistry } from '../src/lib/ai/seed';
import { createProject, getProject, getScenes, getShots, getCharacters, getLocations, getVoices, getSounds } from '../src/lib/project';
import { shotImagePrompt, shotVideoPrompt, sfxPrompt, presetFor } from '../src/lib/domain/prompts';
import { syncDb } from '../src/lib/db';
import type { Character, Location, Scene, Shot, SoundCue, VoiceLine } from '../src/types';

const log = (m: string) => console.log(`  ${m}`);

async function run(userId: string, projectId: string, kind: any, label: string, input: Record<string, unknown>) {
  const job = await enqueue({ userId, projectId, kind, label, input: { projectId, ...input }, stage: input.stage as never });
  const done = await waitForJob(job.id, 20 * 60_000);
  if (done.status !== 'succeeded') throw new Error(`${label} → ${done.status}: ${done.error?.message ?? ''}`);
  log(`✓ ${label}`);
  return done;
}

async function main() {
  await ensureBooted();
  await seedRegistry();
  const user = await ensureLocalUser();
  await getSubscription(user.id);
  const db0 = await getDb(); void db0;
  console.log('\nAI Film Studio — seeding a complete demo project\n');

  const project = await createProject(user.id, {
    name: 'The Last Memory',
    type: 'short-film',
    description: 'A sound archivist restoring a damaged tape hears a conversation that was never recorded.',
    tags: ['demo', 'neo-noir', 'seeded'],
    settings: { type: 'short-film', format: '2.39:1', durationSec: 72, style: 'Cinematic', presetId: null, fps: 24, resolution: '1080p', language: 'en', seed: 20260924, negativePrompt: 'watermark, text, logo, deformed hands, extra limbs, blurry', motionStyle: 'Cinematic', autoApprove: false },
    idea: {
      text: 'A sound archivist restoring a damaged reel-to-reel tape hears a conversation that, according to every record she has, was never recorded. The longer she listens, the more clearly she recognises her own voice answering.',
      genre: 'neo-noir thriller', tone: 'dread, restrained', theme: 'memory as a form of debt',
      setting: 'a coastal city in winter, mostly interiors and wet streets', conflict: 'what she wants to believe cannot coexist with what she is responsible for preserving',
      characters: 'Rae Nakamura, archivist. Wren Keller, the donor who brought the tape in.',
      visualStyle: 'long lenses compressing space, practical sources only, negative fill',
      timePeriod: 'contemporary', audience: 'adult festival audience', duration: '70 seconds',
      ending: 'She keeps the tape, and the archive keeps her.', pacing: 'slow burn with two accelerations'
    }
  });
  log(`created project ${project.id}`);

  await run(user.id, project.id, 'story', 'Story', { idea: project.idea });
  await run(user.id, project.id, 'script', 'Screenplay', { sceneCount: 5 });
  await run(user.id, project.id, 'cast', 'Characters', {});
  await run(user.id, project.id, 'world', 'World & locations', {});
  await run(user.id, project.id, 'breakdown', 'Scene breakdown', { shotsPerScene: 4 });

  // Approve the cast and lock identities, as a real production would.
  const db = await getDb();
  const chars = await db.repo('characters').findMany({ where: { projectId: project.id } });
  for (const c of chars as any[]) await db.repo('characters').update(c.id, { approved: true, locked: true } as never);
  log(`✓ approved + locked ${chars.length} character identities`);

  // Storyboard plates: one image job per shot, built exactly as the API builds them.
  const [scenes, shots, characters, locations] = await Promise.all([
    getScenes(project.id), getShots(project.id), getCharacters(project.id), getLocations(project.id)
  ]);
  const preset = presetFor('cinematic-realism');
  for (const shot of shots) {
    const scene = scenes.find((s: Scene) => s.id === shot.sceneId);
    if (!scene) continue;
    const chars = characters.filter((c: Character) => scene.characterIds.some(id => id === c.id || id.toUpperCase() === c.name.toUpperCase())).slice(0, 3);
    const loc = locations.find((l: Location) => l.id === scene.locationId) ?? null;
    const built = shotImagePrompt({ shot, scene, characters: chars, location: loc, style: 'Cinematic', presetId: 'cinematic-realism' });
    await run(user.id, project.id, 'image', `Plate · SC${String(scene.index).padStart(2, '0')} SH${String(shot.index).padStart(2, '0')}`, {
      request: {
        kind: 'image', modelId: '', prompt: built.prompt, negativePrompt: built.negative,
        aspectRatio: '2.39:1', resolution: '1080p', seed: shot.seed, steps: preset.steps, guidance: preset.guidance, count: 1,
        meta: { shotSize: shot.size, lens: shot.lens, lighting: scene.lighting, label: `SC ${scene.index} / SH ${shot.index}`, sublabel: `${shot.size} · ${shot.lens} · ${shot.move}`, palette: scene.colorPalette, characterSilhouette: true }
      },
      target: { kind: 'shot-frame', id: shot.id },
      name: `SC${String(scene.index).padStart(2, '0')}_SH${String(shot.index).padStart(2, '0')}_${shot.size.replace(/\s+/g, '')}`,
      tags: ['storyboard', `scene-${scene.index}`], stage: 'storyboard'
    });
  }
  log(`✓ ${shots.length} storyboard plates rendered`);
  for (const s of shots) await db.repo('shots').update(s.id, { frameStatus: 'approved' } as never);
  log(`✓ approved ${shots.length} storyboard frames`);

  // Motion for the first three shots, using the approved plate as the start frame.
  for (const shot of shots.slice(0, 3)) {
    const scene = scenes.find((s: Scene) => s.id === shot.sceneId)!;
    const chars = characters.filter((c: Character) => scene.characterIds.some(id => id === c.id)).slice(0, 2);
    const loc = locations.find((l: Location) => l.id === scene.locationId) ?? null;
    const fresh = await db.repo('shots').findUnique(shot.id) as unknown as Shot;
    const startFrame = fresh?.frameAssetId
      ? { key: ((await db.repo('assets').findUnique(fresh.frameAssetId)) as any)?.storageKey }
      : undefined;
    await run(user.id, project.id, 'video', `Motion · SC SH${shot.index}`, {
      request: {
        kind: 'video', modelId: '', prompt: shotVideoPrompt({ shot, scene, characters: chars, location: loc, style: 'Cinematic', motion: 'Cinematic' }),
        negativePrompt: 'watermark, text, morphing, identity drift',
        aspectRatio: '2.39:1', resolution: '1080p', durationSec: Math.min(6, shot.durationSec),
        seed: shot.seed, motion: 'Cinematic', camera: shot.move, startFrame,
        meta: { shotSize: shot.size, lens: shot.lens, lighting: scene.lighting, label: `SC ${scene.index} / SH ${shot.index}`, fps: 24 }
      },
      target: { kind: 'shot-video', id: shot.id }, name: `SC_SH${shot.index}_motion`, tags: ['shot', 'video'], stage: 'video'
    });
  }

  await run(user.id, project.id, 'dialogue', 'Dialogue lines', {});
  const voices = await getVoices(project.id);
  for (const line of voices) {
    const ch = characters.find((c: Character) => c.id === line.characterId) ?? null;
    await run(user.id, project.id, 'voice', `Take · ${line.speaker}`, {
      request: { kind: 'voice', modelId: '', prompt: line.text, voice: { voiceId: line.voiceId, language: 'en', emotion: line.emotion, speed: 1, pitch: 0, stability: 0.6, clarity: 0.78 }, meta: { speaker: line.speaker, characterToken: ch?.token } },
      target: { kind: 'voice-line', id: line.id }, name: `${line.speaker.toLowerCase().replace(/\W+/g, '_')}_take${line.take + 1}`, tags: ['dialogue'], stage: 'voice'
    });
  }
  log(`✓ ${voices.length} dialogue takes`);

  await run(user.id, project.id, 'sound-design', 'Sound design', {});
  const cues = await getSounds(project.id);
  for (const cue of cues) {
    const kind = cue.kind === 'score' || cue.kind === 'music' ? 'music' : 'sfx';
    await run(user.id, project.id, kind, `Cue · ${cue.name}`, {
      request: { kind, modelId: '', prompt: sfxPrompt(cue.name, cue.description || cue.prompt, cue.durationSec), durationSec: cue.durationSec, audio: { intensity: cue.kind === 'score' ? 0.9 : 1 } },
      target: { kind: 'sound-cue', id: cue.id }, name: cue.name.toLowerCase().replace(/\W+/g, '_'), tags: ['sound', cue.kind], stage: 'sound', localSynth: true
    });
  }
  log(`✓ ${cues.length} sound cues synthesised`);
  await run(user.id, project.id, 'assembly', 'Assemble timeline', { mode: 'full', grade: 'cinematic', addCaptions: false, stage: 'aiedit' });
  await run(user.id, project.id, 'stems', 'Export stems', { engine: 'stems', label: 'Stems (seeded)', stage: 'export' });

  const fin = await getProject(project.id);
  const assets = await db.repo('assets').count({ where: { projectId: project.id } });
  const tl = await db.repo('timelines').findFirst({ where: { projectId: project.id } }) as any;
  console.log(`\nSeeded "${fin?.name}" (${project.id})`);
  console.log(`  ${assets} assets · ${shots.length} shots · timeline ${tl?.durationSec?.toFixed(1)}s · rev ${fin?.rev}\n`);
  console.log('Start the app and open it:');
  console.log(`  npm run dev      →  http://localhost:3000/project/${project.id}\n`);
  await syncDb();
  process.exit(0);
}

main().catch(err => { console.error('\nseed failed:', err.message); process.exit(1); });
