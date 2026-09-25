import { rng, hashSeed } from '../ids';
import type { AspectRatio } from '@/types';
import { ASPECT_DIMS } from '@/types';

/**
 * Deterministic cinematic frame synthesiser.
 *
 * Demo Mode never pretends an AI model produced media. Instead it renders a
 * real, resolution-independent SVG plate composed from the shot's own
 * parameters (lens, size, lighting, palette, seed) and clearly badges it as a
 * demo plate. These frames are genuine production stand-ins: they are used as
 * storyboard art, as start/end frames for motion, and as timeline sources.
 */

export interface FrameSpec {
  seed: number;
  prompt: string;
  negativePrompt?: string;
  shotSize?: string;
  lens?: string;
  lighting?: string;
  palette?: string[];
  label?: string;
  sublabel?: string;
  aspect?: AspectRatio;
  demoBadge?: boolean;
  characterSilhouette?: boolean;
}

const BASE = 1600;
export function frameDims(aspect: AspectRatio = '16:9') {
  const d = ASPECT_DIMS[aspect] ?? { w: 16, h: 9 };
  const h = Math.round(BASE * d.h / d.w);
  return { w: BASE, h: Math.min(2400, Math.max(500, h)) };
}

type Mood = { sky: [string, string, string]; ground: [string, string]; key: string; haze: string; name: string };

function moodFor(prompt: string, lighting: string, r: () => number): Mood {
  const t = `${prompt} ${lighting}`.toLowerCase();
  const moods: [RegExp, Mood][] = [
    [/night|midnight|dark|noir|shadow|horror|moon/, { sky: ['#070B14', '#0E1726', '#1B2740'], ground: ['#05070C', '#0A0E17'], key: '#8FB6E8', haze: 'rgba(90,130,190,0.16)', name: 'night' }],
    [/sunset|dusk|golden|evening|magic hour/, { sky: ['#2A1310', '#8A3D1C', '#E8A24A'], ground: ['#150B08', '#2A160E'], key: '#FFC46B', haze: 'rgba(255,150,70,0.20)', name: 'sunset' }],
    [/dawn|sunrise|morning/, { sky: ['#141B2A', '#4A5C7A', '#E7C3A0'], ground: ['#11151E', '#232A36'], key: '#FFE0B8', haze: 'rgba(220,200,255,0.16)', name: 'dawn' }],
    [/rain|storm|overcast|grey|gray|gloom/, { sky: ['#15181B', '#2A3036', '#4A545C'], ground: ['#0D0F11', '#1A1E22'], key: '#A8BAC6', haze: 'rgba(150,175,195,0.22)', name: 'rain' }],
    [/neon|cyber|city night|tokyo|blade/, { sky: ['#0A0714', '#1C1030', '#3A1550'], ground: ['#07050E', '#120B20'], key: '#FF4FA3', haze: 'rgba(120,60,220,0.24)', name: 'neon' }],
    [/forest|jungle|nature|trees|field|meadow/, { sky: ['#101A14', '#25402C', '#4E7A4A'], ground: ['#0A110C', '#16241A'], key: '#BFE39A', haze: 'rgba(120,190,120,0.16)', name: 'forest' }],
    [/desert|sand|wasteland|dune/, { sky: ['#2B1E12', '#7A5527', '#D9A85F'], ground: ['#1A120A', '#3A2814'], key: '#FFD9A0', haze: 'rgba(230,180,110,0.20)', name: 'desert' }],
    [/snow|winter|ice|frozen|arctic/, { sky: ['#1A222C', '#3E5468', '#9FC0D8'], ground: ['#141A21', '#2C3A47'], key: '#E8F4FF', haze: 'rgba(200,225,255,0.20)', name: 'snow' }],
    [/lab|laboratory|computer|server|tech|interior|room|apartment|office/, { sky: ['#0E1013', '#1A1E24', '#2A3138'], ground: ['#0A0B0D', '#14171B'], key: '#7FD4E8', haze: 'rgba(110,190,220,0.14)', name: 'interior' }],
    [/space|cosmic|nebula|planet|orbit/, { sky: ['#04030A', '#120A28', '#2C1450'], ground: ['#030208', '#0A0716'], key: '#C9A6FF', haze: 'rgba(150,100,255,0.20)', name: 'space' }],
    [/underwater|ocean|sea|beach/, { sky: ['#04141C', '#0B3548', '#1C6E82'], ground: ['#030D13', '#07202B'], key: '#8FE6FF', haze: 'rgba(90,200,230,0.18)', name: 'ocean' }]
  ];
  for (const [re, m] of moods) if (re.test(t)) return m;
  const fallbacks: Mood[] = [
    { sky: ['#12100E', '#2A2521', '#4E443A'], ground: ['#0C0A09', '#1A1613'], key: '#E8C08A', haze: 'rgba(220,180,120,0.15)', name: 'neutral' },
    { sky: ['#0E1114', '#232A31', '#414C57'], ground: ['#090B0D', '#151A1F'], key: '#B9CBD8', haze: 'rgba(160,190,215,0.15)', name: 'steel' },
    { sky: ['#140F12', '#2E2029', '#54394A'], ground: ['#0C090B', '#1A1317'], key: '#E5A9C0', haze: 'rgba(210,140,180,0.15)', name: 'plum' }
  ];
  return fallbacks[Math.floor(r() * fallbacks.length) % fallbacks.length];
}

function ridge(r: () => number, w: number, baseY: number, amp: number, steps: number): string {
  const pts: string[] = [`0,${baseY + amp}`];
  let y = baseY;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * w;
    y = baseY + (r() - 0.5) * amp * 2;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  pts.push(`${w},${baseY + amp}`);
  return pts.join(' ');
}

function skyline(r: () => number, w: number, baseY: number, h: number): string {
  const pts: string[] = [`0,${baseY}`];
  let x = 0;
  while (x < w) {
    const bw = 26 + r() * 86;
    const bh = h * (0.25 + r() * 0.75);
    pts.push(`${x.toFixed(1)},${baseY.toFixed(1)}`, `${x.toFixed(1)},${(baseY - bh).toFixed(1)}`, `${(x + bw).toFixed(1)},${(baseY - bh).toFixed(1)}`, `${(x + bw).toFixed(1)},${baseY.toFixed(1)}`);
    x += bw + r() * 14;
  }
  pts.push(`${w},${baseY}`);
  return pts.join(' ');
}

function windows(r: () => number, w: number, baseY: number, h: number, key: string): string {
  let out = '';
  for (let i = 0; i < 90; i++) {
    const x = r() * w, y = baseY - r() * h;
    if (r() > 0.55) continue;
    out += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(2 + r() * 4).toFixed(1)}" height="${(3 + r() * 6).toFixed(1)}" fill="${key}" opacity="${(0.18 + r() * 0.5).toFixed(2)}"/>`;
  }
  return out;
}

function person(r: () => number, cx: number, groundY: number, h: number, fill: string): string {
  const head = h * 0.13;
  const y = groundY - h;
  const sway = (r() - 0.5) * h * 0.06;
  return `
  <g fill="${fill}">
    <ellipse cx="${cx}" cy="${y + head * 0.6}" rx="${head * 0.52}" ry="${head * 0.66}"/>
    <path d="M${cx - h * 0.16} ${y + head * 1.5}
             Q${cx} ${y + head * 1.1} ${cx + h * 0.16} ${y + head * 1.5}
             L${cx + h * 0.13 + sway} ${y + h * 0.62}
             L${cx - h * 0.13 + sway} ${y + h * 0.62} Z"/>
    <path d="M${cx - h * 0.1 + sway} ${y + h * 0.6} L${cx - h * 0.13} ${y + h} L${cx - h * 0.03} ${y + h} L${cx - h * 0.01 + sway} ${y + h * 0.6} Z"/>
    <path d="M${cx + h * 0.02 + sway} ${y + h * 0.6} L${cx + h * 0.05} ${y + h} L${cx + h * 0.15} ${y + h} L${cx + h * 0.11 + sway} ${y + h * 0.6} Z"/>
  </g>`;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function synthFrame(spec: FrameSpec): string {
  const seed = spec.seed || hashSeed(spec.prompt || 'frame');
  const r = rng(seed);
  const { w, h } = frameDims(spec.aspect ?? '16:9');
  const m = moodFor(spec.prompt, spec.lighting ?? '', r);
  const pal = spec.palette?.length ? spec.palette : [m.sky[2], m.key, m.ground[1]];
  const horizon = h * (0.52 + r() * 0.16);
  const size = (spec.shotSize ?? 'Medium').toLowerCase();
  const interior = /lab|interior|room|apartment|office|computer/.test(`${spec.prompt} ${spec.lighting}`.toLowerCase()) || m.name === 'interior';
  const urban = /city|street|urban|skyline|tokyo|downtown|alley/.test(spec.prompt.toLowerCase()) || m.name === 'neon';
  const id = `f${Math.abs(seed).toString(36)}`;

  // Depth-of-field: long lenses blur the background more.
  const lens = spec.lens ?? '35mm';
  const mm = Number(String(lens).replace(/[^\d.]/g, '')) || 35;
  const blur = Math.min(9, Math.max(0.6, (mm - 28) / 12));
  const closeFraming = /close|extreme close/.test(size);

  const layers: string[] = [];

  layers.push(`<defs>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${m.sky[0]}"/><stop offset="55%" stop-color="${m.sky[1]}"/><stop offset="100%" stop-color="${m.sky[2]}"/>
    </linearGradient>
    <radialGradient id="${id}-key" cx="${(20 + r() * 60).toFixed(1)}%" cy="${(12 + r() * 30).toFixed(1)}%" r="52%">
      <stop offset="0%" stop-color="${m.key}" stop-opacity="0.85"/><stop offset="42%" stop-color="${m.key}" stop-opacity="0.18"/><stop offset="100%" stop-color="${m.key}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${id}-ground" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${m.ground[1]}"/><stop offset="100%" stop-color="${m.ground[0]}"/>
    </linearGradient>
    <radialGradient id="${id}-vig" cx="50%" cy="50%" r="72%">
      <stop offset="52%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.72"/>
    </radialGradient>
    <filter id="${id}-grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="${(0.7 + r() * 0.5).toFixed(2)}" numOctaves="3" seed="${Math.floor(r() * 999)}"/>
      <feColorMatrix type="saturate" values="0"/>
    </filter>
    <filter id="${id}-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${blur.toFixed(2)}"/></filter>
    <filter id="${id}-soft2" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${(blur * 0.4).toFixed(2)}"/></filter>
    <filter id="${id}-glow"><feGaussianBlur stdDeviation="18" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  </defs>`);

  layers.push(`<rect width="${w}" height="${h}" fill="url(#${id}-sky)"/>`);
  layers.push(`<rect width="${w}" height="${h}" fill="url(#${id}-key)"/>`);

  if (m.name === 'space') {
    let stars = '';
    for (let i = 0; i < 240; i++) stars += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(r() * 1.5 + 0.3).toFixed(2)}" fill="#fff" opacity="${(0.2 + r() * 0.8).toFixed(2)}"/>`;
    layers.push(`<g filter="url(#${id}-soft2)">${stars}</g>`);
    layers.push(`<circle cx="${(w * (0.2 + r() * 0.6)).toFixed(0)}" cy="${(h * (0.2 + r() * 0.4)).toFixed(0)}" r="${(h * (0.09 + r() * 0.16)).toFixed(0)}" fill="${pal[1]}" opacity="0.28" filter="url(#${id}-soft)"/>`);
  }

  if (!interior) {
    // far background
    layers.push(`<g filter="url(#${id}-soft)" opacity="0.75">`);
    if (urban) layers.push(`<polygon points="${skyline(r, w, horizon + 8, h * 0.34)}" fill="${m.ground[1]}" opacity="0.85"/>`);
    else layers.push(`<polygon points="${ridge(r, w, horizon, h * 0.16, 14)}" fill="${m.ground[1]}" opacity="0.9"/>`);
    layers.push(`</g>`);
    if (urban) layers.push(`<g filter="url(#${id}-soft2)" opacity="0.9">${windows(r, w, horizon, h * 0.3, m.key)}</g>`);
    // mid ground
    layers.push(`<g filter="url(#${id}-soft2)">`);
    if (urban) layers.push(`<polygon points="${skyline(r, w, horizon + h * 0.05, h * 0.2)}" fill="${m.ground[0]}" opacity="0.95"/>`);
    else layers.push(`<polygon points="${ridge(r, w, horizon + h * 0.04, h * 0.1, 10)}" fill="${m.ground[0]}" opacity="0.95"/>`);
    layers.push(`</g>`);
  } else {
    // interior: wall panels, practicals, a window shaft
    layers.push(`<g filter="url(#${id}-soft)">`);
    for (let i = 0; i < 5; i++) {
      const x = (i / 5) * w + r() * 40;
      layers.push(`<rect x="${x.toFixed(0)}" y="${(h * 0.1).toFixed(0)}" width="${(w * 0.14).toFixed(0)}" height="${(h * 0.72).toFixed(0)}" fill="${i % 2 ? m.ground[1] : m.ground[0]}" opacity="0.5"/>`);
    }
    layers.push(`</g>`);
    layers.push(`<polygon points="${(w * 0.12).toFixed(0)},0 ${(w * 0.42).toFixed(0)},0 ${(w * 0.62).toFixed(0)},${h} ${(w * 0.2).toFixed(0)},${h}" fill="${m.key}" opacity="0.07"/>`);
    let practicals = '';
    for (let i = 0; i < 14; i++) {
      practicals += `<circle cx="${(r() * w).toFixed(0)}" cy="${(h * 0.15 + r() * h * 0.6).toFixed(0)}" r="${(2 + r() * 7).toFixed(1)}" fill="${m.key}" opacity="${(0.25 + r() * 0.55).toFixed(2)}"/>`;
    }
    layers.push(`<g filter="url(#${id}-glow)">${practicals}</g>`);
  }

  // ground plane
  layers.push(`<rect y="${horizon.toFixed(1)}" width="${w}" height="${(h - horizon).toFixed(1)}" fill="url(#${id}-ground)"/>`);
  layers.push(`<rect y="${(horizon - 2).toFixed(1)}" width="${w}" height="3" fill="${m.key}" opacity="0.14"/>`);

  // haze bands
  const hazeRgb: string[] = m.haze.match(/([\d.]+),\s*([\d.]+),\s*([\d.]+)/) ?? ['0,180,200', '180', '200', '220'];
  for (let i = 0; i < 4; i++) {
    const y = horizon - h * 0.22 + i * h * 0.09;
    const hazeFill = `rgba(${hazeRgb[1]},${hazeRgb[2]},${hazeRgb[3]},${(0.35 - i * 0.06).toFixed(2)})`;
    layers.push(`<ellipse cx="${(w * (0.2 + r() * 0.6)).toFixed(0)}" cy="${y.toFixed(0)}" rx="${(w * (0.3 + r() * 0.4)).toFixed(0)}" ry="${(h * (0.03 + r() * 0.05)).toFixed(0)}" fill="${hazeFill}" filter="url(#${id}-soft)"/>`);
  }

  // foreground subject
  const subjectH = closeFraming ? h * 1.5 : /wide|extreme wide|full/.test(size) ? h * 0.26 : /medium close|close-up/.test(size) ? h * 0.78 : h * 0.46;
  if (spec.characterSilhouette !== false) {
    const cx = w * (0.28 + r() * 0.44);
    layers.push(person(r, cx, interior ? h * 0.98 : horizon + (h - horizon) * 0.72, subjectH, closeFraming ? '#050505' : 'rgba(3,3,4,0.92)'));
    // rim light
    layers.push(`<ellipse cx="${(cx + subjectH * 0.16).toFixed(0)}" cy="${(h - subjectH * 0.6).toFixed(0)}" rx="${(subjectH * 0.09).toFixed(0)}" ry="${(subjectH * 0.42).toFixed(0)}" fill="${m.key}" opacity="0.16" filter="url(#${id}-soft)"/>`);
  }

  // foreground bokeh / debris
  for (let i = 0; i < (closeFraming ? 8 : 16); i++) {
    layers.push(`<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(3 + r() * 22).toFixed(1)}" fill="${m.key}" opacity="${(0.02 + r() * 0.06).toFixed(3)}" filter="url(#${id}-soft)"/>`);
  }

  // grade + grain + vignette
  layers.push(`<rect width="${w}" height="${h}" fill="url(#${id}-vig)"/>`);
  layers.push(`<rect width="${w}" height="${h}" filter="url(#${id}-grain)" opacity="0.11" style="mix-blend-mode:overlay"/>`);
  layers.push(`<rect width="${w}" height="${h}" fill="${pal[0]}" opacity="0.05" style="mix-blend-mode:color"/>`);

  // annotations (diegetic HUD, kept subtle and outside the image safe area)
  // Only append the camera line when the caller didn't already put it in the sublabel.
  const cam = `${spec.shotSize ?? ''} ${spec.lens ?? ''}`.trim();
  const meta = [spec.label, spec.sublabel, spec.sublabel && cam && !spec.sublabel.includes(spec.lens ?? '\u0000') ? cam : null]
    .filter((x): x is string => Boolean(x)).map(esc);
  if (meta.length || spec.demoBadge !== false) {
    layers.push(`<g font-family="ui-monospace,SFMono-Regular,Menlo,monospace" opacity="0.9">`);
    if (spec.demoBadge !== false) {
      layers.push(`<g transform="translate(${w - 232},26)">
        <rect width="206" height="26" rx="4" fill="rgba(6,6,5,0.62)" stroke="rgba(217,154,50,0.42)"/>
        <circle cx="14" cy="13" r="3.4" fill="#D99A32"/>
        <text x="26" y="17" font-size="11" letter-spacing="1.6" fill="#E8B968">STUDIO ENGINE · PREVIS</text>
      </g>`);
    }
    layers.push(`<text x="26" y="${h - 26}" font-size="13" fill="rgba(243,239,232,0.5)" letter-spacing="1.2">${meta.join('  ·  ')}</text>`);
    layers.push(`<text x="26" y="34" font-size="10.5" fill="rgba(243,239,232,0.28)" letter-spacing="1.4">seed ${seed}</text>`);
    layers.push(`</g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${layers.join('')}</svg>`;
}

/** Nine swatches that read as a real colour script / palette board. */
export function synthPalette(seed: number, prompt: string): string[] {
  const r = rng(seed || hashSeed(prompt || 'palette'));
  const m = moodFor(prompt, '', r);
  const base = [m.sky[0], m.sky[1], m.sky[2], m.ground[0], m.ground[1], m.key];
  const out = base.slice();
  while (out.length < 9) {
    const src = base[Math.floor(r() * base.length)];
    out.push(shiftHex(src, (r() - 0.5) * 40));
  }
  return out.slice(0, 9);
}

export function shiftHex(hex: string, amt: number): string {
  const c = hex.replace('#', '');
  const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const num = parseInt(n, 16);
  const cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = cl(((num >> 16) & 255) + amt), g = cl(((num >> 8) & 255) + amt * 0.8), b = cl((num & 255) + amt * 0.6);
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`.toUpperCase();
}

/** Character reference sheet: 3/4 view, front, profile, expression studies. */
export function synthCharacterSheet(name: string, physical: string, seed: number, accent: string): string {
  const r = rng(seed);
  const w = 1600, h = 1000;
  const skinTones = ['#E8C3A0', '#C9976F', '#8D5B39', '#5C3A24', '#F0D6BE', '#B8835C'];
  const hairTones = ['#1A1512', '#3A2A1C', '#6B4A2A', '#8C8578', '#20160F', '#C8A97A'];
  const clothTones = ['#2A3340', '#3C2E28', '#22302A', '#3A3A42', '#4A3226', '#20262E'];
  const skin = skinTones[Math.floor(r() * skinTones.length)];
  const hair = hairTones[Math.floor(r() * hairTones.length)];
  const cloth = clothTones[Math.floor(r() * clothTones.length)];
  const id = `c${Math.abs(seed).toString(36)}`;
  const views = [{ x: 300, label: 'FRONT' }, { x: 800, label: '3/4' }, { x: 1300, label: 'PROFILE' }];

  const head = (cx: number, cy: number, s: number, profile: boolean) => `
    <g transform="translate(${cx - s * 0.5},${cy - s}) scale(${s / 200})">
      <path d="M60 250 L60 400 L140 400 L140 250 Z" fill="${skin}" opacity="0.92"/>
      <path d="M20 380 Q100 330 180 380 L200 560 L0 560 Z" fill="${cloth}"/>
      <path d="M70 90 Q100 40 132 90 Q150 130 140 190 Q120 240 100 240 Q78 240 60 190 Q50 130 70 90 Z" fill="${skin}"/>
      <path d="M58 120 Q100 50 142 120 Q150 92 130 70 Q100 44 70 70 Q50 92 58 120 Z" fill="${hair}"/>
      <ellipse cx="80" cy="152" rx="9" ry="5" fill="#1A1512" opacity="0.85"/>
      <ellipse cx="120" cy="152" rx="9" ry="5" fill="#1A1512" opacity="0.85"/>
      <path d="M92 168 L100 196 L92 198" stroke="${skin}" stroke-width="3" fill="none" opacity="0.5"/>
      <path d="M86 214 Q100 222 114 214" stroke="#6B4A3A" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      ${profile ? `<path d="M140 150 L160 176 L140 186 Z" fill="${skin}"/>` : ''}
    </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <linearGradient id="${id}-bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#171512"/><stop offset="100%" stop-color="#0B0A09"/></linearGradient>
    <filter id="${id}-g"><feGaussianBlur stdDeviation="26"/></filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}-bg)"/>
  <rect width="${w}" height="${h}" fill="none"/>
  ${views.map(v => `
    <g>
      <rect x="${v.x - 210}" y="120" width="420" height="700" rx="8" fill="#0E0D0B" stroke="#2A2620"/>
      <circle cx="${v.x}" cy="300" r="150" fill="${accent}" opacity="0.07" filter="url(#${id}-g)"/>
      ${head(v.x, 520, 380, v.label === 'PROFILE')}
      <text x="${v.x}" y="870" font-family="ui-monospace,Menlo,monospace" font-size="15" letter-spacing="4" fill="#91897D" text-anchor="middle">${v.label}</text>
    </g>`).join('')}
  <text x="60" y="76" font-family="Georgia,serif" font-size="34" fill="#F3EFE8" letter-spacing="1">${esc(name.toUpperCase())}</text>
  <text x="60" y="102" font-family="ui-monospace,Menlo,monospace" font-size="13" fill="#625D55" letter-spacing="1">CHARACTER REFERENCE · seed ${seed}</text>
  <rect x="60" y="${h - 74}" width="${w - 120}" height="1" fill="#2A2620"/>
  <text x="60" y="${h - 44}" font-family="ui-monospace,Menlo,monospace" font-size="12.5" fill="#91897D">${esc((physical || 'Wardrobe and physicality pending art direction').slice(0, 150))}</text>
  <g transform="translate(${w - 250},${h - 62})">
    <rect width="196" height="26" rx="4" fill="rgba(6,6,5,0.62)" stroke="rgba(217,154,50,0.42)"/>
    <circle cx="14" cy="13" r="3.4" fill="#D99A32"/>
    <text x="26" y="17" font-family="ui-monospace,Menlo,monospace" font-size="11" letter-spacing="1.4" fill="#E8B968">STUDIO ENGINE · REFERENCE</text>
  </g>
</svg>`;
}
