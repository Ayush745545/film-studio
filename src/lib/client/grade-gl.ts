'use client';
import type { ColorGrade } from '@/types';

/**
 * WebGL colour pipeline.
 *
 * One fragment shader implements the full grade: exposure → white balance →
 * lift/gamma/gain → contrast → curves (real 1D LUT textures per channel) →
 * shadow/highlight/white/black pivots → saturation/vibrance → split tone →
 * fade → sharpen (unsharp mask) → vignette → film grain, with optional 3D LUT
 * applied from a .cube strip texture.
 *
 * If WebGL is unavailable the renderer falls back to a Canvas2D approximation
 * so grading still previews (with fewer controls) rather than silently doing
 * nothing.
 */

const VERT = `attribute vec2 aPos; varying vec2 vUv;
void main(){ vUv = (aPos + 1.0) * 0.5; vUv.y = 1.0 - vUv.y; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform sampler2D uCurveR, uCurveG, uCurveB, uCurveM;
uniform sampler2D uLut;
uniform vec2 uRes;
uniform float uTime, uHasLut, uLutSize, uLutAmount;
uniform float uExposure, uContrast, uSaturation, uVibrance, uTemperature, uTint;
uniform float uHighlights, uShadows, uWhites, uBlacks, uFade, uVignette, uGrain, uSharpness;
uniform vec3 uLift, uGamma, uGain;
uniform vec3 uSplitShadows, uSplitHighlights;
uniform float uSplitBalance;

float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

vec3 applyLut(vec3 c){
  if (uHasLut < 0.5 || uLutAmount <= 0.001) return c;
  float n = uLutSize;
  vec3 q = clamp(c, 0.0, 1.0) * (n - 1.0);
  float b0 = floor(q.b);
  float b1 = min(b0 + 1.0, n - 1.0);
  float bf = q.b - b0;
  // strip layout: width = n*n (blue slices left to right), height = n
  vec2 uv0 = vec2((b0 * n + q.r + 0.5) / (n * n), (q.g + 0.5) / n);
  vec2 uv1 = vec2((b1 * n + q.r + 0.5) / (n * n), (q.g + 0.5) / n);
  vec3 a = texture2D(uLut, uv0).rgb;
  vec3 b = texture2D(uLut, uv1).rgb;
  return mix(c, mix(a, b, bf), clamp(uLutAmount, 0.0, 1.0));
}

float curve(sampler2D s, float v){ return texture2D(s, vec2(clamp(v, 0.0, 1.0), 0.5)).r; }

void main(){
  vec2 px = 1.0 / uRes;
  vec3 c = texture2D(uTex, vUv).rgb;

  // unsharp mask
  if (uSharpness > 0.001) {
    vec3 blur = (texture2D(uTex, vUv + vec2(px.x, 0.0)).rgb
              + texture2D(uTex, vUv - vec2(px.x, 0.0)).rgb
              + texture2D(uTex, vUv + vec2(0.0, px.y)).rgb
              + texture2D(uTex, vUv - vec2(0.0, px.y)).rgb) * 0.25;
    c += (c - blur) * uSharpness * 1.6;
  }

  c *= pow(2.0, uExposure);
  c.r *= 1.0 + uTemperature * 0.14; c.b *= 1.0 - uTemperature * 0.14;
  c.g *= 1.0 - uTint * 0.10; c.r *= 1.0 + uTint * 0.04; c.b *= 1.0 + uTint * 0.04;

  c = max(c, 0.0) * uGain;
  c = pow(max(c, vec3(0.0)), max(vec3(0.05), 1.0 / max(vec3(0.2), 1.0 + uGamma)));
  c = c + uLift * (1.0 - c) * 0.6;

  c = (c - 0.5) * (1.0 + uContrast) + 0.5;
  c.r = curve(uCurveR, curve(uCurveM, c.r));
  c.g = curve(uCurveG, curve(uCurveM, c.g));
  c.b = curve(uCurveB, curve(uCurveM, c.b));

  float l = lum(c);
  float shadowW = 1.0 - smoothstep(0.0, 0.55, l);
  float highW = smoothstep(0.45, 1.0, l);
  c += uShadows * 0.35 * shadowW;
  c += uHighlights * 0.35 * highW;
  c += uBlacks * 0.30 * (1.0 - smoothstep(0.0, 0.18, l));
  c += uWhites * 0.30 * smoothstep(0.82, 1.0, l);

  float mx = max(max(c.r, c.g), c.b);
  float sat = uSaturation + uVibrance * (1.0 - mx) * 0.8;
  c = mix(vec3(l), c, clamp(1.0 + sat, 0.0, 3.0));

  float sb = clamp(uSplitBalance * 0.01, -1.0, 1.0);
  c = mix(c, c * (0.55 + uSplitShadows * 0.9), shadowW * abs(sb) * 0.55);
  c = mix(c, c * (0.55 + uSplitHighlights * 0.9), highW * abs(sb) * 0.45);

  c = mix(c, max(c, vec3(uFade * 0.14)), 1.0);
  c = applyLut(clamp(c, 0.0, 1.0));

  if (uVignette > 0.001) {
    vec2 d = (vUv - 0.5) * vec2(uRes.x / uRes.y, 1.0);
    float v = smoothstep(0.42, 1.05, length(d) * 1.35);
    c *= 1.0 - v * uVignette * 0.85;
  }
  if (uGrain > 0.001) {
    float g = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
    c += g * uGrain * 0.22;
  }
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src); gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`shader compile failed: ${log}`);
  }
  return sh;
}

function identityCurveTexture(gl: WebGLRenderingContext) {
  const data = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) { data[i * 4] = i; data[i * 4 + 1] = i; data[i * 4 + 2] = i; data[i * 4 + 3] = 255; }
  return makeTex(gl, data, 256, 1);
}

function makeTex(gl: WebGLRenderingContext, data: Uint8Array, w: number, h: number) {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function curveTexture(gl: WebGLRenderingContext, tex: WebGLTexture | null, pts: [number, number][], prev: Uint8Array | null): { tex: WebGLTexture; data: Uint8Array } {
  const data = prev ?? new Uint8Array(256 * 4);
  const sorted = [...(pts?.length ? pts : [[0, 0], [1, 1]] as [number, number][])].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    let y = x;
    for (let k = 0; k < sorted.length - 1; k++) {
      const [x0, y0] = sorted[k]; const [x1, y1] = sorted[k + 1];
      if (x >= x0 && x <= x1) {
        const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
        y = y0 + (y1 - y0) * (t * t * (3 - 2 * t));   // smoothstep interpolation
        break;
      }
    }
    const v = Math.max(0, Math.min(255, Math.round(y * 255)));
    data[i * 4] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
  }
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  return { tex: tex!, data };
}

export interface LutData { size: number; data: Uint8Array }

/** Parse a .cube LUT into an RGBA strip texture (size×size slices laid out horizontally). */
export function parseCube(text: string): LutData | null {
  const lines = text.split(/\r?\n/);
  let size = 0; const values: number[] = [];
  let domainMin = [0, 0, 0], domainMax = [1, 1, 1];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const up = line.toUpperCase();
    if (up.startsWith('TITLE')) continue;
    if (up.startsWith('LUT_3D_SIZE')) { size = parseInt(line.split(/\s+/)[1], 10); continue; }
    if (up.startsWith('DOMAIN_MIN')) { domainMin = line.split(/\s+/).slice(1).map(Number); continue; }
    if (up.startsWith('DOMAIN_MAX')) { domainMax = line.split(/\s+/).slice(1).map(Number); continue; }
    if (up.startsWith('LUT_1D_SIZE') || up.startsWith('DOMAIN')) continue;
    const parts = line.split(/[\s,]+/).map(Number);
    if (parts.length >= 3 && parts.every(Number.isFinite)) values.push(...parts.slice(0, 3));
  }
  if (!size || values.length < size * size * size * 3) return null;
  const n = size;
  const out = new Uint8Array(n * n * n * 4);
  const sx = domainMax[0] - domainMin[0] || 1, sy = domainMax[1] - domainMin[1] || 1, sz = domainMax[2] - domainMin[2] || 1;
  let i = 0;
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const rr = (values[i] - domainMin[0]) / sx, gg = (values[i + 1] - domainMin[1]) / sy, bb = (values[i + 2] - domainMin[2]) / sz;
    const o = (b * n * n + g * n + r) * 4;
    out[o] = clamp255(rr); out[o + 1] = clamp255(gg); out[o + 2] = clamp255(bb); out[o + 3] = 255;
    i += 3;
  }
  return { size: n, data: out };
}
const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));

export class GradePipeline {
  private gl: WebGLRenderingContext | null = null;
  private prog: WebGLProgram | null = null;
  private buf: WebGLBuffer | null = null;
  private srcTex: WebGLTexture | null = null;
  private curves: Record<string, WebGLTexture> = {};
  private curveData: Record<string, Uint8Array> = {};
  private lutTex: WebGLTexture | null = null;
  private lutSize = 0;
  private out: HTMLCanvasElement;
  private octx: CanvasRenderingContext2D | null;
  private lastSig = '';
  readonly available: boolean;

  constructor(private width = 1920, private height = 1080) {
    this.out = document.createElement('canvas');
    this.out.width = width; this.out.height = height;
    this.octx = this.out.getContext('2d', { alpha: false });
    const gl = (this.out.getContext('webgl', { alpha: false, preserveDrawingBuffer: true, antialias: false })
      ?? this.out.getContext('experimental-webgl', { alpha: false, preserveDrawingBuffer: true })) as WebGLRenderingContext | null;
    this.gl = gl;
    this.available = Boolean(gl);
    if (!gl) return;
    try {
      const prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
      this.prog = prog;
      this.buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      this.srcTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      for (const k of ['R', 'G', 'B', 'M']) {
        this.curves[k] = identityCurveTexture(gl);
        this.curveData[k] = new Uint8Array(256 * 4);
      }
      this.lutTex = gl.createTexture();
    } catch (err) {
      console.warn('[grade] WebGL unavailable, falling back to Canvas2D:', (err as Error).message);
      this.gl = null; this.available = false;
    }
  }

  resize(w: number, h: number) {
    if (w === this.width && h === this.height) return;
    this.width = Math.max(2, w); this.height = Math.max(2, h);
    this.out.width = this.width; this.out.height = this.height;
  }

  setLut(lut: LutData | null) {
    const gl = this.gl; if (!gl) return;
    if (!lut) { this.lutSize = 0; return; }
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    // strip layout: (size*size) x size
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lut.size * lut.size, lut.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.lutSize = lut.size;
  }

  /** Apply the grade to `src` and return a canvas ready to blit. */
  apply(src: TexImageSource, grade: ColorGrade | null, t: number): HTMLCanvasElement {
    const gl = this.gl;
    if (!gl || !this.prog || !grade) { this.blit2d(src, grade); return this.out; }

    const sig = JSON.stringify([grade.exposure, grade.contrast, grade.saturation, grade.vibrance, grade.temperature, grade.tint,
      grade.highlights, grade.shadows, grade.whites, grade.blacks, grade.fade, grade.vignette, grade.grain, grade.sharpness,
      grade.lift, grade.gamma, grade.gain, grade.curves, grade.splitBalance, this.lutSize, grade.lutAmount]);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      curveTexture(gl, this.curves.R, grade.curves.red, this.curveData.R);
      curveTexture(gl, this.curves.G, grade.curves.green, this.curveData.G);
      curveTexture(gl, this.curves.B, grade.curves.blue, this.curveData.B);
      curveTexture(gl, this.curves.M, grade.curves.rgb, this.curveData.M);
    }

    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); }
    catch { this.blit2d(src, grade); return this.out; }

    const u = (n: string) => gl.getUniformLocation(this.prog!, n);
    gl.uniform1i(u('uTex'), 0);
    gl.uniform2f(u('uRes'), this.width, this.height);
    gl.uniform1f(u('uTime'), t);
    const p = (n: string, v: number, scale = 1) => gl.uniform1f(u(n), (v ?? 0) * scale);
    p('uExposure', grade.exposure, 0.02);
    p('uContrast', grade.contrast, 0.01);
    p('uSaturation', grade.saturation, 0.01);
    p('uVibrance', grade.vibrance, 0.01);
    p('uTemperature', grade.temperature, 0.01);
    p('uTint', grade.tint, 0.01);
    p('uHighlights', grade.highlights, 0.01);
    p('uShadows', grade.shadows, 0.01);
    p('uWhites', grade.whites, 0.01);
    p('uBlacks', grade.blacks, 0.01);
    p('uFade', grade.fade, 0.01);
    p('uVignette', grade.vignette, 0.01);
    p('uGrain', grade.grain, 0.01);
    p('uSharpness', grade.sharpness, 0.01);
    gl.uniform3fv(u('uLift'), grade.lift.map(v => v * 0.01));
    gl.uniform3fv(u('uGamma'), grade.gamma.map(v => v * 0.01));
    gl.uniform3fv(u('uGain'), [1 + grade.gain[0] * 0.01, 1 + grade.gain[1] * 0.01, 1 + grade.gain[2] * 0.01]);
    gl.uniform3fv(u('uSplitShadows'), hexToRgb01(grade.splitShadows));
    gl.uniform3fv(u('uSplitHighlights'), hexToRgb01(grade.splitHighlights));
    gl.uniform1f(u('uSplitBalance'), (grade.splitBalance ?? 0) * 0.01);
    gl.uniform1f(u('uLutAmount'), (grade.lutAmount ?? 100) / 100);
    gl.uniform1f(u('uHasLut'), this.lutSize ? 1 : 0);
    gl.uniform1f(u('uLutSize'), this.lutSize || 2);

    let unit = 1;
    for (const [name, key] of [['uCurveR', 'R'], ['uCurveG', 'G'], ['uCurveB', 'B'], ['uCurveM', 'M']] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.curves[key]);
      gl.uniform1i(u(name), unit);
      unit++;
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.uniform1i(u('uLut'), unit);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return this.out;
  }

  private blit2d(src: TexImageSource, grade: ColorGrade | null) {
    const ctx = this.octx; if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, this.width, this.height);
    if (grade) {
      const f: string[] = [];
      if (grade.exposure) f.push(`brightness(${1 + grade.exposure * 0.02})`);
      if (grade.contrast) f.push(`contrast(${1 + grade.contrast * 0.012})`);
      if (grade.saturation || grade.vibrance) f.push(`saturate(${Math.max(0, 1 + (grade.saturation + grade.vibrance * 0.5) * 0.012)})`);
      if (grade.temperature) f.push(`sepia(${Math.min(0.5, Math.abs(grade.temperature) * 0.004)}) hue-rotate(${grade.temperature > 0 ? -12 : 12}deg)`);
      if (grade.sharpness) f.push(`contrast(${1 + grade.sharpness * 0.002})`);
      if (f.length) ctx.filter = f.join(' ');
    }
    try { ctx.drawImage(src as CanvasImageSource, 0, 0, this.width, this.height); } catch { /* not ready */ }
    ctx.filter = 'none';
    if (grade) {
      if (grade.fade) { ctx.globalAlpha = grade.fade * 0.0014; ctx.fillStyle = '#8b8b8b'; ctx.fillRect(0, 0, this.width, this.height); ctx.globalAlpha = 1; }
      if (grade.vignette) {
        const g = ctx.createRadialGradient(this.width / 2, this.height / 2, Math.min(this.width, this.height) * 0.28, this.width / 2, this.height / 2, Math.max(this.width, this.height) * 0.72);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, grade.vignette * 0.009)})`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, this.width, this.height);
      }
      if (grade.shadows < 0) { ctx.globalAlpha = Math.min(0.4, -grade.shadows * 0.006); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, this.width, this.height); ctx.globalAlpha = 1; }
      if (grade.highlights > 0) { ctx.globalAlpha = Math.min(0.3, grade.highlights * 0.004); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, this.width, this.height); ctx.globalAlpha = 1; }
    }
    ctx.restore();
  }

  get canvas() { return this.out; }
  destroy() {
    const gl = this.gl;
    if (gl) {
      if (this.prog) gl.deleteProgram(this.prog);
      if (this.buf) gl.deleteBuffer(this.buf);
      if (this.srcTex) gl.deleteTexture(this.srcTex);
      Object.values(this.curves).forEach(t => gl.deleteTexture(t));
      if (this.lutTex) gl.deleteTexture(this.lutTex);
      const ext = gl.getExtension('WEBGL_lose_context');
      ext?.loseContext();
    }
    this.gl = null;
  }
}

function hexToRgb01(hex: string): [number, number, number] {
  const c = (hex || '#000').replace('#', '');
  const n = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  const v = parseInt(n, 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}
export { hexToRgb01 };
