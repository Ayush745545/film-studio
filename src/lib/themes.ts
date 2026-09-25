/**
 * Theme catalogue.
 *
 * A theme is nothing but a named block of CSS custom-property overrides in
 * `globals.css`, applied via `data-theme` on <html>. Switching is instant,
 * needs no reload, and re-skins the entire product — shell, stages, timeline,
 * editor, node canvas — because every colour in the app resolves through the
 * same tokens.
 *
 * To add a theme: append a `[data-theme="id"] { … }` block to globals.css and
 * add one entry here. Nothing else changes.
 */
export interface ThemeDef {
  id: string;
  name: string;
  description: string;
  /** Swatch order: background, surface, accent, text */
  swatch: [string, string, string, string];
  /** Relative luminance hint so the picker can label contrast. */
  contrast: 'high' | 'balanced' | 'soft';
}

export const THEMES: ThemeDef[] = [
  {
    id: 'cinematic', name: 'Cinematic Dark', contrast: 'balanced',
    description: 'The reference look. Warm near-black surfaces with a restrained gold accent, tuned for long grading sessions in a dark room.',
    swatch: ['#090908', '#1B1916', '#D99A32', '#F3EFE8']
  },
  {
    id: 'graphite', name: 'Graphite', contrast: 'balanced',
    description: 'Neutral cool greys with a steel-blue accent. Closest to a conventional engineering tool — easy on the eyes under mixed lighting.',
    swatch: ['#0E0F10', '#242529', '#7EA8E0', '#ECEEF0']
  },
  {
    id: 'midnight', name: 'Midnight', contrast: 'high',
    description: 'Deep blue-black with an ice accent. High separation between surfaces, so dense timelines and node graphs stay legible.',
    swatch: ['#060910', '#182032', '#60A5FA', '#E8EEF8']
  },
  {
    id: 'ember', name: 'Ember', contrast: 'balanced',
    description: 'Warm charcoal with a copper accent. Reads like tungsten-lit footage; good for narrative and documentary work.',
    swatch: ['#0E0908', '#2A1D18', '#E27A3E', '#F8ECE4']
  },
  {
    id: 'sepia', name: 'Sepia Film', contrast: 'soft',
    description: 'Vintage print stock: warm brown surfaces, softened contrast and heavier grain. Suited to period and archive projects.',
    swatch: ['#120F0C', '#322921', '#CE9E58', '#F6EEE0']
  },
  {
    id: 'noir', name: 'Noir', contrast: 'high',
    description: 'Near-monochrome with a single desaturated accent and extra grain. Removes every colour cue so you judge value, not hue.',
    swatch: ['#080808', '#202020', '#D6D6D6', '#F0F0F0']
  }
];

export const DEFAULT_THEME = 'cinematic';

export function isThemeId(id: unknown): id is string {
  return typeof id === 'string' && THEMES.some(t => t.id === id);
}

export function themeById(id: string | null | undefined): ThemeDef {
  return THEMES.find(t => t.id === id) ?? THEMES[0];
}
