import { uid } from '../ids';
import type { Scene, ScriptElement, Screenplay, Shot, Story, StoryAct, StoryBeat } from '@/types';

/** Robust normalisers: AI output is messy, the domain model is not. */

export function normaliseStory(raw: unknown, fallbackSeed: number): Story {
  const o = (raw ?? {}) as Record<string, any>;
  const actsRaw = Array.isArray(o.acts) ? o.acts : [];
  const acts: StoryAct[] = ['ACT 1', 'ACT 2', 'ACT 3'].map((name, i) => {
    const src = actsRaw[i] ?? actsRaw.find((a: any) => String(a?.name ?? '').toUpperCase().includes(String(i + 1)));
    const beats = Array.isArray(src?.beats) ? src.beats : Array.isArray(src) ? src : [];
    return {
      id: uid('act'),
      name: String(src?.name ?? name).toUpperCase(),
      beats: (beats as any[]).slice(0, 8).map((b, bi) => ({
        id: uid('beat'),
        text: typeof b === 'string' ? b : String(b?.text ?? b?.beat ?? b?.description ?? '').trim(),
        emotion: typeof b === 'object' ? String(b?.emotion ?? '') : '',
        location: typeof b === 'object' ? String(b?.location ?? b?.setting ?? '') : ''
      })).filter((b: StoryBeat) => b.text.length > 0)
    };
  }).filter(a => a.beats.length);
  // ensure 3 acts exist even if the model returned fewer
  while (acts.length < 3) acts.push({ id: uid('act'), name: `ACT ${acts.length + 1}`, beats: [] });

  return {
    id: uid('story'),
    title: String(o.title ?? 'Untitled').slice(0, 120),
    logline: String(o.logline ?? '').trim(),
    premise: String(o.premise ?? o.synopsis ?? '').trim(),
    acts,
    themes: (Array.isArray(o.themes) ? o.themes : String(o.themes ?? '').split(',')).map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8),
    ending: String(o.ending ?? '').trim(),
    tone: String(o.tone ?? ''),
    genre: String(o.genre ?? '')
  };
  void fallbackSeed;
}

const SLUG = /^\s*(INT\.|EXT\.|INT\.\/EXT\.|I\/E\.?)\s*[./-]?\s*(.+?)\s*[—-]{1,2}\s*(.+?)\s*$/i;
const TRANSITION = /^\s*(FADE IN:|FADE OUT\.|FADE TO BLACK\.|CUT TO:|SMASH CUT TO:|DISSOLVE TO:|MATCH CUT TO:|WIPE TO:)\s*$/i;
const CAMERA = /^\s*(CAMERA|ANGLE|WIDE ON|CLOSE ON|PUSH IN|PULL BACK|TRACKING|CRANE|HANDHELD|SLOW PUSH|PAN|TILT)\b/i;
const SHOT_RE = /^\s*(SHOT|INSERT)\b/i;

export function normaliseScript(raw: unknown, title: string): Screenplay {
  const o = (raw ?? {}) as Record<string, any>;
  let elements: ScriptElement[] = [];
  const rawElements = Array.isArray(o.elements) ? o.elements
    : Array.isArray(o.scenes) ? o.scenes.flatMap((s: any, i: number) => sceneToElements(s, i))
    : Array.isArray(o) ? o : null;

  if (rawElements) {
    let sceneId: string | null = null;
    for (const e of rawElements as any[]) {
      if (!e) continue;
      if (typeof e === 'string') { elements.push(...parseFreeText(e, sceneId)); if (SLUG.test(e)) sceneId = uid('scn'); continue; }
      const type = String(e.type ?? e.element ?? '').toLowerCase().replace(/[\s-]/g, '');
      const text = String(e.text ?? e.content ?? e.value ?? '').trim();
      if (!text) continue;
      const mapped = mapType(type, text);
      if (mapped === 'scene-heading') { sceneId = uid('scn'); elements.push({ id: uid('el'), type: 'scene-heading', text: normaliseSlug(text), sceneId, meta: parseSlug(text) as ScriptElement['meta'] }); continue; }
      elements.push({
        id: uid('el'), type: mapped, text, sceneId: sceneId ?? undefined,
        characterId: e.characterId ?? undefined,
        meta: e.meta && typeof e.meta === 'object' ? { intExt: e.meta.intExt as never, location: String(e.meta.location ?? ''), time: String(e.meta.time ?? e.meta.timeOfDay ?? '') } : undefined
      });
    }
  }
  if (!elements.length) {
    const text = String(o.text ?? o.screenplay ?? o.script ?? '');
    if (text) elements = parseScreenplayText(text);
  }
  if (!elements.some(e => e.type === 'scene-heading')) {
    elements.unshift({ id: uid('el'), type: 'scene-heading', text: `INT. ${title.toUpperCase()} — DAY`, sceneId: uid('scn'), meta: { intExt: 'INT.' as const, location: title, time: 'DAY' } });
  }
  return {
    id: uid('scr'), title: String(o.title ?? title).slice(0, 120),
    author: String(o.author ?? 'AI Film Studio'), draft: Number(o.draft ?? 1),
    elements, logline: String(o.logline ?? ''),
    fadeIn: elements.find(e => /FADE IN/i.test(e.text))?.text, fadeOut: elements.find(e => /FADE OUT/i.test(e.text))?.text
  };
}

function mapType(t: string, text: string): ScriptElement['type'] {
  if (/sceneheading|slug|slugline|heading|int|ext/.test(t)) return 'scene-heading';
  if (/action|description|sceneaction/.test(t)) return 'action';
  if (/character|speaker|cue/.test(t)) return 'character';
  if (/dialog|dialogue|line/.test(t)) return 'dialogue';
  if (/paren|wryly|parenthetical/.test(t)) return 'parenthetical';
  if (/transition/.test(t)) return 'transition';
  if (/camera|angledirection/.test(t)) return 'camera';
  if (/shot|insert/.test(t)) return 'shot';
  if (/note/.test(t)) return 'note';
  // infer from text when type is missing/unknown
  if (SLUG.test(text)) return 'scene-heading';
  if (TRANSITION.test(text)) return 'transition';
  if (CAMERA.test(text)) return 'camera';
  if (SHOT_RE.test(text)) return 'shot';
  if (/^[A-Z][A-Z\s.'-]{1,40}$/.test(text) && text.split(' ').length <= 4) return 'character';
  if (/^\(.*\)$/.test(text)) return 'parenthetical';
  return 'action';
}

function normaliseSlug(t: string): string {
  const m = SLUG.exec(t);
  if (!m) return t.toUpperCase();
  const intExt = m[1].toUpperCase().replace(/I\/E\.?/, 'INT./EXT.');
  return `${intExt} ${m[2].trim().toUpperCase()} — ${m[3].trim().toUpperCase()}`;
}

export function parseSlug(t: string): { intExt: string; location: string; time: string } {
  const m = SLUG.exec(t);
  if (!m) return { intExt: 'INT.', location: t.trim(), time: 'DAY' };
  return { intExt: m[1].toUpperCase().replace(/I\/E\.?/, 'INT./EXT.'), location: m[2].trim(), time: m[3].trim() };
}

function parseFreeText(line: string, sceneId: string | null): ScriptElement[] {
  const type = mapType('', line);
  if (type === 'scene-heading') {
    const id = uid('scn');
    return [{ id: uid('el'), type, text: normaliseSlug(line), sceneId: id, meta: parseSlug(line) as ScriptElement['meta'] }];
  }
  return [{ id: uid('el'), type, text: line.trim(), sceneId: sceneId ?? undefined }];
}

/** Parse plain-text screenplay ( Courier-ish) into elements. */
export function parseScreenplayText(text: string): ScriptElement[] {
  const out: ScriptElement[] = [];
  let sceneId: string | null = null;
  let lastChar: string | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) { lastChar = null; continue; }
    if (SLUG.test(line)) {
      sceneId = uid('scn');
      out.push({ id: uid('el'), type: 'scene-heading', text: normaliseSlug(line), sceneId, meta: parseSlug(line) as ScriptElement['meta'] });
      lastChar = null; continue;
    }
    if (TRANSITION.test(line)) { out.push({ id: uid('el'), type: 'transition', text: line.toUpperCase(), sceneId: sceneId ?? undefined }); continue; }
    if (/^\(.*\)$/.test(line) && lastChar) { out.push({ id: uid('el'), type: 'parenthetical', text: line, sceneId: sceneId ?? undefined }); continue; }
    const indented = /^\s{6,}/.test(rawLine);
    if (/^[A-Z][A-Z0-9\s.'-]{1,40}$/.test(line) && (indented || rawLine === rawLine.toUpperCase())) {
      lastChar = line;
      out.push({ id: uid('el'), type: 'character', text: line, sceneId: sceneId ?? undefined });
      continue;
    }
    if (lastChar && indented) { out.push({ id: uid('el'), type: 'dialogue', text: line, sceneId: sceneId ?? undefined }); continue; }
    if (CAMERA.test(line)) { out.push({ id: uid('el'), type: 'camera', text: line, sceneId: sceneId ?? undefined }); continue; }
    out.push({ id: uid('el'), type: 'action', text: line, sceneId: sceneId ?? undefined });
  }
  return out;
}

function sceneToElements(s: any, i: number): any[] {
  const out: any[] = [];
  const heading = s.heading ?? `${s.intExt ?? 'INT.'} ${(s.location ?? s.locationName ?? `SCENE ${i + 1}`).toUpperCase()} — ${(s.timeOfDay ?? s.time ?? 'DAY').toUpperCase()}`;
  out.push({ type: 'scene-heading', text: heading, meta: { intExt: s.intExt ?? 'INT.', location: s.location ?? s.locationName, time: s.timeOfDay ?? s.time ?? 'DAY' } });
  if (s.action) out.push({ type: 'action', text: s.action });
  const d = Array.isArray(s.dialogue) ? s.dialogue : typeof s.dialogue === 'string' ? [{ speaker: 'CHARACTER', line: s.dialogue }] : [];
  for (const line of d) {
    if (typeof line === 'string') { out.push({ type: 'dialogue', text: line }); continue; }
    out.push({ type: 'character', text: String(line.speaker ?? line.character ?? '').toUpperCase() });
    if (line.parenthetical) out.push({ type: 'parenthetical', text: `(${line.parenthetical})` });
    out.push({ type: 'dialogue', text: String(line.line ?? line.text ?? '') });
  }
  return out;
}

/** Render elements to standard screenplay text (Courier-style, exportable as FDX-like plain text). */
export function toScreenplayText(sp: Screenplay): string {
  const out: string[] = [];
  for (const el of sp.elements) {
    switch (el.type) {
      case 'scene-heading': out.push('', el.text.toUpperCase(), ''); break;
      case 'action': out.push(el.text, ''); break;
      case 'character': out.push(' '.repeat(22) + el.text.toUpperCase()); break;
      case 'parenthetical': out.push(' '.repeat(16) + (el.text.startsWith('(') ? el.text : `(${el.text})`)); break;
      case 'dialogue': out.push(' '.repeat(12) + el.text); break;
      case 'transition': out.push('', ' '.repeat(46) + el.text.toUpperCase()); break;
      case 'camera': out.push(' '.repeat(6) + el.text.toUpperCase(), ''); break;
      case 'shot': out.push(' '.repeat(6) + el.text.toUpperCase()); break;
      case 'note': out.push(`[[ ${el.text} ]]`); break;
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function scriptText(sp: Screenplay): string { return toScreenplayText(sp); }

export function scenesFromScript(sp: Screenplay): Scene[] {
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  const speakers = new Set<string>();
  for (const el of sp.elements) {
    if (el.type === 'scene-heading') {
      if (current) scenes.push(finish(current, speakers));
      const meta = el.meta ?? parseSlug(el.text);
      current = {
        id: el.sceneId ?? uid('scn'), projectId: '', index: scenes.length + 1,
        heading: el.text, intExt: meta.intExt ?? 'INT.', locationName: titleCase(meta.location ?? ''),
        timeOfDay: titleCase(meta.time ?? 'Day'), locationId: null,
        durationSec: 0, characterIds: [], emotion: '', lighting: guessLighting(meta.time ?? 'DAY', el.text),
        props: [], dialogue: '', action: '', shotIds: [], elementIds: [el.id],
        colorPalette: [], music: '', approved: false
      };
      speakers.clear();
      continue;
    }
    if (!current) continue;
    current.elementIds.push(el.id);
    if (el.type === 'action') current.action = (current.action ? current.action + ' ' : '') + el.text;
    if (el.type === 'camera' || el.type === 'shot') current.action = (current.action ? current.action + ' ' : '') + `[${el.text}]`;
    if (el.type === 'character') speakers.add(el.text.trim());
    if (el.type === 'dialogue') current.dialogue = (current.dialogue ? current.dialogue + '\n' : '') + el.text;
  }
  if (current) scenes.push(finish(current, speakers));
  return scenes;
}

function finish(s: Scene, speakers: Set<string>): Scene {
  const dialogueWords = s.dialogue.split(/\s+/).filter(Boolean).length;
  const actionWords = s.action.split(/\s+/).filter(Boolean).length;
  // standard script-to-screen timing: ~1s per dialogue word / 2.6, plus action beats
  s.durationSec = Math.max(6, Math.round((dialogueWords / 2.4 + actionWords / 9 + 3) * 2) / 2);
  s.characterIds = [...speakers];
  s.emotion = s.emotion || guessEmotion(s.dialogue + ' ' + s.action);
  s.props = extractProps(s.action);
  return s;
}

export function titleCase(s: string): string {
  return s.toLowerCase().split(/\s+/).map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
}

export function guessLighting(time: string, text: string): string {
  const t = `${time} ${text}`.toLowerCase();
  if (/night|midnight/.test(t)) return 'low-key night, practical sources, deep shadow, cool moonlight fill';
  if (/dusk|sunset|evening/.test(t)) return 'golden hour, long warm shadows, amber key';
  if (/dawn|sunrise|morning/.test(t)) return 'soft cool morning light, long diffusion';
  if (/rain|storm|overcast/.test(t)) return 'flat overcast diffusion, grey wrap, wet reflections';
  if (/int\./.test(t)) return 'motivated interior practicals, controlled contrast';
  return 'natural daylight, balanced contrast';
}

const EMOTION_WORDS: [RegExp, string][] = [
  [/can'?t be real|afraid|scared|fear|dread|terrif/, 'dread'],
  [/sorry|grief|miss|lost|died|death|mourning/, 'grief'],
  [/angry|furious|enough|stop it|how dare/, 'fury'],
  [/love|stay|please don'?t go|together/, 'tenderness'],
  [/hope|we can|maybe|chance|try again/, 'hope'],
  [/wonder|incredible|look at|amazing|beautiful/, 'wonder'],
  [/ashamed|shame|guilt|i lied|i'?m sorry/, 'shame']
];
export function guessEmotion(text: string): string {
  const t = text.toLowerCase();
  for (const [re, e] of EMOTION_WORDS) if (re.test(t)) return e;
  return 'tension';
}

const PROP_WORDS = ['phone','letter','key','keys','coffee','cup','map','recorder','tape','drawing','bracelet','bottle','ticket','knife','gun','photograph','photo','book','ring','badge','laptop','bag','coat','glass','pill','pills','envelope','watch','flashlight','torch'];
export function extractProps(action: string): string[] {
  const t = action.toLowerCase();
  return [...new Set(PROP_WORDS.filter(w => new RegExp(`\\b${w}\\b`).test(t)))].slice(0, 8);
}

/** Pull character names out of the script without an LLM (deterministic fallback). */
export function extractCharacterNames(sp: Screenplay): { name: string; lines: number; scenes: number[] }[] {
  const counts = new Map<string, { lines: number; scenes: Set<number> }>();
  let sceneIdx = 0;
  for (const el of sp.elements) {
    if (el.type === 'scene-heading') sceneIdx++;
    if (el.type === 'character') {
      const name = el.text.replace(/\s*\(.*\)\s*$/, '').trim().toUpperCase();
      if (!name || /^(CONTINUED|MORE|LATER|CUT|BACK TO)/.test(name)) continue;
      const key = titleCase(name);
      const c = counts.get(key) ?? { lines: 0, scenes: new Set<number>() };
      c.lines++; c.scenes.add(sceneIdx);
      counts.set(key, c);
    }
  }
  return [...counts.entries()].map(([name, v]) => ({ name, lines: v.lines, scenes: [...v.scenes] }))
    .sort((a, b) => b.lines - a.lines);
}

export type { Shot };
