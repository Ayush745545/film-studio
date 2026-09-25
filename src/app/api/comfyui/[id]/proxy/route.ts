import { api, badRequest, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { http } from '@/lib/ai/adapters/http';
import { detectFormat } from '@/lib/ai/comfy';
import type { Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Server-side proxy for the ComfyUI HTTP API.
 *
 * The Models screen used to `fetch('http://127.0.0.1:8188/...')` straight from
 * the browser. That cannot work: ComfyUI sends no `Access-Control-Allow-Origin`
 * header, so every request was rejected by CORS, and once the app is served over
 * HTTPS the browser blocks the plaintext loopback call as mixed content on top
 * of that. Routing through here means the browser only ever talks to its own
 * origin, and the base URL (plus any future auth) stays on the server.
 *
 * This is deliberately NOT an open relay. `target` must be one of a fixed
 * allowlist and the provider must actually be a ComfyUI provider, so an
 * authenticated user cannot repoint a provider at an internal service and use
 * this route to reach it.
 */

/** ComfyUI model folders we surface in the browser, in display order. */
const MODEL_FOLDERS = ['checkpoints', 'loras', 'vae', 'clip', 'embeddings', 'controlnet', 'upscale_models'] as const;

/** Folders whose contents are worth listing even when huge (all of them are). */
const MAX_FILES_PER_FOLDER = 500;
const MAX_NODES = 4000;
const MAX_JSON_BYTES = 12 * 1024 * 1024;

type Target = 'stats' | 'models' | 'nodes' | 'workflows' | 'workflow' | 'save';
const TARGETS = new Set<Target>(['stats', 'models', 'nodes', 'workflows', 'workflow', 'save']);

interface ComfyStats {
  system?: { comfyui_version?: string; argv?: string[] };
  devices?: { name?: string; type?: string; vram_total?: number; vram_free?: number }[];
}

export const GET = api(async ({ params, query }) => {
  const { base, provider } = await resolveComfy(params.id);
  const target = query().get('target') as Target | null;
  if (!target || !TARGETS.has(target)) {
    throw badRequest('Unknown or missing `target`', `Expected one of: ${[...TARGETS].join(', ')}.`);
  }
  const signal = AbortSignal.timeout(20_000);

  switch (target) {
    case 'stats': {
      try {
        const r = await http(`${base}/system_stats`, { signal, timeoutMs: 10_000 });
        if (r.status >= 400) return { connected: false, provider: { id: provider.id, name: provider.name, baseUrl: base }, error: `ComfyUI returned HTTP ${r.status} for system_stats` };
        const s = (r.body ?? {}) as ComfyStats;
        const dev = s.devices?.[0];
        return {
          connected: true,
          provider: { id: provider.id, name: provider.name, baseUrl: base },
          version: s.system?.comfyui_version ?? 'unknown',
          device: dev?.name ?? null,
          vramTotal: dev?.vram_total ?? null,
          vramFree: dev?.vram_free ?? null
        };
      } catch (err) {
        return {
          connected: false,
          provider: { id: provider.id, name: provider.name, baseUrl: base },
          error: (err as Error).message
        };
      }
    }

    /**
     * Real model *files*, grouped by folder.
     *
     * `/models` returns the folder names ComfyUI knows about and `/models/{folder}`
     * returns the filename list for one folder. The previous implementation instead
     * grepped `/object_info` keys for the substring "checkpoint", which produced
     * node *class names* (`CheckpointLoaderSimple`) rather than anything the user
     * could actually select.
     */
    case 'models': {
      const types = await http(`${base}/models`, { signal, timeoutMs: 10_000 });
      const available = new Set(Array.isArray(types.body) ? (types.body as string[]) : []);
      const folders: Record<string, string[]> = {};
      const errors: string[] = [];
      for (const folder of MODEL_FOLDERS) {
        if (available.size && !available.has(folder)) continue;
        const r = await http(`${base}/models/${encodeURIComponent(folder)}`, { signal, timeoutMs: 15_000 })
          .catch(() => null);
        if (!r || r.status === 404) continue; // folder not configured on this install
        if (r.status >= 400) { errors.push(`${folder}: HTTP ${r.status}`); continue; }
        const files = Array.isArray(r.body) ? (r.body as string[]) : [];
        if (files.length) folders[folder] = files.slice(0, MAX_FILES_PER_FOLDER);
      }
      // Embeddings live on their own route in ComfyUI, not under /models.
      if (!folders.embeddings?.length) {
        const e = await http(`${base}/embeddings`, { signal, timeoutMs: 10_000 }).catch(() => null);
        if (e && e.status < 400 && Array.isArray(e.body) && e.body.length) {
          folders.embeddings = (e.body as string[]).slice(0, MAX_FILES_PER_FOLDER);
        }
      }
      return { folders, modelTypes: [...available], errors };
    }

    /**
     * A compact node-class list. `/object_info` is frequently several megabytes
     * (every custom node's full input/output schema), so it is reduced here
     * instead of being shipped to the browser.
     */
    case 'nodes': {
      const r = await http(`${base}/object_info`, { signal, timeoutMs: 30_000 });
      if (r.status >= 400) throw upstream(r.status, 'object_info', r.raw);
      const info = (r.body ?? {}) as Record<string, { category?: string; description?: string }>;
      const nodes = Object.keys(info).slice(0, MAX_NODES).map(type => ({
        type,
        category: info[type]?.category ?? 'uncategorised'
      }));
      return { nodes, total: Object.keys(info).length };
    }

    /**
     * Workflows the user has saved in ComfyUI. They live under the `workflows`
     * user-data directory — there is no `/workflows` route in ComfyUI at all.
     */
    case 'workflows': {
      const r = await http(`${base}/userdata?dir=workflows&recurse=true`, { signal, timeoutMs: 10_000 });
      if (r.status === 404) return { workflows: [] }; // directory not created yet
      if (r.status >= 400) throw upstream(r.status, 'userdata', r.raw);
      const files = (Array.isArray(r.body) ? r.body : []) as string[];
      const workflows = files
        .filter(f => /\.(json|workflow\.json)$/i.test(f))
        .map(path => ({ path, name: path.replace(/^workflows\//, '').replace(/\.json$/i, '') }));
      return { workflows };
    }

    case 'workflow': {
      const path = query().get('path');
      if (!path) throw badRequest('`path` is required', 'Pass the workflow path from target=workflows.');
      const rel = normaliseWorkflowPath(path);
      const r = await http(`${base}/userdata/${rel}`, { signal, timeoutMs: 15_000 });
      if (r.status === 404) throw notFound(`No workflow at ${path}`);
      if (r.status >= 400) throw upstream(r.status, 'userdata', r.raw);
      const raw = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
      if (raw.length > MAX_JSON_BYTES) throw badRequest('That workflow is too large to load');
      let json: unknown;
      try { json = JSON.parse(raw); } catch { throw badRequest('That file is not valid JSON'); }
      return { path, name: path.replace(/^workflows\//, '').replace(/\.json$/i, ''), json, format: detectFormat(json) };
    }
  }
}, { auditAction: 'comfyui.proxy' });

export const POST = api(async ({ params, query, json }) => {
  const { base } = await resolveComfy(params.id);
  const target = query().get('target') as Target | null;
  if (target !== 'save') throw badRequest('Only target=save accepts POST');

  const body = await json<{ path?: string; name?: string; workflow?: unknown }>();
  const workflow = body.workflow;
  if (!workflow || typeof workflow !== 'object') {
    throw badRequest('`workflow` is required', 'Send the workflow JSON object to store in ComfyUI.');
  }
  const rel = normaliseWorkflowPath(body.path || derivePath(body.name));
  const payload = JSON.stringify(workflow, null, 2);
  if (payload.length > MAX_JSON_BYTES) throw badRequest('That workflow is too large to save');

  // ComfyUI writes the raw request body to disk, so send the JSON as-is.
  const r = await http(`${base}/userdata/${rel}?overwrite=true`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: payload,
    timeoutMs: 15_000
  });
  if (r.status >= 400) throw upstream(r.status, 'userdata', r.raw);
  return { path: readableWorkflowPath(rel), saved: true, format: detectFormat(workflow) };
}, { strict: true, auditAction: 'comfyui.save_workflow' });

/* ── helpers ─────────────────────────────────────────────── */

async function resolveComfy(providerId: string) {
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(providerId) as unknown as Provider | null;
  if (!provider) throw notFound('Provider not found');
  if (provider.driver !== 'comfyui') {
    throw badRequest('That provider is not a ComfyUI provider', `Its driver is "${provider.driver}".`);
  }
  const base = (provider.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(base); } catch { throw badRequest('That provider has an invalid base URL'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw badRequest('ComfyUI base URL must be http or https');
  }
  return { base, provider };
}

function upstream(status: number, what: string, raw: string) {
  return badRequest(`ComfyUI returned HTTP ${status} for ${what}`, raw.slice(0, 240));
}

/**
 * Build the `{file}` part of a `/userdata/{file}` URL.
 *
 * This needs DOUBLE percent-encoding, which is counter-intuitive but was
 * verified against a real ComfyUI 0.37.0 for plain, spaced, nested, non-ASCII
 * and `&`-bearing filenames (single encoding 404s on every one of them):
 *
 *   1. The path must stay a single URL segment, because ComfyUI's route is
 *      `/userdata/{file}` and a literal `/` makes it match nothing → 404.
 *   2. Node's fetch (undici) decodes `%2F` back to `/` when it serialises the
 *      request target, so encoding the separator once is not enough — it
 *      arrives as a real slash. `%252F` survives the trip as `%2F`.
 *   3. aiohttp then unquotes the captured `{file}` once → `workflows/foo.json`.
 *   4. ComfyUI's `get_request_user_filepath` unquotes again if a `%` remains,
 *      which handles spaces and non-ASCII inside a segment.
 *
 * ComfyUI resolves the result under the user directory and 403s anything that
 * escapes it; we reject traversal up front so the failure is explainable.
 */
function normaliseWorkflowPath(input: string): string {
  const clean = input.replace(/^\/+/, '').split('/').filter(Boolean).join('/');
  if (!clean) throw badRequest('A workflow path is required');
  if (clean.split('/').some(seg => seg === '..' || seg === '.')) {
    throw badRequest('Invalid workflow path');
  }
  const rel = clean.startsWith('workflows/') ? clean : `workflows/${clean}`;
  return rel
    .split('/')
    .map(seg => encodeURIComponent(encodeURIComponent(seg)))
    .join('%2F');
}

/** Inverse of {@link normaliseWorkflowPath}, for messages back to the client. */
function readableWorkflowPath(encoded: string): string {
  let out = encoded;
  for (let i = 0; i < 2; i++) {
    try { out = decodeURIComponent(out); } catch { break; }
  }
  return out;
}

function derivePath(name?: string): string {
  const slug = (name ?? '').trim().toLowerCase().replace(/\.json$/i, '').replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `workflows/${slug || 'workflow'}.json`;
}
