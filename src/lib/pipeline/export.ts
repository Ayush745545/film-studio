import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { getDb } from '../db';
import { storage, makeKey } from '../storage';
import { saveAsset, getAsset, readAssetBytes } from '../assets';
import { loadTimeline } from '../project';
import { hasFfmpeg, run, videoArgs, type EncodeProfile } from '../media/ffmpeg';
import { decodeWav, encodeWavBuffer, mixdown, peaks, type MixClip, type PcmBuffer } from '../media/wav-io';
import { zip } from '../media/zip';
import { uid, nowIso } from '../ids';
import { config } from '../config';
import { bus } from '../events';
import type { JobContext } from '../queue';
import type { Clip, ExportJob, GenerationJob, Project, Timeline, Track } from '@/types';
import { RES_DIMS, ASPECT_DIMS } from '@/types';

/**
 * Export workers.
 *
 *   ffmpeg  → real server-side renders (H.264/H.265/ProRes, stems muxed)
 *   stems   → real offline audio mixdown per bus (dialogue/SFX/ambience/music)
 *   bundle  → project archive: JSON + every asset, restorable anywhere
 *
 * When ffmpeg is absent the job fails with an actionable message and the UI
 * offers the in-browser renderer instead. It never claims a render happened.
 */

export interface ExportInput {
  projectId: string;
  timelineId?: string;
  engine: 'ffmpeg' | 'stems' | 'bundle';
  format: ExportJob['format'];
  codec: ExportJob['codec'];
  resolution: ExportJob['resolution'];
  fps: number;
  aspectRatio: ExportJob['aspectRatio'];
  quality: ExportJob['quality'];
  bitrate: number;
  range?: [number, number] | null;
  label?: string;
  stemBuses?: ('dialogue' | 'sfx' | 'ambience' | 'music')[];
}

export async function runExport(job: GenerationJob, ctx: JobContext): Promise<{ output: Record<string, unknown>; assetIds: string[]; creditsUsed: number }> {
  const input = (job.input ?? {}) as unknown as ExportInput;
  const db = await getDb();
  const tl = await loadTimeline(input.projectId, input.timelineId);
  if (!tl) throw Object.assign(new Error('Timeline not found'), { code: 'no_timeline', retryable: false });
  const proj = await db.repo('projects').findUnique(input.projectId) as unknown as Project | null;

  const exportRow = await db.repo('exports').create({
    id: uid('exp'), projectId: input.projectId, timelineId: tl.id,
    label: input.label ?? `${input.format.toUpperCase()} ${input.resolution}`,
    format: input.format, codec: input.codec, resolution: input.resolution, fps: input.fps,
    aspectRatio: input.aspectRatio, quality: input.quality, bitrate: input.bitrate,
    status: 'queued', progress: 0, engine: input.engine, assetId: null, error: null,
    rangeIn: input.range?.[0] ?? null, rangeOut: input.range?.[1] ?? null,
    createdAt: nowIso(), finishedAt: null
  } as never) as unknown as ExportJob;
  const publish = (patch: Partial<ExportJob>) => void db.repo('exports').update(exportRow.id, patch as never).then(() =>
    bus.publish({ type: 'export:update', export: { ...exportRow, ...patch } as ExportJob }));

  try {
    const result = input.engine === 'stems' ? await renderStems(job, ctx, tl, input, exportRow, publish)
      : input.engine === 'bundle' ? await renderBundle(job, ctx, tl, input, proj, exportRow, publish)
      : await renderVideo(job, ctx, tl, input, exportRow, publish, proj);
    return result;
  } catch (err) {
    const e = err as Error & { code?: string; suggestion?: string };
    await db.repo('exports').update(exportRow.id, { status: 'failed', error: e.message, finishedAt: nowIso() } as never);
    publish({ status: 'failed', error: e.message });
    throw err;
  }
}

async function dims(input: ExportInput) {
  const short = RES_DIMS[input.resolution] ?? 1080;
  const d = ASPECT_DIMS[input.aspectRatio as keyof typeof ASPECT_DIMS] ?? { w: 16, h: 9 };
  const landscape = d.w >= d.h;
  let w = landscape ? Math.round(short * d.w / d.h) : short;
  let h = landscape ? short : Math.round(short * d.h / d.w);
  w = Math.round(w / 2) * 2; h = Math.round(h / 2) * 2;
  return { w, h };
}

/* ── ffmpeg video render ──────────────────────────────────── */
async function renderVideo(job: GenerationJob, ctx: JobContext, tl: Timeline, input: ExportInput, row: ExportJob, publish: (p: Partial<ExportJob>) => void, proj: Project | null) {
  if (!(await hasFfmpeg())) {
    throw Object.assign(new Error('FFmpeg is not installed on this server'), {
      code: 'no_ffmpeg', retryable: false,
      suggestion: 'Install ffmpeg (or set FFMPEG_PATH) for server renders. Meanwhile use "Export in browser" on the Export page — it renders the same timeline with the WebCodecs/Canvas pipeline and produces a real WebM/MP4 file.'
    });
  }
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'afs-export-'));
  const { w, h } = await dims(input);
  await ctx.progress(0.03, 'Staging media');
  publish({ status: 'rendering' });

  const vTracks = tl.tracks.filter(t => t.kind === 'video' && !t.hidden).sort((a, b) => a.index - b.index);
  const aTracks = tl.tracks.filter(t => t.kind === 'audio' && !t.muted).sort((a, b) => a.index - b.index);
  const [from, to] = input.range ?? [0, tl.durationSec];

  // materialise every referenced asset to disk
  const files = new Map<string, string>();
  const staged: { clip: Clip; track: Track; file: string }[] = [];
  for (const t of [...vTracks, ...aTracks]) {
    for (const c of t.clips) {
      if (c.start + c.duration < from || c.start > to) continue;
      if (!c.assetId || files.has(c.assetId)) { if (c.assetId && files.has(c.assetId)) staged.push({ clip: c, track: t, file: files.get(c.assetId)! }); continue; }
      const bytes = await readAssetBytes(c.assetId);
      if (!bytes) { await ctx.log('warn', `Missing media for "${c.name}" — skipped`); continue; }
      const ext = bytes.mime.includes('svg') ? 'svg' : (bytes.mime.split('/')[1] ?? 'bin').split(';')[0];
      const f = path.join(tmp, `${c.assetId}.${ext}`);
      await fs.writeFile(f, Buffer.from(bytes.data));
      files.set(c.assetId, f);
      staged.push({ clip: c, track: t, file: f });
      await ctx.progress(0.03 + (files.size / Math.max(1, tl.tracks.reduce((a, t2) => a + t2.clips.length, 0))) * 0.12, `Staged ${files.size} file(s)`);
    }
  }
  if (!staged.length) throw Object.assign(new Error('Nothing in the export range has media'), { code: 'empty_timeline', retryable: false, suggestion: 'Generate or import media first, or widen the in/out range.' });

  // Build a concat-based video spine from the lowest video track, overlaying higher tracks.
  const inputs: string[] = [];
  const index = new Map<string, number>();
  const addInput = (f: string) => { const i = inputs.length; inputs.push(f); index.set(f, i); return i; };
  const spine = staged.filter(s => s.track.kind === 'video').sort((a, b) => (a.track.index - b.track.index) || (a.clip.start - b.clip.start));
  const concatList = path.join(tmp, 'concat.txt');
  const lines: string[] = [];
  for (const s of spine) {
    const isSvg = s.file.endsWith('.svg');
    if (isSvg) {
      // rasterise SVG plates through ffmpeg's svg decoder
      const png = s.file.replace(/\.svg$/, '.png');
      const r = await run(['-i', s.file, '-frames:v', '1', '-y', png]);
      if (r.code === 0) { lines.push(`file '${png}'`, `duration ${s.clip.duration.toFixed(3)}`); s.file = png; }
      else { await ctx.log('warn', 'SVG plate could not be rasterised by this ffmpeg build — converting via image input instead'); lines.push(`file '${s.file}'`, `duration ${s.clip.duration.toFixed(3)}`); }
    } else {
      lines.push(`file '${s.file}'`, `duration ${s.clip.duration.toFixed(3)}`);
    }
  }
  if (lines.length) { lines.push(`file '${spine[spine.length - 1].file}'`); }
  await fs.writeFile(concatList, lines.join('\n'));

  const audio = staged.filter(s => s.track.kind === 'audio');
  const audioInputs = audio.map(s => addInput(s.file));
  const grade = tl.grade;
  const vf = buildVideoFilter(grade, w, h, tl.fps);

  const args: string[] = [];
  args.push('-f', 'concat', '-safe', '0', '-i', concatList);
  for (const i of audioInputs) args.push('-i', inputs[i]);
  const filter: string[] = [vf ? `[0:v]${vf}[vout]` : '[0:v]null[vout]'];
  if (audioInputs.length) {
    const mixes = audio.map((s, i) => `[${i + 1}:a]volume=${(s.clip.volume * s.track.volume).toFixed(3)},adelay=${Math.max(0, Math.round((s.clip.start - from) * 1000))}|${Math.max(0, Math.round((s.clip.start - from) * 1000))}[a${i}]`);
    filter.push(...mixes);
    filter.push(`${mixes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${mixes.length}:duration=longest:normalize=0,alimiter=limit=0.95[aout]`);
    args.push('-map', '[vout]', '-map', '[aout]');
  } else {
    args.push('-map', '[vout]');
  }
  const profile: EncodeProfile = { format: input.format, codec: input.codec, quality: input.quality, fps: input.fps, width: w, height: h, bitrateMbps: input.bitrate };
  args.push('-filter_complex', filter.join(';'), ...videoArgs(profile), '-t', String(Math.max(0.1, to - from)));
  const outExt = input.format === 'mov' ? 'mov' : input.format === 'webm' ? 'webm' : 'mp4';
  const outFile = path.join(tmp, `export.${outExt}`);
  args.push(outFile);

  await ctx.progress(0.2, 'Encoding');
  publish({ status: 'encoding' });
  const res = await run(args, (p, line) => { void ctx.progress(0.2 + p * 0.7, line); publish({ progress: Math.round((0.2 + p * 0.7) * 100) / 100 }); }, ctx.signal);
  if (res.code !== 0) {
    throw Object.assign(new Error(`FFmpeg exited with code ${res.code}`), {
      code: 'ffmpeg_failed', retryable: true,
      providerMessage: res.stderr.slice(-1200),
      suggestion: 'Check the log — common causes are an unsupported codec for this container, a missing SVG decoder, or a clip whose media file is absent.'
    });
  }

  const data = new Uint8Array(await fs.readFile(outFile));
  const mime = outExt === 'mov' ? 'video/quicktime' : outExt === 'webm' ? 'video/webm' : 'video/mp4';
  await ctx.progress(0.95, 'Saving to library');
  const asset = await saveAsset({
    userId: job.userId, projectId: input.projectId, kind: 'export',
    name: `${proj?.name ?? 'Project'} — ${input.label ?? `${input.resolution} ${input.format}`}`,
    data, mime, modelId: null, providerId: null, generationId: job.id, demo: false,
    width: w, height: h, durationSec: to - from, tags: ['export', input.quality],
    meta: { codec: input.codec, fps: input.fps, bitrate: input.bitrate, engine: 'ffmpeg', timelineId: tl.id }
  });
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  await getDb().then(db => db.repo('exports').update(row.id, { status: 'succeeded', progress: 1, assetId: asset.id, finishedAt: nowIso() } as never));
  publish({ status: 'succeeded', progress: 1, assetId: asset.id });
  await ctx.progress(1, 'Done');
  return { output: { assetId: asset.id, exportId: row.id, engine: 'ffmpeg', bytes: data.byteLength }, assetIds: [asset.id], creditsUsed: 0 };
}

function buildVideoFilter(g: Timeline['grade'], w: number, h: number, fps: number): string {
  const parts: string[] = [`scale=${w}:${h}:force_original_aspect_ratio=decrease`, `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`, `fps=${fps}`, 'setsar=1'];
  if (!g) return parts.join(',');
  const brightness = (g.exposure / 100) * 0.5 + (g.shadows / 100) * 0.12;
  const contrast = 1 + g.contrast / 100;
  const saturation = Math.max(0, 1 + (g.saturation / 100) + (g.vibrance / 160));
  if (brightness || contrast !== 1 || saturation !== 1) parts.push(`eq=brightness=${brightness.toFixed(3)}:contrast=${contrast.toFixed(3)}:saturation=${saturation.toFixed(3)}`);
  const warm = g.temperature / 100;
  if (warm) parts.push(`colorbalance=rs=${(warm * 0.12).toFixed(3)}:bs=${(-warm * 0.12).toFixed(3)}:rm=${(warm * 0.06).toFixed(3)}:bm=${(-warm * 0.06).toFixed(3)}`);
  if (g.tint) parts.push(`colorbalance=gs=${(-g.tint / 100 * 0.1).toFixed(3)}:gm=${(-g.tint / 100 * 0.05).toFixed(3)}`);
  if (g.highlights) parts.push(`colorbalance=rh=${(g.highlights / 100 * 0.08).toFixed(3)}:gh=${(g.highlights / 100 * 0.06).toFixed(3)}:bh=${(-g.highlights / 100 * 0.04).toFixed(3)}`);
  if (g.fade) parts.push(`curves=master='0/${(g.fade / 100 * 0.12).toFixed(3)} 1/1'`);
  if (g.sharpness) parts.push(`unsharp=5:5:${(g.sharpness / 100 * 1.2).toFixed(2)}:5:5:0`);
  if (g.grain) parts.push(`noise=alls=${Math.round(g.grain / 6)}:allf=t+u`);
  if (g.vignette) parts.push(`vignette=PI/${(5 - g.vignette / 40).toFixed(2)}`);
  return parts.join(',');
}

/* ── stems: real offline audio mixdown ────────────────────── */
async function renderStems(job: GenerationJob, ctx: JobContext, tl: Timeline, input: ExportInput, row: ExportJob, publish: (p: Partial<ExportJob>) => void) {
  const buses = input.stemBuses ?? ['dialogue', 'sfx', 'ambience', 'music'];
  const aTracks = tl.tracks.filter(t => t.kind === 'audio');
  const clipsByBus = new Map<string, MixClip[]>();
  for (const b of buses) clipsByBus.set(b, []);
  const cache = new Map<string, PcmBuffer | null>();

  const busOf = (c: Clip): string => {
    const kind = String(c.meta?.kind ?? '');
    if (kind === 'score' || kind === 'music' || c.color === '#46334F') return 'music';
    if (kind === 'ambience') return 'ambience';
    if (c.meta?.voiceLineId || c.color === '#3A4A52') return 'dialogue';
    return 'sfx';
  };

  await ctx.progress(0.05, 'Decoding audio');
  for (const t of aTracks) {
    if (t.muted) continue;
    for (const c of t.clips) {
      if (c.muted || !c.assetId) continue;
      if (!cache.has(c.assetId)) {
        const bytes = await readAssetBytes(c.assetId);
        cache.set(c.assetId, bytes && bytes.mime.startsWith('audio') ? decodeWav(bytes.data) : null);
      }
      const pcm = cache.get(c.assetId)!;
      const bus = busOf(c);
      if (!clipsByBus.has(bus)) clipsByBus.set(bus, []);
      clipsByBus.get(bus)!.push({ src: pcm, start: c.start, duration: c.duration, inPoint: c.in / (c.speed || 1), speed: c.speed || 1, volume: c.volume * t.volume, pan: c.pan + t.pan, fadeIn: c.fadeIn, fadeOut: c.fadeOut, loop: Boolean(c.meta?.loop) });
    }
  }

  const total = tl.durationSec || 1;
  const ids: string[] = [];
  let i = 0;
  for (const [bus, clips] of clipsByBus) {
    i++;
    await ctx.progress(i / (clipsByBus.size + 1), `Mixing ${bus} stem (${clips.length} clips)`);
    publish({ status: 'rendering', progress: i / (clipsByBus.size + 1) });
    const mixed = mixdown(clips, total);
    const wav = encodeWavBuffer(mixed);
    const asset = await saveAsset({
      userId: job.userId, projectId: input.projectId, kind: 'audio',
      name: `${input.label ?? 'Stem'} — ${bus.toUpperCase()}`,
      data: wav, mime: 'audio/wav', generationId: job.id, demo: false, durationSec: total,
      tags: ['stem', bus, 'export'], meta: { peaks: peaks(mixed[0]), bus, clips: clips.length, engine: 'mixdown' }
    });
    ids.push(asset.id);
  }
  await getDb().then(db => db.repo('exports').update(row.id, { status: 'succeeded', progress: 1, assetId: ids[0] ?? null, finishedAt: nowIso() } as never));
  publish({ status: 'succeeded', progress: 1 });
  await ctx.progress(1, 'Done');
  return { output: { assetIds: ids, engine: 'mixdown', buses: [...clipsByBus.keys()] }, assetIds: ids, creditsUsed: 0 };
}

/* ── project bundle ───────────────────────────────────────── */
async function renderBundle(job: GenerationJob, ctx: JobContext, tl: Timeline, input: ExportInput, proj: Project | null, row: ExportJob, publish: (p: Partial<ExportJob>) => void) {
  const db = await getDb();
  await ctx.progress(0.1, 'Collecting project');
  const [characters, locations, scenes, shots, voices, sounds, assets, versions] = await Promise.all([
    db.repo('characters').findMany({ where: { projectId: input.projectId } }),
    db.repo('locations').findMany({ where: { projectId: input.projectId } }),
    db.repo('scenes').findMany({ where: { projectId: input.projectId } }),
    db.repo('shots').findMany({ where: { projectId: input.projectId } }),
    db.repo('voices').findMany({ where: { projectId: input.projectId } }),
    db.repo('sounds').findMany({ where: { projectId: input.projectId } }),
    db.repo('assets').findMany({ where: { projectId: input.projectId } }),
    db.repo('projectVersions').findMany({ where: { projectId: input.projectId }, orderBy: { rev: 'desc' }, take: 5 })
  ]);
  const manifest = {
    format: 'ai-film-studio/project-bundle', version: 1, exportedAt: nowIso(),
    project: proj, timeline: tl, characters, locations, scenes, shots, voices, sounds,
    assets: (assets as any[]).map(a => ({ ...a, file: `assets/${a.storageKey.split('/').pop()}` })),
    recentVersions: (versions as any[]).map(v => ({ rev: v.rev, label: v.label, reason: v.reason, createdAt: v.createdAt }))
  };
  const entries: { name: string; data: Uint8Array | string }[] = [
    { name: 'project.json', data: JSON.stringify(manifest, null, 2) },
    { name: 'README.txt', data: `AI FILM STUDIO project bundle\n==============================\nProject: ${proj?.name ?? input.projectId}\nExported: ${manifest.exportedAt}\nAssets: ${(assets as any[]).length}\n\nproject.json contains the full project graph (idea, story, screenplay, characters,\nlocations, scenes, shots, timeline, voices, sound cues). Media files are under assets/.\nRe-import via Projects → Import bundle.` }
  ];
  let n = 0;
  for (const a of assets as any[]) {
    n++;
    await ctx.progress(0.1 + (n / Math.max(1, (assets as any[]).length)) * 0.8, `Packing ${n}/${(assets as any[]).length}`);
    if (!a.storageKey) continue;
    const bytes = await storage().get(a.storageKey);
    if (bytes && bytes.byteLength < 60 * 1024 * 1024) entries.push({ name: `assets/${a.storageKey.split('/').pop()}`, data: bytes });
  }
  publish({ status: 'encoding', progress: 0.9 });
  const zipped = zip(entries);
  const asset = await saveAsset({
    userId: job.userId, projectId: input.projectId, kind: 'project',
    name: `${proj?.name ?? 'Project'} — bundle`, data: zipped, mime: 'application/zip',
    generationId: job.id, demo: false, tags: ['bundle', 'export'],
    meta: { entries: entries.length, engine: 'bundle' }
  });
  await db.repo('exports').update(row.id, { status: 'succeeded', progress: 1, assetId: asset.id, finishedAt: nowIso() } as never);
  publish({ status: 'succeeded', progress: 1 });
  await ctx.progress(1, 'Done');
  return { output: { assetId: asset.id, entries: entries.length, bytes: zipped.byteLength, engine: 'bundle' }, assetIds: [asset.id], creditsUsed: 0 };
}

/* ── browser-rendered exports land here ───────────────────── */
export async function recordBrowserExport(input: {
  userId: string; projectId: string; timelineId: string; label: string;
  format: ExportJob['format']; codec: ExportJob['codec']; resolution: ExportJob['resolution'];
  fps: number; aspectRatio: ExportJob['aspectRatio']; quality: ExportJob['quality'];
  data: Uint8Array; mime: string; durationSec: number; width: number; height: number;
}): Promise<{ assetId: string; exportId: string }> {
  const db = await getDb();
  const asset = await saveAsset({
    userId: input.userId, projectId: input.projectId, kind: 'export', name: input.label,
    data: input.data, mime: input.mime, generationId: null, demo: false,
    width: input.width, height: input.height, durationSec: input.durationSec,
    tags: ['export', 'browser-render', input.quality],
    meta: { engine: 'browser', codec: input.codec, fps: input.fps, timelineId: input.timelineId }
  });
  const row = await db.repo('exports').create({
    id: uid('exp'), projectId: input.projectId, timelineId: input.timelineId, label: input.label,
    format: input.format, codec: input.codec, resolution: input.resolution, fps: input.fps,
    aspectRatio: input.aspectRatio, quality: input.quality, bitrate: 0,
    status: 'succeeded', progress: 1, engine: 'browser', assetId: asset.id, error: null,
    rangeIn: null, rangeOut: null, createdAt: nowIso(), finishedAt: nowIso()
  } as never) as unknown as ExportJob;
  bus.publish({ type: 'export:update', export: row });
  return { assetId: asset.id, exportId: row.id };
}

export function storagePathFor(key: string) { return path.resolve(config.storageDir, key); }
export { makeKey, getAsset };
