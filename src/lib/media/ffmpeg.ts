import { spawn } from 'node:child_process';
import { config } from '../config';

/**
 * FFmpeg runner.
 *
 * Heavy media work (concat, transcode, ProRes masters, stem muxing, LUT
 * application) belongs in a worker, never in an HTTP request. When the binary
 * is absent we report that honestly and the UI offers the in-browser renderer
 * instead of pretending a render happened.
 */
let cached: boolean | null = null;

export async function hasFfmpeg(): Promise<boolean> {
  if (cached !== null) return cached;
  cached = await new Promise<boolean>(res => {
    const p = spawn(config.ffmpegPath, ['-version'], { stdio: 'ignore' });
    const t = setTimeout(() => { try { p.kill(); } catch { /* noop */ } res(false); }, 4000);
    p.on('error', () => { clearTimeout(t); res(false); });
    p.on('exit', code => { clearTimeout(t); res(code === 0); });
  });
  return cached;
}

export async function ffprobeDuration(file: string): Promise<number | null> {
  if (!(await hasFfmpeg())) return null;
  const bin = config.ffmpegPath.replace(/ffmpeg$/, 'ffprobe');
  return new Promise(res => {
    const p = spawn(bin, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]);
    let out = '';
    p.stdout.on('data', d => out += d);
    p.on('error', () => res(null));
    p.on('exit', () => res(Number(out.trim()) || null));
  });
}

export interface RunResult { code: number | null; stdout: string; stderr: string }

export function run(args: string[], onProgress?: (pct: number, line: string) => void, signal?: AbortSignal): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpegPath, ['-hide_banner', '-nostdin', '-y', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = ''; let total = 0;
    const onAbort = () => { try { p.kill('SIGKILL'); } catch { /* noop */ } };
    signal?.addEventListener('abort', onAbort, { once: true });
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString(); stderr += s;
      const dur = /Duration:\s*(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (dur && !total) total = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
      const t = /time=(\d+):(\d+):(\d+\.\d+)/.exec(s);
      if (t && total && onProgress) {
        const cur = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
        onProgress(Math.min(0.99, cur / total), `encoding ${cur.toFixed(1)}s / ${total.toFixed(1)}s`);
      }
    });
    p.stdout.on('data', d => { stdout += d.toString(); });
    p.on('error', err => { signal?.removeEventListener('abort', onAbort); reject(err); });
    p.on('exit', code => {
      signal?.removeEventListener('abort', onAbort);
      resolve({ code, stdout, stderr: stderr.slice(-4000) });
    });
  });
}

export interface EncodeProfile { format: string; codec: string; quality: 'draft' | 'high' | 'master'; fps: number; width: number; height: number; bitrateMbps: number }

export function videoArgs(p: EncodeProfile): string[] {
  const vcodec = p.codec === 'h265' ? 'libx265' : p.codec === 'prores' ? 'prores_ks' : 'libx264';
  if (p.codec === 'prores') {
    const profile = p.quality === 'master' ? '3' : p.quality === 'high' ? '2' : '0';
    return ['-c:v', vcodec, '-profile:v', profile, '-pix_fmt', 'yuv422p10le', '-r', String(p.fps), '-c:a', 'pcm_s24le', '-f', 'mov'];
  }
  const crf = p.quality === 'master' ? 15 : p.quality === 'high' ? 18 : 24;
  const preset = p.quality === 'master' ? 'slow' : p.quality === 'high' ? 'medium' : 'veryfast';
  return ['-c:v', vcodec, '-preset', preset, '-crf', String(crf), '-pix_fmt', 'yuv420p', '-r', String(p.fps),
    '-c:a', 'aac', '-b:a', p.quality === 'draft' ? '128k' : '320k', '-movflags', '+faststart'];
}
