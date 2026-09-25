import { rng, hashSeed, pick } from '../ids';
import type { Idea } from '@/types';

/**
 * Demo Studio Engine.
 *
 * A deterministic, offline generative engine that produces genuinely usable
 * structured creative material (story, screenplay, characters, locations,
 * shot prompts, edit plans) plus real rendered media (SVG plates, synthesised
 * audio, procedural motion). Everything it emits is flagged `demo: true` and
 * every rendered asset carries a visible "DEMO · NOT AI" badge, so the app is
 * never mistaken for having called a paid model.
 *
 * It exists for three reasons: the product must be usable before any API key
 * is configured, the whole pipeline must be testable end-to-end offline, and
 * it provides the deterministic fallback that keeps the router honest.
 */

type R = () => number;
const cap = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const list = (r: R, arr: readonly string[], n: number) => {
  const out: string[] = []; const pool = arr.slice();
  for (let i = 0; i < n && pool.length; i++) out.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  return out;
};

const NAME_FIRST = ['Alex','Mara','Idris','Noor','Elias','Yuki','Tomas','Rae','Kian','Ada','Silas','Ines','Bo','Wren','Cassius','Odile','Milo','Thandi','Jonah','Vera'];
const NAME_LAST = ['Mercer','Okafor','Vance','Lindqvist','Reyes','Ashford','Nakamura','Duarte','Keller','Bright','Sorel','Fenn','Moreau','Ilves','Quaid','Osei','Varga','Hale'];
const ROLES = ['protagonist','antagonist','deuteragonist','mentor','catalyst','foil','witness'];

const GENRE_BEATS: Record<string, string[]> = {
  thriller: ['A routine decision leaves a trace someone else is following','The first warning arrives disguised as a kindness','An ally proves to be an instrument of the opposition','The safe place is where the trap was built','Everything the protagonist believed about the incident is reframed'],
  drama: ['A small want collides with an old obligation','The truth is told halfway, and lands wrong','An attempt at repair makes the wound more visible','Someone chooses honesty over comfort and pays for it','The relationship is redefined, not restored'],
  horror: ['The house keeps a rule no one explains','Something is counted twice and does not match','A witness recants, then disappears','The protection fails in the exact way it was designed to','What was buried is not dead, only patient'],
  'sci-fi': ['A system behaves as if it has preferences','The crew learns the mission was never what they were told','A workaround creates a second, worse problem','First contact is administrative, not awe','The cost of the solution is a person'],
  fantasy: ['An inheritance is refused and then needed','The map is wrong in a way that matters','A bargain is struck in a language nobody speaks','The old power answers, and asks for a name','The kingdom is saved by something small'],
  romance: ['Two people are forced to share a task they both resent','A confession is rehearsed and never delivered','An old love returns with better arguments','A misunderstanding is protected because it is comfortable','They choose each other in front of witnesses'],
  documentary: ['The archive contradicts the official account','A subject agrees to speak, then sets conditions','The filmmaker becomes part of the story','A second perspective refuses to be edited out','The question changes shape during production'],
  action: ['A delivery goes wrong in public','The team is assembled from people who owe each other nothing','A plan survives first contact for eleven seconds','The escape route is the trap','The objective is revealed to be a person'],
  comedy: ['A lie is told to avoid a smaller lie','The workaround requires an accomplice','Everyone converges on the same wrong assumption','The truth arrives at the worst possible moment','The apology is worse than the offence']
};
const FALLBACK_BEATS = ['An ordinary arrangement is disturbed','The disturbance is misread as an opportunity','A choice is made that cannot be unmade','The consequence arrives through someone unexpected','A new arrangement is negotiated, at a price'];

const VISUAL_LANGS = [
  'long lenses compressing space, practical sources only, negative fill',
  'wide anamorphic frames with deliberate headroom, cool shadows',
  'handheld close coverage, available light, minimal coverage cuts',
  'symmetrical single-take compositions, deep staging, controlled palette',
  'high-contrast chiaroscuro, single hard key, smoke in the beam',
  'naturalistic daylight, long static holds, environmental sound foregrounded'
];

const EMOTIONS = ['dread','hope','grief','resolve','tenderness','fury','wonder','shame','relief','longing'];
const LIGHTING = ['low-key practicals, deep shadow','cold morning blue through blinds','sodium-vapour street amber','single overhead fluorescent, green cast','firelight and blue hour','hard backlight, silhouette','soft overcast diffusion','neon spill, magenta and cyan'];
const TIME_OF_DAY = ['NIGHT','DAY','DUSK','DAWN','CONTINUOUS','MORNING','LATE AFTERNOON'];
const PROPS = ['a cracked phone screen','an unopened letter','a ring of keys','a cold cup of coffee','a folded map','a recorder with the tape still running','a child\u2019s drawing','a hospital bracelet','a bottle, unopened','a train ticket, single'];

export interface DemoStory {
  title: string; logline: string; premise: string;
  acts: { name: string; beats: { text: string; emotion: string; location: string }[] }[];
  themes: string[]; ending: string; tone: string; genre: string;
}

export function demoStory(idea: Idea, seed: number): DemoStory {
  const r = rng(seed);
  const genre = (idea.genre || 'drama').toLowerCase().trim();
  const gk = Object.keys(GENRE_BEATS).find(k => genre.includes(k)) ?? (genre.includes('sci') ? 'sci-fi' : null) ?? 'drama';
  const tone = idea.tone || pick(r, ['restrained','feverish','melancholic','wry','operatic','clinical']);
  const setting = idea.setting || pick(r, ['a coastal city in winter','a dying industrial town','a research station','an apartment block during a blackout','a border checkpoint']);
  const protagonist = idea.characters?.split(/[,\n]/)[0]?.trim() || `${pick(r, NAME_FIRST)} ${pick(r, NAME_LAST)}`;
  const theme = idea.theme || pick(r, ['memory as a form of debt','the cost of being believed','inheritance and refusal','who is allowed to grieve']);
  const conflict = idea.conflict || `what ${protagonist.split(' ')[0]} wants cannot coexist with what they are responsible for`;
  const title = idea.text ? deriveTitle(idea.text, r) : pick(r, ['The Last Memory','Long Way Down','Salt and Signal','The Quiet Part','Undertow','A Small Correction','What the River Keeps']);
  const pool = [...(GENRE_BEATS[gk] ?? []), ...FALLBACK_BEATS];
  const chosen = list(r, pool, 9);
  const locs = list(r, ['the apartment','the station','a rooftop','the archive','a hospital corridor','the waterfront','an all-night diner','the old laboratory','a train','the stairwell'], 5);

  const acts = ['ACT 1','ACT 2','ACT 3'].map((name, ai) => ({
    name,
    beats: [0,1,2].map(bi => {
      const i = ai * 3 + bi;
      return { text: chosen[i] ?? FALLBACK_BEATS[i % FALLBACK_BEATS.length], emotion: pick(r, EMOTIONS), location: locs[i % locs.length] };
    })
  }));

  const ending = idea.ending && idea.ending.length > 8 ? idea.ending
    : pick(r, [
      `${protagonist.split(' ')[0]} gets what they asked for and understands too late that it was a substitute.`,
      `The truth is established but arrives after the person who needed it is gone.`,
      `A quiet act of refusal changes nothing structurally and everything personally.`,
      `The cycle visibly restarts, one degree different.`
    ]);

  return {
    title, tone, genre: cap(gk),
    logline: `In ${setting}, ${protagonist} — ${idea.characters ? 'alongside those named in the brief' : 'a person built around a single unspoken rule'} — must confront ${conflict} before ${pick(r, ['the window closes for good','the evidence is destroyed','they become complicit','the person they are protecting learns the truth'])}.`,
    premise: [
      `${title} is a ${gk} about ${theme.toLowerCase()}, set in ${setting}.`,
      `${protagonist} has spent years arranging their life so that ${conflict} never has to be named. The story begins on the day that arrangement fails in a way that is visible to other people.`,
      `The film treats ${idea.visualStyle || pick(r, VISUAL_LANGS)} as narrative information: what is legible in frame is what the character is willing to admit.`,
      `Tone is ${tone}, pacing ${idea.pacing || 'deliberate, with two accelerations'}, and the audience is asked to hold two readings of the same event until the final act.`
    ].join(' '),
    acts,
    themes: [theme, ...list(r, ['complicity','the ethics of looking','inheritance','institutional memory','grief as labour'], 2)],
    ending
  };
}

function deriveTitle(text: string, r: R): string {
  const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 4);
  if (!words.length) return 'Untitled';
  const a = cap(pick(r, words));
  const templates = [`The ${a}`, `${a} and ${cap(pick(r, ['Signal','Salt','Weather','Static','Inheritance','Undertow']))}`, `${cap(pick(r, ['Long','Quiet','Last','Cold']))} ${a}`];
  return pick(r, templates);
}

/* ── screenplay ─────────────────────────────────────────────── */
export interface DemoScriptElement { type: string; text: string; meta?: Record<string, string>; characterName?: string }
export interface DemoScript { title: string; elements: DemoScriptElement[]; scenes: DemoSceneInfo[] }
export interface DemoSceneInfo { index: number; heading: string; intExt: string; location: string; timeOfDay: string; characters: string[]; emotion: string; lighting: string; props: string[]; action: string; dialogue: { speaker: string; line: string; parenthetical?: string }[] }

const DIALOGUE_BANK: Record<string, string[]> = {
  dread: ['Don\u2019t say it out loud.','I counted again. It doesn\u2019t match.','We should not be in this room.','You already know what this is.'],
  hope: ['We can still get ahead of it.','Give me one day. That\u2019s all.','There\u2019s a version of this where we walk away.','Then we start again.'],
  grief: ['I kept the voicemail.','Nobody told me it would be this quiet.','I don\u2019t know how to put it down.','You weren\u2019t there. That\u2019s the part I can\u2019t get past.'],
  resolve: ['I\u2019m not asking permission.','Then it\u2019s done.','Whatever it costs, I\u2019ll carry it.','Open the door.'],
  tenderness: ['You can stop holding it up by yourself.','Stay. Just for a minute.','I remembered the wrong thing for years.','Say it again, slowly.'],
  fury: ['You knew. You knew and you let me.','I\u2019m finished being reasonable.','Everything I built, you spent.','Don\u2019t touch me.'],
  wonder: ['It\u2019s still running.','Nobody built this. It grew.','Look at what it does when no one\u2019s watching.','It\u2019s answering us.'],
  shame: ['I told them it was fine.','I can\u2019t be in that photograph.','It was easier than telling the truth.','I\u2019d do it again. That\u2019s the problem.'],
  relief: ['It\u2019s over.','Sit down. You\u2019re allowed to sit down.','We made it out.','Breathe.'],
  longing: ['I think about that summer constantly.','You left without saying it.','I kept the ticket.','I wanted to be someone you\u2019d wait for.']
};
const PARENS = ['quietly','not looking up','after a beat','to the room','measured','almost laughing'];

export function demoScript(story: DemoStory, idea: Idea, seed: number, sceneCount = 6): DemoScript {
  const r = rng(seed);
  const cast = buildCast(idea, story, r);
  const locPool = ['APARTMENT','CITY STREET','ABANDONED BUILDING','COMPUTER ROOM','FOREST','LABORATORY','TRAIN STATION','ROOFTOP','ARCHIVE','DINER','HOSPITAL CORRIDOR','STAIRWELL','WATERFRONT'];
  const scenes: DemoSceneInfo[] = [];
  const elements: DemoScriptElement[] = [{ type: 'transition', text: 'FADE IN:' }];

  const beats = story.acts.flatMap(a => a.beats);
  for (let i = 0; i < sceneCount; i++) {
    const beat = beats[i % beats.length];
    const intExt = i % 3 === 0 ? 'EXT.' : 'INT.';
    const location = (beat.location ? mapToSlug(beat.location) : pick(r, locPool)).toUpperCase();
    const timeOfDay = pick(r, TIME_OF_DAY);
    const lighting = pick(r, LIGHTING);
    const emotion = beat.emotion || pick(r, EMOTIONS);
    const present = list(r, cast.map(c => c.name), i === 0 || i === sceneCount - 1 ? 2 : 1 + Math.floor(r() * 2));
    const props = list(r, PROPS, 1 + Math.floor(r() * 2));
    const heading = `${intExt} ${location} — ${timeOfDay}`;
    const action = buildAction(beat.text, present, props, lighting, r);
    const dialogue = buildDialogue(emotion, present, r);

    elements.push({ type: 'scene-heading', text: heading, meta: { intExt, location, time: timeOfDay } });
    elements.push({ type: 'action', text: action });
    if (i === 1) elements.push({ type: 'camera', text: 'SLOW PUSH on the doorway — hold the frame until the sound lands.' });
    for (const d of dialogue) {
      elements.push({ type: 'character', text: d.speaker.toUpperCase(), characterName: d.speaker });
      if (d.parenthetical) elements.push({ type: 'parenthetical', text: `(${d.parenthetical})`, characterName: d.speaker });
      elements.push({ type: 'dialogue', text: d.line, characterName: d.speaker });
    }
    if (i % 2 === 1) elements.push({ type: 'transition', text: pick(r, ['CUT TO:','SMASH CUT TO:','DISSOLVE TO:']) });

    scenes.push({ index: i + 1, heading, intExt, location: cap(location.toLowerCase()), timeOfDay: cap(timeOfDay.toLowerCase()), characters: present, emotion, lighting, props, action, dialogue });
  }
  elements.push({ type: 'transition', text: 'FADE OUT.' });
  return { title: story.title, elements, scenes };
}

function mapToSlug(loc: string): string {
  const s = loc.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const map: Record<string, string> = { the_apartment: 'APARTMENT', the_station: 'TRAIN STATION', a_rooftop: 'ROOFTOP', the_archive: 'ARCHIVE', a_hospital_corridor: 'HOSPITAL CORRIDOR', the_waterfront: 'WATERFRONT', an_all_night_diner: 'DINER', the_old_laboratory: 'LABORATORY', a_train: 'TRAIN STATION', the_stairwell: 'STAIRWELL' };
  return map[s] ?? loc.toUpperCase();
}

function buildAction(beat: string, cast: string[], props: string[], lighting: string, r: R): string {
  const who = cast[0]?.split(' ')[0] ?? 'They';
  const second = cast[1]?.split(' ')[0];
  const s1 = `${lighting[0].toUpperCase() + lighting.slice(1)}. ${who} arrives with ${props[0] ?? 'nothing'} and does not put it down.`;
  const s2 = `${cap(beat)}. ${second ? `${who} waits for ${second} to speak first; ${second} does not.` : `${who} checks the door twice, a habit with no origin left.`}`;
  const s3 = pick(r, [
    `The room keeps its noise: a fan, traffic two streets over, a phone vibrating face-down.`,
    `Something is out of place by a few centimetres — enough to notice, not enough to prove.`,
    `Rain starts against the window and neither of them acknowledges it.`,
    `A light outside sweeps the ceiling once, like a car passing, or a search.`
  ]);
  return [s1, s2, s3].join(' ');
}

function buildDialogue(emotion: string, cast: string[], r: R): { speaker: string; line: string; parenthetical?: string }[] {
  const bank = DIALOGUE_BANK[emotion] ?? DIALOGUE_BANK.resolve;
  const out: { speaker: string; line: string; parenthetical?: string }[] = [];
  const n = Math.min(cast.length, 1 + Math.floor(r() * 2)) * 2;
  for (let i = 0; i < Math.max(2, n); i++) {
    const speaker = cast[i % Math.max(1, cast.length)] ?? cast[0];
    if (!speaker) break;
    out.push({ speaker, line: bank[Math.floor(r() * bank.length)], parenthetical: r() > 0.72 ? pick(r, PARENS) : undefined });
  }
  return out;
}

export interface DemoCastMember { name: string; role: string; age: string; description: string; personality: string; wardrobe: string; physical: string; voice: string; arc: string }
export type DemoCast = DemoCastMember[];
export function buildCast(idea: Idea, story: DemoStory, r: R): DemoCast {
  const named = (idea.characters ?? '').split(/[,\n;]/).map(s => s.trim()).filter(s => s.length > 1).slice(0, 4);
  const count = Math.max(2, Math.min(5, named.length || 2 + Math.floor(r() * 2)));
  const usedRoles = ROLES.slice();
  const out: DemoCast = [];
  for (let i = 0; i < count; i++) {
    const name = named[i] ?? `${pick(r, NAME_FIRST)} ${pick(r, NAME_LAST)}`;
    const role = i === 0 ? 'protagonist' : pick(r, usedRoles.filter(x => x !== 'protagonist'));
    const age = pick(r, ['late 20s','mid 30s','early 40s','late 50s','early 60s','19','26']);
    out.push({
      name, role, age,
      description: `${cap(role)} — ${pick(r, ['the one who keeps records','the one who leaves','the one everyone believes','the one with nothing to gain','the one who was there'])}. ${pick(r, ['Carries the film\u2019s central refusal.','Holds the only copy of the truth.','Is protected by the person they endanger.','Speaks in corrections rather than statements.'])}`,
      personality: pick(r, ['measured, watchful, slow to anger and slower to forgive','warm on the surface, transactional underneath','blunt, funny, allergic to sentiment','careful, principled, quietly exhausted','charming, evasive, generous when observed']),
      wardrobe: pick(r, ['grey wool coat over a dark shirt, unchanged across the film','work clothes, high-vis, boots, a lanyard they never remove','expensive and slightly wrong for the setting','layered and shapeless, hiding the body','one clean shirt kept for occasions']),
      physical: pick(r, ['angular face, close-cropped hair, a scar through the left brow','soft features, tired eyes, hands that move before words','tall, stooped, moves like someone apologising for their size','compact, quick, holds eye contact a beat too long']),
      voice: pick(r, ['low, unhurried, dry','clipped, precise, faintly regional','quiet, breathy, careful with consonants','resonant, performs slightly even in private','flat affect that cracks under pressure']),
      arc: i === 0
        ? `Begins by managing the situation, ends by admitting they were part of it. ${story.ending.split('.')[0]}.`
        : `Moves from ${pick(r, ['usefulness','loyalty','curiosity','patience'])} to ${pick(r, ['complicity','departure','honesty','refusal'])}.`
    });
  }
  return out;
}

export function demoLocations(script: DemoScript, seed: number) {
  const r = rng(seed);
  const byName = new Map<string, DemoSceneInfo[]>();
  for (const s of script.scenes) {
    const arr = byName.get(s.location) ?? [];
    arr.push(s); byName.set(s.location, arr);
  }
  return [...byName.entries()].map(([name, scenes]) => ({
    name,
    description: `Appears in ${scenes.length} scene${scenes.length > 1 ? 's' : ''}. ${pick(r, ['The space is defined by what has been removed from it.','Nothing here has been updated in a decade.','It is too clean for how it is used.','The room is smaller than the building suggests.'])}`,
    architecture: pick(r, ['post-war concrete, low ceilings, service ducts exposed','timber frame, plaster, one load-bearing wall removed badly','steel and glass, modular, acoustically dead','masonry, deep reveals, original cornices painted over','prefab panels, bolted, seams visible']),
    timeOfDay: scenes[0].timeOfDay,
    lighting: scenes[0].lighting,
    weather: pick(r, ['clear','overcast','rain','fog','wind','snow flurries','humid, still']),
    palette: [], props: [...new Set(scenes.flatMap(s => s.props))],
    scenes: scenes.map(s => s.index)
  }));
}

/* ── edit reasoning ─────────────────────────────────────────── */
export interface DemoEditPlan { summary: string; rationale: string; ops: { op: string; [k: string]: unknown }[] }
export function demoEditPlan(command: string, seed: number): DemoEditPlan {
  const r = rng(seed);
  const c = command.toLowerCase();
  const ops: DemoEditPlan['ops'] = [];
  let summary = 'Adjusted the cut';
  let rationale = 'Applied pacing and emphasis changes across the timeline.';

  if (/(faster|pacing|tighter|shorter|remove slow|speed up)/.test(c)) {
    summary = 'Tightened pacing';
    rationale = 'Trimmed the longest tails, raised the average cut rate and removed static holds that carried no new information.';
    ops.push({ op: 'tighten', amount: 0.18 }, { op: 'removeStatic', minSec: 4 }, { op: 'speedUpLong', threshold: 6, speed: 1.12 });
  } else if (/(cinematic|filmic|film look|more cinematic)/.test(c)) {
    summary = 'Cinematic pass';
    rationale = 'Added a teal-and-amber grade, letterboxed to 2.39:1 feel with a vignette, crossfaded interior joins and added a low bed under the first act.';
    ops.push({ op: 'grade', preset: 'cinematic' }, { op: 'transitions', kind: 'crossfade', dur: 0.4 }, { op: 'addBed', mood: 'warm', gain: 0.28 }, { op: 'vignette', amount: 0.35 }, { op: 'grain', amount: 0.18 });
  } else if (/(trailer)/.test(c)) {
    summary = 'Trailer cut';
    rationale = 'Built a three-act trailer: hook, escalation with a music stop, then the strongest two images and a title card.';
    ops.push({ op: 'buildTrailer', targetSec: 75 }, { op: 'grade', preset: 'epic' }, { op: 'addBed', mood: 'epic', gain: 0.5 }, { op: 'riserAt', ratio: 0.6 });
  } else if (/(30 second|:30|thirty)/.test(c)) {
    summary = '30-second version';
    rationale = 'Selected the six highest-information shots, cut on motion, and preserved the ending beat.';
    ops.push({ op: 'condense', targetSec: 30 });
  } else if (/(short|vertical|9:16|social|reel|tiktok)/.test(c)) {
    summary = 'Social vertical cut';
    rationale = 'Reframed to 9:16 with centre-weighted cropping, front-loaded the hook, burned in captions and shortened every hold.';
    ops.push({ op: 'reframe', aspect: '9:16' }, { op: 'hookFirst' }, { op: 'captions' }, { op: 'condense', targetSec: 45 });
  } else if (/(subtitle|caption)/.test(c)) {
    summary = 'Captions added';
    rationale = 'Generated a caption track from the dialogue lines and placed it inside the lower title-safe area.';
    ops.push({ op: 'captions' });
  } else if (/(music|score|add music)/.test(c)) {
    summary = 'Score added';
    rationale = 'Laid a continuous bed under the timeline with a duck under dialogue and a resolve at the final frame.';
    ops.push({ op: 'addBed', mood: /sad|melanch/.test(c) ? 'melancholy' : /tense|dark|susp/.test(c) ? 'tension' : 'warm', gain: 0.4 }, { op: 'duck', amount: 0.55 });
  } else if (/(beat|sync cut)/.test(c)) {
    summary = 'Cuts synced to beat';
    rationale = 'Detected the tempo of the music track and quantised clip boundaries to the nearest beat.';
    ops.push({ op: 'quantizeToBeat' });
  } else if (/(darker|suspense|tense|menace)/.test(c)) {
    summary = 'Darker, more suspenseful';
    rationale = 'Crushed the blacks, cooled the highlights, slowed nothing but shortened the breaths between lines, and swapped the bed for a tension figure.';
    ops.push({ op: 'grade', preset: 'noir' }, { op: 'addBed', mood: 'tension', gain: 0.42 }, { op: 'tighten', amount: 0.08 }, { op: 'lowerKey', amount: 0.18 });
  } else if (/(youtube)/.test(c)) {
    summary = 'YouTube version';
    rationale = 'Added a cold-open hook, chaptered the body, and normalised loudness for streaming.';
    ops.push({ op: 'hookFirst' }, { op: 'chapters' }, { op: 'normalize', target: -14 });
  } else if (/(stems)/.test(c)) {
    summary = 'Stems prepared';
    rationale = 'Separated dialogue, effects, ambience and music onto isolated buses for the export.';
    ops.push({ op: 'stems' });
  } else {
    ops.push({ op: 'tighten', amount: 0.06 + r() * 0.1 }, { op: 'grade', preset: 'cinematic' });
  }
  return { summary, rationale, ops };
}

export function demoReply(command: string, ctx: { projectName: string; stage: string; counts: Record<string, number> }, seed: number): string {
  const r = rng(seed);
  const c = command.toLowerCase();
  if (/(how|what|why|explain|help)/.test(c) && !/(generate|make|create|add)/.test(c)) {
    return `Right now **${ctx.projectName}** is at the **${ctx.stage}** stage with ${ctx.counts.scenes ?? 0} scenes, ${ctx.counts.shots ?? 0} shots, ${ctx.counts.characters ?? 0} characters and ${ctx.counts.assets ?? 0} assets generated. Ask me to change something specific — "make scene 4 darker", "cut a 30 second version", "add rain to every exterior" — and I'll show you the exact diff before anything is applied.`;
  }
  return pick(r, [
    `I can do that. I'll propose the change as a reviewable diff first — nothing is applied until you approve it.`,
    `Understood. Let me map that onto the current timeline and show you what would move.`,
    `Here's the plan. I've kept the change minimal so the rest of the cut stays intact.`
  ]);
}
