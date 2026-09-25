'use client';
import type { Clip, Timeline, ColorGrade } from '@/types';
import { GradePipeline, parseCube, type LutData } from './grade-gl';
import { sampleKeyframes } from '../timeline/ops';
import { DEFAULT_GRADE } from '@/types';

/**
 * Timeline compositor.
 *
 * Real rendering, not a <img> swap: every frame is composited on a canvas from
 * the actual media elements — <video> for encoded clips, <img> for stills,
 * procedural motion for demo plates, drawn text layers, adjustment-layer
 * grades and transition maths — then passed through the WebGL colour pipeline.
 * The same code path serves the preview and the in-browser export, so what you
 * grade is what you render.
 */

export interface DemoMotionSource { frames: HTMLImageElement[]; fps: number; move: string; zoomFrom: number; zoomTo: number; panX: number; panY: number }

type Source =
  | { kind: 'video'; el: HTMLVideoElement }
  | { kind: 'image'; el: HTMLImageElement }
  | { kind: 'motion'; motion: DemoMotionSource }
  | { kind: 'none' };

export interface RendererOptions {
  canvas: HTMLCanvasElement;
  onReady?: () => void;
  onSourceLoad?: (clipId: string) => void;
}

const BLEND: Record<string, GlobalCompositeOperation> = {
  normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay',
  'soft-light': 'soft-light', add: 'lighter', difference: 'difference'
};

export class TimelineRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private scratch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private grade: GradePipeline;
  private tl: Timeline | null = null;
  private sources = new Map<string, Source>();
  private loading = new Set<string>();
  private luts = new Map<string, LutData | null>();
  private assetUrl: (id: string | null) => string | null = () => null;
  private assetMeta: (id: string | null) => Record<string, unknown> = () => ({});
  public overlays: { safeAreas?: boolean; guides?: boolean; label?: string | null } = {};
  public quality: 'full' | 'half' | 'quarter' = 'full';

  constructor(opts: RendererOptions) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true })!;
    this.scratch = document.createElement('canvas');
    this.sctx = this.scratch.getContext('2d', { alpha: false })!;
    this.grade = new GradePipeline(this.canvas.width, this.canvas.height);
  }

  setResolvers(url: (id: string | null) => string | null, meta: (id: string | null) => Record<string, unknown>) {
    this.assetUrl = url; this.assetMeta = meta;
  }

  setTimeline(tl: Timeline | null) { this.tl = tl; }

  get webglAvailable() { return this.grade.available; }

  resize(w: number, h: number) {
    const scale = this.quality === 'full' ? 1 : this.quality === 'half' ? 0.5 : 0.25;
    const cw = Math.max(2, Math.round(w * scale)), ch = Math.max(2, Math.round(h * scale));
    if (this.canvas.width !== cw || this.canvas.height !== ch) { this.canvas.width = cw; this.canvas.height = ch; }
    if (this.scratch.width !== cw || this.scratch.height !== ch) { this.scratch.width = cw; this.scratch.height = ch; }
    this.grade.resize(cw, ch);
  }

  private sourceFor(clip: Clip): Source {
    const cached = this.sources.get(clip.id);
    if (cached) return cached;
    if (clip.kind === 'text' || clip.kind === 'adjustment' || clip.kind === 'solid' || clip.kind === 'shape') {
      this.sources.set(clip.id, { kind: 'none' });
      return { kind: 'none' };
    }
    const url = clip.srcUrl ?? this.assetUrl(clip.assetId);
    if (!url) { this.sources.set(clip.id, { kind: 'none' }); return { kind: 'none' }; }
    const meta = (clip.assetId ? this.assetMeta(clip.assetId) : clip.meta) ?? {};
    const motion = (meta.motion ?? clip.meta?.motion) as { frames?: string[]; fps?: number; move?: string; zoomFrom?: number; zoomTo?: number; panX?: number; panY?: number } | undefined;
    const mime = String(meta.mimeType ?? meta.mime ?? '');

    if (motion?.frames?.length) {
      const imgs = motion.frames.map(f => {
        const im = new Image(); im.crossOrigin = 'anonymous'; im.src = f; return im;
      });
      const src: Source = { kind: 'motion', motion: { frames: imgs, fps: motion.fps ?? 12, move: motion.move ?? 'Slow Push', zoomFrom: motion.zoomFrom ?? 1, zoomTo: motion.zoomTo ?? 1.12, panX: motion.panX ?? 0, panY: motion.panY ?? 0 } };
      this.sources.set(clip.id, src);
      return src;
    }
    if (clip.kind === 'video' || mime.startsWith('video/')) {
      const v = document.createElement('video');
      v.crossOrigin = 'anonymous'; v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
      v.addEventListener('loadeddata', () => this.onLoad(clip.id), { once: true });
      v.addEventListener('error', () => this.loading.delete(clip.id), { once: true });
      this.sources.set(clip.id, { kind: 'video', el: v });
      return this.sources.get(clip.id)!;
    }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.src = url;
    im.addEventListener('load', () => this.onLoad(clip.id), { once: true });
    im.addEventListener('error', () => this.loading.delete(clip.id), { once: true });
    this.sources.set(clip.id, { kind: 'image', el: im });
    return this.sources.get(clip.id)!;
  }
  private onLoad(id: string) { this.loading.delete(id); }

  isReady(clip: Clip): boolean {
    const s = this.sources.get(clip.id);
    if (!s) return false;
    if (s.kind === 'image') return s.el.complete && s.el.naturalWidth > 0;
    if (s.kind === 'video') return s.el.readyState >= 2;
    if (s.kind === 'motion') return s.motion.frames.some(f => f.complete && f.naturalWidth > 0);
    return true;
  }

  /** Warm the cache for clips around a time so playback never stalls. */
  preload(t: number, windowSec = 6) {
    if (!this.tl) return;
    for (const tr of this.tl.tracks) {
      if (tr.kind !== 'video' || tr.hidden) continue;
      for (const c of tr.clips) {
        if (c.start <= t + windowSec && c.start + c.duration >= t - 1) this.sourceFor(c);
      }
    }
  }

  async ensureLut(assetId: string | null): Promise<LutData | null> {
    if (!assetId) return null;
    if (this.luts.has(assetId)) return this.luts.get(assetId) ?? null;
    const url = this.assetUrl(assetId);
    if (!url) { this.luts.set(assetId, null); return null; }
    try {
      const res = await fetch(url);
      const text = await res.text();
      const lut = parseCube(text);
      this.luts.set(assetId, lut);
      return lut;
    } catch { this.luts.set(assetId, null); return null; }
  }

  /** Composite the frame at `t` seconds. Returns false if sources are still loading. */
  async render(t: number, opts: { gradeOverride?: Partial<ColorGrade> | null; skipGrade?: boolean } = {}): Promise<boolean> {
    const tl = this.tl;
    if (!tl) return false;
    this.resize(tl.width, tl.height);
    const w = this.canvas.width, h = this.canvas.height;
    const ctx = this.sctx;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    let pending = false;
    const vTracks = tl.tracks.filter(tr => tr.kind === 'video' && !tr.hidden).sort((a, b) => a.index - b.index);
    const adjustmentGrades: { grade: ColorGrade; clip: Clip }[] = [];

    for (const tr of vTracks) {
      const clips = tr.clips.filter(c => t >= c.start - 1e-6 && t < c.start + c.duration - 1e-6 && !c.muted);
      if (!clips.length) continue;
      for (const clip of clips) {
        if (clip.kind === 'adjustment') {
          if (clip.grade) adjustmentGrades.push({ grade: clip.grade, clip });
          continue;
        }
        const alpha = this.clipAlpha(clip, t);
        if (alpha <= 0.002) continue;
        const drawn = this.drawClip(ctx, clip, t, w, h);
        if (!drawn) pending = true;
      }
    }

    // composite to the visible canvas, through the colour pipeline
    const grade = mergeGrades(opts.skipGrade ? null : tl.grade, adjustmentGrades.map(a => a.grade), opts.gradeOverride);
    ctx.restore();

    let source: TexImageSource = this.scratch;
    if (grade && !opts.skipGrade) {
      const lutId = grade.lutAssetId;
      if (lutId) { const lut = await this.ensureLut(lutId); if (lut) this.grade.setLut(lut); }
      else this.grade.setLut(null);
      source = this.grade.apply(this.scratch, grade, t);
    }
    this.ctx.save();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
    this.ctx.drawImage(source as CanvasImageSource, 0, 0, w, h);
    this.ctx.restore();

    if (this.overlays.safeAreas) this.drawSafeAreas(this.ctx, w, h);
    return !pending;
  }

  /** Transition + fade maths for a clip at time t. */
  private clipAlpha(clip: Clip, t: number): number {
    let a = clip.opacity;
    const local = t - clip.start;
    const tr = clip.transform;
    if (tr) a *= typeof tr.opacity === 'number' ? tr.opacity : 1;
    if (clip.fadeIn > 0 && local < clip.fadeIn) a *= Math.max(0, local / clip.fadeIn);
    if (clip.fadeOut > 0 && local > clip.duration - clip.fadeOut) a *= Math.max(0, (clip.duration - local) / clip.fadeOut);
    const td = Math.min(clip.transitionDur ?? 0, clip.duration / 2);
    if (td > 0) {
      if (clip.transitionIn && clip.transitionIn !== 'none' && clip.transitionIn !== 'cut' && local < td) a *= local / td;
      if (clip.transitionOut && clip.transitionOut !== 'none' && clip.transitionOut !== 'cut' && local > clip.duration - td) a *= (clip.duration - local) / td;
    }
    return Math.max(0, Math.min(1, a));
  }

  private drawClip(ctx: CanvasRenderingContext2D, clip: Clip, t: number, w: number, h: number): boolean {
    const src = this.sourceFor(clip);
    const local = Math.max(0, t - clip.start);
    const kf = clip.effects?.find(e => e.type === 'opacity' && e.enabled);
    let alpha = this.clipAlpha(clip, t);
    if (kf?.keyframes?.value?.length) alpha *= sampleKeyframes(kf.keyframes.value, local, 1);

    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
    ctx.globalCompositeOperation = BLEND[clip.blend ?? 'normal'] ?? 'source-over';

    // transitions that need geometry, not just alpha
    const td = Math.min(clip.transitionDur ?? 0, clip.duration / 2);
    if (td > 0 && local < td && clip.transitionIn && !['none', 'cut', 'crossfade'].includes(clip.transitionIn)) {
      this.applyTransitionMask(ctx, clip.transitionIn, local / td, w, h, 'in');
    } else if (td > 0 && local > clip.duration - td && clip.transitionOut && !['none', 'cut', 'crossfade'].includes(clip.transitionOut)) {
      this.applyTransitionMask(ctx, clip.transitionOut, (clip.duration - local) / td, w, h, 'out');
    }

    const tr = clip.transform;
    const scale = tr?.scale ?? 1;
    const rot = ((tr?.rotation ?? 0) * Math.PI) / 180;
    ctx.translate(w / 2 + (tr?.x ?? 0) * w * 0.5, h / 2 + (tr?.y ?? 0) * h * 0.5);
    if (rot) ctx.rotate(rot);
    ctx.scale(tr?.flipH ? -1 : 1, tr?.flipV ? -1 : 1);

    if (clip.kind === 'text') { this.drawText(ctx, clip, local, w, h); ctx.restore(); return true; }
    if (clip.kind === 'solid' || src.kind === 'none') {
      const col = String(clip.meta?.color ?? clip.color ?? '#101010');
      ctx.fillStyle = col;
      const sw = w * scale, sh = h * scale;
      ctx.fillRect(-sw / 2, -sh / 2, sw, sh);
      ctx.restore();
      return true;
    }

    let img: CanvasImageSource | null = null;
    let iw = w, ih = h;
    let extraScale = 1, dx = 0, dy = 0;

    if (src.kind === 'motion') {
      const m = src.motion;
      const frames = m.frames.filter(f => f.complete && f.naturalWidth > 0);
      if (!frames.length) { ctx.restore(); return false; }
      const prog = Math.min(1, Math.max(0, local / Math.max(0.001, clip.duration)));
      const pickIdx = Math.min(frames.length - 1, Math.floor(prog * frames.length));
      img = frames[pickIdx];
      extraScale = m.zoomFrom + (m.zoomTo - m.zoomFrom) * prog;
      dx = m.panX * prog; dy = m.panY * prog;
      iw = (img as HTMLImageElement).naturalWidth || w;
      ih = (img as HTMLImageElement).naturalHeight || h;
    } else if (src.kind === 'video') {
      const v = src.el;
      if (v.readyState < 2) { ctx.restore(); return false; }
      const target = clip.in + local * (clip.speed || 1);
      if (Math.abs(v.currentTime - target) > 0.35) {
        try { v.currentTime = Math.max(0, Math.min((v.duration || target) - 0.05, target)); } catch { /* seek not ready */ }
      }
      img = v; iw = v.videoWidth || w; ih = v.videoHeight || h;
    } else if (src.kind === 'image') {
      if (!src.el.complete || !src.el.naturalWidth) { ctx.restore(); return false; }
      img = src.el; iw = src.el.naturalWidth; ih = src.el.naturalHeight;
    }
    if (!img) { ctx.restore(); return false; }

    // cover-fit then apply user transform
    const crop = tr?.crop;
    const cw = crop ? Math.max(0.05, 1 - (crop.l + crop.r)) : 1;
    const chh = crop ? Math.max(0.05, 1 - (crop.t + crop.b)) : 1;
    const sx = crop ? crop.l * iw : 0, sy = crop ? crop.t * ih : 0;
    const sw = iw * cw, sh = ih * chh;
    const fit = Math.max(w / sw, h / sh) * scale * extraScale;
    const dw = sw * fit, dh = sh * fit;
    ctx.translate(dx * w, dy * h);
    ctx.filter = effectFilter(clip);
    try { ctx.drawImage(img as CanvasImageSource, sx, sy, sw, sh, -dw / 2, -dh / 2, dw, dh); }
    catch { ctx.restore(); return false; }
    ctx.filter = 'none';

    ctx.restore();
    return true;
  }

  private applyTransitionMask(ctx: CanvasRenderingContext2D, kind: string, p: number, w: number, h: number, dir: 'in' | 'out') {
    const e = dir === 'in' ? p : 1 - p;
    switch (kind) {
      case 'wipe-left': ctx.beginPath(); ctx.rect(0, 0, w * e, h); ctx.clip(); break;
      case 'wipe-right': ctx.beginPath(); ctx.rect(w * (1 - e), 0, w * e, h); ctx.clip(); break;
      case 'wipe-up': ctx.beginPath(); ctx.rect(0, h * (1 - e), w, h * e); ctx.clip(); break;
      case 'slide': ctx.translate((1 - e) * w * (dir === 'in' ? 1 : -1), 0); break;
      case 'zoom': { const s = 0.82 + e * 0.18; ctx.translate(w / 2, h / 2); ctx.scale(s, s); ctx.translate(-w / 2, -h / 2); break; }
      case 'dip-black': ctx.globalAlpha *= e; break;
      case 'dip-white': ctx.globalAlpha *= e; break;
      case 'blur': ctx.filter = `blur(${(1 - e) * 14}px)`; break;
      case 'light-leak': ctx.globalAlpha *= 0.35 + e * 0.65; break;
      default: break;
    }
  }

  private drawText(ctx: CanvasRenderingContext2D, clip: Clip, local: number, w: number, h: number) {
    const tx = clip.text; if (!tx) return;
    const animate = tx.animate ?? 'none';
    let a = 1;
    if (animate === 'fade') a = Math.min(1, local / 0.4) * Math.min(1, Math.max(0, (clip.duration - local) / 0.3));
    if (animate === 'rise') a = Math.min(1, local / 0.35);
    const size = (tx.size ?? 44) * (w / 1920) * 2.2;
    ctx.globalAlpha *= Math.max(0, Math.min(1, a));
    ctx.font = `600 ${size}px ${tx.font === 'Courier' ? '"Courier New", monospace' : 'Inter, system-ui, sans-serif'}`;
    ctx.textAlign = (tx.align ?? 'center') as CanvasTextAlign;
    ctx.textBaseline = 'middle';
    const lines = wrap(ctx, tx.content ?? '', w * 0.86);
    const lh = size * 1.28;
    const x = tx.align === 'left' ? w * 0.07 : tx.align === 'right' ? w * 0.93 : w / 2;
    let y = h * (tx.y ?? 0.72) - ((lines.length - 1) * lh) / 2;
    if (animate === 'rise') y += (1 - Math.min(1, local / 0.4)) * size * 0.6;
    if (tx.bg) {
      const maxW = Math.max(...lines.map(l => ctx.measureText(l).width)) + size * 0.7;
      ctx.fillStyle = 'rgba(6,6,5,0.62)';
      roundRect(ctx, x - (tx.align === 'center' ? maxW / 2 : tx.align === 'left' ? size * 0.35 : maxW - size * 0.35), y - lh * 0.62, maxW, lines.length * lh + lh * 0.24, size * 0.16);
      ctx.fill();
    }
    ctx.lineWidth = Math.max(2, size * 0.09);
    ctx.strokeStyle = 'rgba(0,0,0,0.72)';
    ctx.fillStyle = tx.color ?? 'rgb(var(--ink-rgb))';
    for (const line of lines) {
      if (animate === 'type') {
        const chars = Math.floor((local / Math.min(1.6, clip.duration * 0.6)) * line.length);
        ctx.strokeText(line.slice(0, chars), x, y); ctx.fillText(line.slice(0, chars), x, y);
      } else { ctx.strokeText(line, x, y); ctx.fillText(line, x, y); }
      y += lh;
    }
  }

  private drawSafeAreas(ctx: CanvasRenderingContext2D, w: number, h: number) {
    ctx.save();
    ctx.strokeStyle = 'rgba(243,239,232,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([6, 6]);
    ctx.strokeRect(w * 0.05, h * 0.05, w * 0.9, h * 0.9);
    ctx.strokeStyle = 'rgba(243,239,232,0.16)';
    ctx.strokeRect(w * 0.1, h * 0.1, w * 0.8, h * 0.8);
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(243,239,232,0.1)';
    ctx.beginPath();
    ctx.moveTo(w / 3, 0); ctx.lineTo(w / 3, h); ctx.moveTo((w * 2) / 3, 0); ctx.lineTo((w * 2) / 3, h);
    ctx.moveTo(0, h / 3); ctx.lineTo(w, h / 3); ctx.moveTo(0, (h * 2) / 3); ctx.lineTo(w, (h * 2) / 3);
    ctx.stroke();
    ctx.restore();
  }

  destroy() {
    for (const s of this.sources.values()) if (s.kind === 'video') { s.el.pause(); s.el.removeAttribute('src'); s.el.load(); }
    this.sources.clear();
    this.grade.destroy();
  }
}

/** Effects that Canvas2D can honour natively during the source draw. */
function effectFilter(clip: Clip): string {
  const parts: string[] = [];
  for (const fx of clip.effects ?? []) {
    if (!fx.enabled) continue;
    const k = fx.intensity;
    switch (fx.type) {
      case 'blur': case 'gaussian-blur': parts.push(`blur(${Number(fx.params.radius ?? 8) * k}px)`); break;
      case 'sharpen': parts.push(`contrast(${1 + 0.12 * k})`); break;
      case 'grayscale': case 'black-white': parts.push(`grayscale(${k})`); break;
      case 'sepia': parts.push(`sepia(${k})`); break;
      case 'invert': parts.push(`invert(${k})`); break;
      case 'hue-shift': parts.push(`hue-rotate(${Number(fx.params.degrees ?? 0) * k}deg)`); break;
      case 'brightness': parts.push(`brightness(${1 + Number(fx.params.amount ?? 0.2) * k})`); break;
      case 'contrast': parts.push(`contrast(${1 + Number(fx.params.amount ?? 0.3) * k})`); break;
      case 'saturate': parts.push(`saturate(${1 + Number(fx.params.amount ?? 0.4) * k})`); break;
      default: break;
    }
  }
  return parts.length ? parts.join(' ') : 'none';
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Merge timeline grade, adjustment layers and a temporary override. */
export function mergeGrades(base: ColorGrade | null | undefined, adjustments: (ColorGrade | null | undefined)[], override?: Partial<ColorGrade> | null): ColorGrade | null {
  const has = (g: Partial<ColorGrade> | null | undefined) => Boolean(g && Object.entries(g).some(([k, v]) => {
    if (k === 'curves' || k === 'hsl') return false;
    if (Array.isArray(v)) return v.some(n => n !== 0);
    if (typeof v === 'number') return v !== 0 && k !== 'lutAmount';
    return false;
  }));
  if (!has(base) && !adjustments.some(has) && !has(override)) return null;
  const out: ColorGrade = { ...DEFAULT_GRADE, ...(base ?? {}) };
  const nums: (keyof ColorGrade)[] = ['exposure','contrast','highlights','shadows','whites','blacks','temperature','tint','saturation','vibrance','sharpness','fade','vignette','grain'];
  for (const g of [...adjustments, override ?? null]) {
    if (!g) continue;
    for (const k of nums) if (typeof g[k] === 'number') (out as unknown as Record<string, number>)[k as string] = Number(out[k] ?? 0) + Number(g[k]);
    if (g.lutAssetId) { out.lutAssetId = g.lutAssetId; out.lutAmount = g.lutAmount ?? out.lutAmount; }
  }
  for (const k of nums) (out as unknown as Record<string, number>)[k as string] = Math.max(-100, Math.min(100, Number(out[k] ?? 0)));
  return out;
}
