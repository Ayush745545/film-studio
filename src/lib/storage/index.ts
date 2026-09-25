import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { sign, verifySignature } from '../security/crypto';
import { uid } from '../ids';

/**
 * Object-storage abstraction.
 *
 * PostgreSQL holds metadata only — every generated image, video, audio file,
 * storyboard, thumbnail and export lives in object storage behind this
 * interface. Swapping `local` for S3/R2/MinIO changes nothing upstream.
 */
export interface PutResult { key: string; url: string; bytes: number }
export interface StorageDriver {
  readonly name: string;
  put(key: string, data: Uint8Array | string, mime?: string): Promise<PutResult>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
  /** Public (optionally signed) read URL for the browser. */
  url(key: string, opts?: { ttl?: number; download?: string }): string;
  bytesUsed(): Promise<number>;
}

export function extFor(mime: string): string {
  const map: Record<string, string> = {
    'image/svg+xml': 'svg', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/wav': 'wav', 'audio/mpeg': 'mp3', 'audio/webm': 'webm',
    'application/json': 'json', 'text/plain': 'txt', 'application/zip': 'zip',
    'application/octet-stream': 'bin', 'text/csv': 'csv'
  };
  return map[mime] ?? 'bin';
}

export function makeKey(scope: string, mime: string, name?: string): string {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const safe = (name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
  return `${scope}/${stamp}/${safe ? safe + '-' : ''}${uid().slice(0, 16)}.${extFor(mime)}`;
}

/* ── local filesystem ─────────────────────────────────────── */
class LocalStorage implements StorageDriver {
  readonly name = 'local';
  private root: string;
  constructor() { this.root = path.resolve(config.storageDir); fssync.mkdirSync(this.root, { recursive: true }); }
  private abs(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(this.root)) throw new Error('storage: key escapes root');
    return p;
  }
  async put(key: string, data: Uint8Array | string) {
    const p = this.abs(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const tmp = `${p}.${uid().slice(0, 6)}.tmp`;
    await fs.writeFile(tmp, buf);
    await fs.rename(tmp, p);
    return { key, url: this.url(key), bytes: buf.byteLength };
  }
  async get(key: string) {
    try { return new Uint8Array(await fs.readFile(this.abs(key))); } catch { return null; }
  }
  async delete(key: string) { try { await fs.unlink(this.abs(key)); } catch { /* already gone */ } }
  async exists(key: string) { try { await fs.access(this.abs(key)); return true; } catch { return false; } }
  async list(prefix: string) {
    const base = this.abs(prefix);
    const out: string[] = [];
    const walk = async (dir: string, rel: string) => {
      let ents: import('node:fs').Dirent[];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(dir, e.name), r);
        else if (r.startsWith(prefix.replace(/\/$/, ''))) out.push(r);
      }
    };
    await walk(fssync.existsSync(base) && fssync.statSync(base).isDirectory() ? base : this.root,
      fssync.existsSync(base) && fssync.statSync(base).isDirectory() ? prefix : '');
    return out;
  }
  url(key: string, opts?: { ttl?: number; download?: string }) {
    const ttl = opts?.ttl ?? config.signedUrlTtl;
    const { exp, sig } = sign(key, ttl);
    const q = new URLSearchParams({ exp: String(exp), sig });
    if (opts?.download) q.set('dl', opts.download);
    return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}?${q.toString()}`;
  }
  async bytesUsed() {
    let total = 0;
    const walk = async (dir: string) => {
      let ents: import('node:fs').Dirent[];
      try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else { try { total += (await fs.stat(p)).size; } catch { /* skip */ } }
      }
    };
    await walk(this.root);
    return total;
  }
}

/* ── S3-compatible (AWS S3, Cloudflare R2, MinIO, Wasabi…) ─── */
class S3Storage implements StorageDriver {
  readonly name = 's3';
  private client: any;
  private presigner: any;
  private bucket = config.s3.bucket;
  private ready: Promise<void>;
  constructor() {
    this.ready = (async () => {
      const { S3Client } = await import('@aws-sdk/client-s3');
      this.client = new S3Client({
        region: config.s3.region,
        endpoint: config.s3.endpoint || undefined,
        forcePathStyle: Boolean(config.s3.endpoint),
        credentials: config.s3.accessKeyId
          ? { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey }
          : undefined
      });
      this.presigner = await import('@aws-sdk/s3-request-presigner');
    })();
  }
  private async cmd(mod: string, name: string) {
    await this.ready;
    const m = await import(/* webpackIgnore: true */ mod);
    return new m[name]();
  }
  async put(key: string, data: Uint8Array | string, mime = 'application/octet-stream') {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await this.ready;
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: mime }));
    return { key, url: this.url(key), bytes: buf.byteLength };
  }
  async get(key: string) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    await this.ready;
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return new Uint8Array(await r.Body.transformToByteArray());
    } catch { return null; }
  }
  async delete(key: string) {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    await this.ready;
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
  async exists(key: string) {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    await this.ready;
    try { await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return true; } catch { return false; }
  }
  async list(prefix: string) {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
    await this.ready;
    const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix }));
    return (r.Contents ?? []).map((o: any) => o.Key as string);
  }
  url(key: string) {
    // Proxy through the API so a single origin serves media and access stays authorised.
    const { exp, sig } = sign(key, config.signedUrlTtl);
    return `/api/files/${key.split('/').map(encodeURIComponent).join('/')}?exp=${exp}&sig=${sig}`;
  }
  async bytesUsed() { return 0; }
}

const gs = globalThis as unknown as { afsStorage?: StorageDriver };
export function storage(): StorageDriver {
  if (!gs.afsStorage) gs.afsStorage = config.storageDriver === 's3' && config.s3.bucket ? new S3Storage() : new LocalStorage();
  return gs.afsStorage;
}

export function verifyFileAccess(key: string, exp?: string | null, sig?: string | null): boolean {
  if (!exp || !sig) return false;
  return verifySignature(key, Number(exp), sig);
}
