import type { Character, Idea, Location, Scene, Shot, Story, Timeline, Clip, VoiceLine } from '@/types';
import { IMAGE_PRESETS } from '../ai/registry';

/**
 * Prompt construction.
 *
 * The single most important rule in the file: any prompt that depicts a
 * character or a location automatically carries that entity's *identity
 * prompt*, so consistency survives across shots, scenes and models. Users
 * never have to remember to re-describe Alex.
 */

export const STYLE_DIRECTIVES: Record<string, string> = {
  cinematic: 'cinematic film still, anamorphic, natural volumetric light, 35mm grain, shallow depth of field, filmic colour grade',
  hollywood: 'big-budget feature cinematography, dramatic key light, deep contrast, halation, meticulous production design',
  anime: 'high-detail anime key visual, cel shading, expressive linework, cinematic background art',
  stylized: 'stylised painterly illustration, bold shapes, limited palette, art-directed',
  horror: 'dread-filled horror frame, near-black shadows, one practical source, desaturated, unsettling negative space, 16mm grain',
  scifi: 'hard science-fiction frame, believable technology, atmospheric haze, cold industrial palette',
  fantasy: 'epic fantasy matte-painting quality, mythic scale, golden-hour god rays',
  documentary: 'observational documentary frame, available light, handheld realism, unposed, natural colour',
  commercial: 'premium commercial photography, crisp product lighting, immaculate surfaces, high-key',
  noir: 'neo-noir frame, hard chiaroscuro, venetian-blind shadows, sodium and neon spill',
  vintage: 'period film look, faded emulsion, warm halation, soft contrast, 70s palette'
};

export function styleDirective(style: string): string {
  const key = Object.keys(STYLE_DIRECTIVES).find(k => style.toLowerCase().includes(k));
  return key ? STYLE_DIRECTIVES[key] : (style ? `${style} visual style` : STYLE_DIRECTIVES.cinematic);
}

export function presetFor(id: string) { return IMAGE_PRESETS.find(p => p.id === id) ?? IMAGE_PRESETS[0]; }

/* ── story ──────────────────────────────────────────────────── */
export const STORY_SYSTEM = `You are a senior story editor and screenwriter for film and television.
You output STRICT JSON matching the requested schema — no prose outside the JSON, no markdown fences.
You build stories that are dramatically sound: a protagonist with a want and a need, escalating
complications, a midpoint reversal, and an ending that is earned rather than convenient.
Prefer concrete, filmable beats over abstract summary. Every beat must be something a camera can show.`;

export function storyPrompt(idea: Idea, opts: { darker?: boolean; emotional?: boolean; twist?: boolean; cinematic?: boolean; pacing?: boolean; alternateEnding?: boolean } = {}) {
  const mods: string[] = [];
  if (opts.darker) mods.push('Push the tone materially darker: raise the stakes, make the cost of the central choice physical and moral, and remove any unearned comfort.');
  if (opts.emotional) mods.push('Deepen the emotional register: give the protagonist a specific grief or longing, and make at least two beats land as intimacy rather than plot.');
  if (opts.twist) mods.push('Introduce a genuine reversal in Act 2 that recontextualises Act 1 — the twist must be fair, set up by information already on the page.');
  if (opts.cinematic) mods.push('Think in images: every beat should specify what the audience SEES, not what they learn.');
  if (opts.pacing) mods.push('Fix the pacing: shorten Act 1, give Act 2 two distinct accelerations, and make Act 3 the shortest and most propulsive.');
  if (opts.alternateEnding) mods.push('Replace the ending with a different but equally earned resolution — change the outcome, not the theme.');

  return `${mods.length ? mods.join('\n') + '\n\n' : ''}Develop the following idea into a complete story structure.

IDEA
${idea.text || '(not supplied — invent one consistent with the fields below)'}

GENRE: ${idea.genre || 'unspecified'}
TONE: ${idea.tone || 'unspecified'}
THEME: ${idea.theme || 'unspecified'}
SETTING: ${idea.setting || 'unspecified'}
CONFLICT: ${idea.conflict || 'unspecified'}
CHARACTERS: ${idea.characters || 'to be created'}
VISUAL STYLE: ${idea.visualStyle || 'cinematic'}
TIME PERIOD: ${idea.timePeriod || 'contemporary'}
AUDIENCE: ${idea.audience || 'adult'}
TARGET DURATION: ${idea.duration || 'short film'}
PACING: ${idea.pacing || 'deliberate'}
REQUESTED ENDING: ${idea.ending || 'author\'s choice'}

Return JSON exactly in this shape:
{
  "title": string,
  "logline": string,                       // one sentence, <= 45 words
  "premise": string,                       // 3-5 sentences
  "acts": [
    { "name": "ACT 1", "beats": [ { "text": string, "emotion": string, "location": string } ] },
    { "name": "ACT 2", "beats": [ ... ] },
    { "name": "ACT 3", "beats": [ ... ] }
  ],
  "themes": string[],
  "ending": string,
  "tone": string,
  "genre": string
}
Each act must have exactly 3 beats. Beat text must be concrete and filmable.`;
}

/* ── screenplay ─────────────────────────────────────────────── */
export const SCRIPT_SYSTEM = `You are a professional screenwriter. You write in standard screenplay format.
You output STRICT JSON — an ordered array of screenplay elements — with no markdown fences and no commentary.
Dialogue must sound like people, not like exposition. Action lines describe only what is visible and audible.
Use camera direction sparingly and only where it changes meaning.`;

export function scriptPrompt(story: Story, characters: Character[], locations: Location[], opts: { sceneCount?: number; darker?: boolean; tension?: boolean; camera?: boolean; cinematic?: boolean; dialogue?: boolean; expand?: boolean; shorten?: boolean; visual?: boolean; characterDepth?: boolean } = {}) {
  const mods: string[] = [];
  if (opts.darker) mods.push('Darken the material: reduce safety, increase consequence, cut comic relief.');
  if (opts.tension) mods.push('Add tension: withhold information, use silence, let scenes end before resolution.');
  if (opts.camera) mods.push('Add precise camera direction elements where the shot choice carries meaning.');
  if (opts.cinematic) mods.push('Make it more cinematic: replace talk with behaviour, prefer image over explanation.');
  if (opts.dialogue) mods.push('Rewrite the dialogue: subtext over statement, distinct voices, no on-the-nose lines.');
  if (opts.expand) mods.push('Expand: add scenes that deepen character and world without padding the plot.');
  if (opts.shorten) mods.push('Shorten aggressively: keep only scenes that change something. Merge or cut the rest.');
  if (opts.visual) mods.push('Add visual detail to every action line: texture, light, temperature, objects that carry meaning.');
  if (opts.characterDepth) mods.push('Improve character: give each speaker a contradiction, and let behaviour disagree with dialogue.');

  return `${mods.length ? mods.join('\n') + '\n\n' : ''}Write a complete screenplay from this story.

TITLE: ${story.title}
LOGLINE: ${story.logline}
PREMISE: ${story.premise}

BEATS
${story.acts.map(a => `${a.name}\n${a.beats.map(b => `  - ${b.text} (${b.emotion}; ${b.location})`).join('\n')}`).join('\n')}

ENDING: ${story.ending}

CHARACTERS (use these exact names)
${characters.length ? characters.map(c => `- ${c.name} (${c.role}, ${c.age}): ${c.personality}`).join('\n') : '- to be invented; keep the cast to 2-4 speaking roles'}

LOCATIONS (reuse these; only add new ones if the story demands it)
${locations.length ? locations.map(l => `- ${l.name}: ${l.description}`).join('\n') : '- derive from the beats'}

Target length: ${opts.sceneCount ?? 6} scenes.

Return JSON exactly:
{
  "title": string,
  "logline": string,
  "elements": [
    { "type": "scene-heading"|"action"|"character"|"dialogue"|"parenthetical"|"transition"|"camera"|"shot"|"note",
      "text": string,
      "meta": { "intExt": "INT."|"EXT."|"INT./EXT.", "location": string, "time": string }   // scene-heading only
    }
  ]
}
Rules: every scene starts with a scene-heading "INT./EXT. LOCATION — TIME OF DAY".
Character elements are UPPERCASE names. Dialogue follows its character element.
Use transitions only at scene boundaries. Do not include scene numbers.`;
}

/* ── characters & locations ─────────────────────────────────── */
export const CAST_SYSTEM = `You are a casting director and character designer. You output STRICT JSON, no fences.
Every character gets a durable identity description precise enough that any image model reproduces the same
person across shots: age, build, face, hair, skin, distinguishing marks, wardrobe with colours and fabrics.`;

export function castPrompt(scriptText: string, story: Story) {
  return `Extract every speaking and visually significant character from this screenplay and design them.

STORY: ${story.logline}

SCREENPLAY
${scriptText.slice(0, 14000)}

Return JSON:
{
  "characters": [
    {
      "name": string,                     // as written in the script
      "role": "protagonist"|"antagonist"|"deuteragonist"|"mentor"|"supporting"|"catalyst"|"foil",
      "age": string,
      "description": string,              // 2-3 sentences: who they are and what they carry
      "personality": string,
      "wardrobe": string,                 // specific garments, colours, fabrics, wear
      "physical": string,                 // build, face, hair, skin, distinguishing marks
      "voiceProfile": string,             // pitch, pace, accent, texture — for TTS direction
      "arc": string,                      // where they start and where they end
      "identityPrompt": string            // ONE dense visual paragraph, model-agnostic, no name needed
    }
  ]
}
Keep the cast to the characters who actually appear. identityPrompt must be reusable verbatim in any image prompt.`;
}

export const WORLD_SYSTEM = `You are a production designer and location scout. You output STRICT JSON, no fences.
Locations must be concrete and consistent: architecture, materials, light behaviour, weather, colour palette, props.`;

export function worldPrompt(scriptText: string, story: Story) {
  return `Extract every distinct location from this screenplay and design it for production.

STORY: ${story.logline}

SCREENPLAY
${scriptText.slice(0, 14000)}

Return JSON:
{
  "locations": [
    {
      "name": string,                     // matches the slug line, e.g. "APARTMENT"
      "description": string,
      "architecture": string,             // structure, materials, period, scale
      "timeOfDay": string,
      "lighting": string,                 // sources, direction, quality, colour temperature
      "weather": string,
      "palette": string[],                // 5-7 hex colours
      "props": string[],                  // 4-8 story-relevant objects
      "identityPrompt": string            // ONE dense visual paragraph, reusable in any image prompt
    }
  ],
  "world": {
    "era": string, "geography": string, "rules": string,
    "moodBoard": string,
    "colorScript": [ { "scene": string, "palette": string[] } ]
  }
}
Deduplicate: one entry per distinct location, not per scene.`;
}

/* ── shots ──────────────────────────────────────────────────── */
export function shotImagePrompt(input: {
  shot: Shot; scene: Scene; characters: Character[]; location: Location | null;
  style: string; presetId: string; extra?: string; negative?: string;
}): { prompt: string; negative: string } {
  const { shot, scene, characters, location, style } = input;
  const preset = presetFor(input.presetId);
  const parts: string[] = [];

  parts.push(`${shot.size} shot, ${shot.lens}`);
  if (shot.angle && shot.angle !== 'Eye level') parts.push(shot.angle.toLowerCase());
  parts.push(shot.description || scene.action || scene.heading);

  for (const c of characters.slice(0, 3)) {
    if (c.identityPrompt) parts.push(`CHARACTER [${c.token}]: ${c.identityPrompt}`);
  }
  if (location?.identityPrompt) parts.push(`LOCATION [${location.token}]: ${location.identityPrompt}`);
  else if (scene.lighting) parts.push(scene.lighting);

  parts.push(`${scene.timeOfDay ? scene.timeOfDay.toUpperCase() + ' — ' : ''}${shot.lighting || scene.lighting || preset.label.toLowerCase()} lighting`);
  if (scene.emotion) parts.push(`mood: ${scene.emotion}`);
  parts.push(styleDirective(style));
  parts.push(preset.prompt);
  if (input.extra) parts.push(input.extra);

  const negative = [
    preset.negative,
    input.negative ?? '',
    'inconsistent character, different face, extra limbs, morphed hands, watermark, signature, subtitles, text overlay, logo, frame border'
  ].filter(Boolean).join(', ');

  return { prompt: parts.filter(Boolean).join('. ').replace(/\.\s*\./g, '.').replace(/\s{2,}/g, ' '), negative };
}

export function shotVideoPrompt(input: { shot: Shot; scene: Scene; characters: Character[]; location: Location | null; style: string; motion?: string }): string {
  const { shot, scene, characters, location, style } = input;
  const parts = [
    `${shot.size}, ${shot.lens}, camera move: ${shot.move}`,
    shot.description || scene.action,
    characters[0]?.identityPrompt ? `subject: ${characters[0].identityPrompt}` : '',
    location?.identityPrompt ? `environment: ${location.identityPrompt}` : '',
    `${scene.timeOfDay} — ${shot.lighting || scene.lighting || 'natural light'}`,
    motionLanguage(input.motion ?? 'Cinematic'),
    styleDirective(style),
    'continuous single take, physically plausible motion, no morphing, no identity drift, no text'
  ];
  return parts.filter(Boolean).join('. ');
}

export function motionLanguage(motion: string): string {
  const m = motion.toLowerCase();
  if (m.includes('subtle')) return 'minimal motion, locked-off frame, only ambient movement (breath, cloth, dust, light)';
  if (m.includes('dynamic')) return 'high-energy motion, decisive camera movement, fast subject movement';
  if (m.includes('handheld')) return 'handheld camera, organic micro-shake, reactive framing';
  if (m.includes('slow')) return 'extremely slow motion, 48fps feel, languid drift';
  if (m.includes('dream')) return 'dreamlike motion, soft focus breathing, floating camera, smeared highlights';
  if (m.includes('action')) return 'action-cinema motion, whip and snap, impact-driven framing';
  return 'cinematic motion, motivated camera movement, steady and deliberate';
}

export function voiceDirection(line: VoiceLine, character: Character | null): string {
  const bits = [
    character?.voiceProfile || line.voiceId,
    line.emotion && line.emotion !== 'neutral' ? `${line.emotion} delivery` : 'neutral delivery',
    line.speed !== 1 ? `pace ${Math.round(line.speed * 100)}%` : '',
    line.pitch ? `pitch ${line.pitch > 0 ? '+' : ''}${line.pitch}` : '',
    character ? `You are ${character.name}: ${character.personality}.` : ''
  ].filter(Boolean);
  return bits.join('; ');
}

export function sfxPrompt(name: string, description: string, durationSec: number): string {
  return `${name}: ${description}. Duration ${durationSec.toFixed(1)}s. Dry, cinematic sound design, no music, no dialogue, clean transient, film-quality fidelity.`;
}

/* ── AI edit / copilot ──────────────────────────────────────── */
export const EDIT_SYSTEM = `You are a professional film editor working inside a non-linear editor.
You are given a precise JSON description of the current timeline. You output STRICT JSON — a list of
operations — with no prose outside the JSON. You make the SMALLEST change that achieves the note,
you never destroy work, and you never invent media that does not exist in the timeline.
Available ops: addClip, removeClip, updateClip, moveClip, splitClip, trimClip, addTrack, removeTrack,
rippleDelete, setGrade, addMarker, retime, addTransition, sortTimeline.`;

export function timelineSummary(tl: Timeline, opts: { maxClips?: number } = {}): string {
  const max = opts.maxClips ?? 60;
  const lines = tl.tracks.map(t => {
    const clips = t.clips.slice(0, max).map(c =>
      `    { id:"${c.id}", kind:"${c.kind}", name:"${c.name.replace(/"/g, "'")}", start:${c.start.toFixed(2)}, duration:${c.duration.toFixed(2)}, speed:${c.speed}, in:${c.in.toFixed(2)}, out:${c.out.toFixed(2)} }`).join('\n');
    return `  track "${t.name}" (${t.kind}, index ${t.index}, muted:${t.muted}):\n${clips || '    (empty)'}`;
  });
  return `timeline "${tl.name}" ${tl.width}x${tl.height} @${tl.fps}fps, duration ${tl.durationSec.toFixed(2)}s\n${lines.join('\n')}`;
}

export function editPrompt(command: string, tl: Timeline, assetNames: string[]): string {
  return `EDITOR'S NOTE
"${command}"

CURRENT TIMELINE
${timelineSummary(tl)}

AVAILABLE MEDIA (names only; you may reference existing clips)
${assetNames.slice(0, 60).map(n => `- ${n}`).join('\n') || '(none)'}

Return JSON exactly:
{
  "summary": string,             // <= 12 words, what you did
  "rationale": string,           // 1-2 sentences, why this serves the note
  "credits": number,             // extra generation cost your plan requires (0 if it only rearranges)
  "risky": boolean,              // true if anything is removed or replaced
  "ops": [ { "op": "<op name>", ...params } ]
}
Constraints: reference only clip ids listed above; times in seconds; do not exceed the timeline duration.`;
}

export function copilotPrompt(command: string, ctx: {
  projectName: string; stage: string; story?: Story | null; characters: Character[];
  locations: Location[]; scenes: Scene[]; timeline?: Timeline | null; assets: number;
}): string {
  return `You are the AI copilot for the project "${ctx.projectName}", currently at the ${ctx.stage} stage.

CONTEXT
${ctx.story ? `Story: ${ctx.story.logline}\n` : ''}Characters: ${ctx.characters.map(c => c.name).join(', ') || 'none yet'}
Locations: ${ctx.locations.map(l => l.name).join(', ') || 'none yet'}
Scenes: ${ctx.scenes.length ? ctx.scenes.map(s => `${s.index}. ${s.heading}`).join(' | ') : 'none yet'}
Timeline: ${ctx.timeline ? `${ctx.timeline.tracks.length} tracks, ${ctx.timeline.durationSec.toFixed(1)}s` : 'not built yet'}
Assets generated: ${ctx.assets}

USER REQUEST
"${command}"

Respond with JSON:
{
  "reply": string,                       // 1-3 sentences, plain language, no fluff
  "willModify": [ { "target": string, "change": string } ],   // human-readable list of what changes
  "ops": [ { "op": "...", ...params } ],                      // timeline ops, empty if none
  "stageOps": [ { "entity": "scene"|"character"|"location"|"shot"|"idea"|"story", "id": string|null, "patch": object } ],
  "credits": number,
  "risky": boolean
}
Never propose destroying existing work without offering a versioned alternative.`;
}
