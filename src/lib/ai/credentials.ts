import { getDb } from '../db';
import { config } from '../config';
import { decryptSecret } from '../security/crypto';
import type { ApiCredential, Provider } from '@/types';

/**
 * Credential resolution.
 *
 * Order: (1) the user's own encrypted key, (2) a platform-owned key from the
 * environment, (3) nothing — which makes the model unavailable and pushes the
 * router to a fallback or to Demo Mode.
 *
 * Keys are decrypted here and live only in this process, inside the adapter
 * call. They are never returned to any route handler response, never logged,
 * and never serialised into job records.
 */
export interface ResolvedCredential {
  apiKey: string | null;
  baseUrl: string | null;
  extra: Record<string, string>;
  source: 'user' | 'env' | 'none';
  credentialId?: string;
}

const ENV_BY_PROVIDER: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'], openrouter: ['OPENROUTER_API_KEY'], anthropic: ['ANTHROPIC_API_KEY'], replicate: ['REPLICATE_API_TOKEN'],
  fal: ['FAL_KEY'], elevenlabs: ['ELEVENLABS_API_KEY'], comfyui: ['COMFYUI_URL'], ollama: ['OLLAMA_BASE_URL'],
  demo: []
};
const ENV_BASEURL: Record<string, string> = {
  openai: 'OPENAI_BASE_URL', comfyui: 'COMFYUI_URL', ollama: 'OLLAMA_BASE_URL'
};

export async function resolveCredential(provider: Provider, userId: string): Promise<ResolvedCredential> {
  const db = await getDb();

  // 1. user-owned key
  try {
    const rows = await db.repo('credentials').findMany({ where: { providerId: provider.id, userId } });
    const usable = (rows as unknown as (ApiCredential & { encryptedKey: string; iv: string; tag: string })[])
      .filter(r => r.encryptedKey && r.status !== 'invalid');
    if (usable.length) {
      const row = usable[0];
      try {
        const plain = decryptSecret({ ciphertext: row.encryptedKey, iv: row.iv, tag: row.tag });
        const extra: Record<string, string> = {};
        for (const [k, v] of Object.entries(row.extra ?? {})) extra[k] = String(v);
        return { apiKey: plain, baseUrl: row.baseUrl ?? provider.baseUrl, extra, source: 'user', credentialId: row.id };
      } catch {
        // Key material unreadable (e.g. AFS_ENCRYPTION_KEY rotated) — fall through to env.
      }
    }
  } catch { /* table may not exist yet on a cold start */ }

  // 2. platform key from environment
  const vars = ENV_BY_PROVIDER[provider.id] ?? [];
  for (const v of vars) {
    const k = config.platformKeys[v as keyof typeof config.platformKeys];
    if (k) {
      const buVar = ENV_BASEURL[provider.id];
      const baseUrl = (buVar ? config.platformKeys[buVar as keyof typeof config.platformKeys] : '') || provider.baseUrl;
      return { apiKey: v.endsWith('URL') ? null : k, baseUrl, extra: {}, source: 'env' };
    }
  }

  // 3. key-less local providers are legitimately usable
  if (provider.id === 'demo' || provider.driver === 'demo') return { apiKey: null, baseUrl: provider.baseUrl, extra: {}, source: 'none' };
  const keyless = ['ollama', 'lmstudio', 'comfyui', 'custom'];
  if (keyless.includes(provider.id)) return { apiKey: null, baseUrl: provider.baseUrl, extra: {}, source: 'none' };

  return { apiKey: null, baseUrl: provider.baseUrl, extra: {}, source: 'none' };
}

export function providerNeedsKey(provider: Provider): boolean {
  if (provider.id === 'demo') return false;
  if (['ollama', 'lmstudio', 'comfyui'].includes(provider.id)) return false;
  return Boolean(provider.envKeyVar) || provider.driver !== 'custom-http';
}

/** Provider readiness for UI badges. Never includes key material. */
export async function providerStatusMap(userId: string): Promise<Record<string, ApiCredential['status'] | 'env' | 'missing'>> {
  const db = await getDb();
  const providers = (await db.repo('providers').findMany()) as unknown as Provider[];
  const creds = (await db.repo('credentials').findMany({ where: { userId } })) as unknown as ApiCredential[];
  const out: Record<string, ApiCredential['status'] | 'env' | 'missing'> = {};
  for (const p of providers) {
    const c = creds.find(x => x.providerId === p.id);
    if (c) { out[p.id] = c.status; continue; }
    const vars = ENV_BY_PROVIDER[p.id] ?? [];
    const hasEnv = vars.some(v => Boolean(config.platformKeys[v as keyof typeof config.platformKeys]));
    if (hasEnv) { out[p.id] = 'env'; continue; }
    // No key needed for the built-in Studio Engine, for local-inference drivers,
    // or for any provider pointed at a loopback / LAN address (Ollama, LM Studio,
    // vLLM, ComfyUI on this machine). Those are "connected" without credentials.
    if (NO_KEY_DRIVERS.has(p.driver) || p.id === 'demo' || isLocalEndpoint(p.baseUrl)) out[p.id] = 'connected';
    else out[p.id] = 'missing';
  }
  return out;
}

/** Drivers that serve without an API key (local inference + the built-in engine). */
export const NO_KEY_DRIVERS = new Set(['demo', 'ollama', 'lmstudio', 'comfyui', 'local-ffmpeg']);

/** True when a base URL points at this machine or the local network — no key expected. */
export function normalizeProviderBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('Enter a valid URL such as https://openrouter.ai/api/v1');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Base URL must start with http:// or https://');
  if (url.username || url.password) throw new Error('Base URL cannot contain credentials');
  return trimmed.replace(/\/$/, '');
}

export function isLocalEndpoint(baseUrl: string | null | undefined): boolean {
  if (!baseUrl) return false;
  try {
    const h = new URL(baseUrl).hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
    if (h.startsWith('192.168.') || h.startsWith('10.') || h.endsWith('.local') || h.endsWith('.internal')) return true;
    const m = /^172\.(\d+)\./.exec(h); if (m) { const o = Number(m[1]); if (o >= 16 && o <= 31) return true; }
    return false;
  } catch { return false; }
}
