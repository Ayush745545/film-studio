/**
 * Verification against a REAL ComfyUI server — no mocks, no stubs.
 *
 * This is the only thing that can prove the endpoints, payload shapes and error
 * behaviour the proxy was written against are right. It has already caught two
 * bugs that reading the ComfyUI source did not: `/userdata/{file}` needs a
 * double-encoded path, and a UI-format graph makes ComfyUI 500 rather than
 * return a validation error.
 *
 *   COMFYUI_DIR=/path/to/ComfyUI python3 scripts/comfy-fixtures.py
 *   python3 "$COMFYUI_DIR/main.py" --cpu --port 8188
 *   npm run build && npm run verify:comfyui-real
 *
 * Set COMFYUI_URL to point at an instance that is already running.
 *
 * No model weights are needed: everything here is HTTP-surface validation. The
 * one generation test asserts on ComfyUI's *rejection* of a graph that names a
 * checkpoint which does not exist, which proves the app's submit path reaches
 * real ComfyUI validation.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { detectFormat } from '@/lib/ai/comfy';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3111';
const COMFY = process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188';
const PROXY = (id: string) => `${APP}/api/comfyui/${id}/proxy`;

let pass = 0, fail = 0;
const rec = (ok: boolean, name: string, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

/**
 * `/userdata/{file}` needs the whole relative path as ONE url segment, double
 * encoded — see normaliseWorkflowPath in the proxy route. Single encoding 404s
 * even for plain ASCII names, because undici decodes `%2F` back to `/` on the
 * wire and ComfyUI's route then fails to match.
 */
const userdataUrl = (base: string, rel: string) => {
  // ComfyUI's listing is dir-relative, so `workflows/` has to be put back —
  // exactly what the proxy's normaliseWorkflowPath does.
  const full = rel.startsWith('workflows/') ? rel : `workflows/${rel}`;
  return `${base}/userdata/${full.split('/').map(seg => encodeURIComponent(encodeURIComponent(seg))).join('%2F')}`;
};

async function j(url: string, opts: any = {}) {
  const res = await fetch(url, { headers: { accept: 'application/json', ...(opts.headers ?? {}) }, ...opts });
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body, data: body?.ok ? body.data : undefined, err: body?.ok === false ? body.error : undefined, raw: text };
}

async function waitFor(url: string, label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); if (r.status < 500) return; } catch { /* not up */ }
    await sleep(1000);
  }
  throw new Error(`${label} never came up at ${url}`);
}

const children: ReturnType<typeof spawn>[] = [];
function start(cmd: string, args: string[], name: string) {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout?.on('data', d => process.stdout.write(`[${name}] ${d}`));
  p.stderr?.on('data', d => process.stdout.write(`[${name}!] ${d}`));
  children.push(p);
  return p;
}
const killAll = () => { for (const c of children) c.kill('SIGKILL'); };

async function main() {
  await waitFor(`${COMFY}/system_stats`, 'ComfyUI');
  const sys = await (await fetch(`${COMFY}/system_stats`)).json();
  console.log(`\nReal ComfyUI ${sys?.system?.comfyui_version} at ${COMFY}`);

  if (!process.env.APP_URL) {
    if (!existsSync('.next/BUILD_ID')) throw new Error('No production build. Run `npm run build` first.');
    console.log('Starting Next.js on :3111 …');
    start(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3111'], 'next');
  }
  await waitFor(`${APP}/api/system`, 'Next.js');

  const boot = await j(`${APP}/api/bootstrap`);
  const comfy = (boot.data?.providers ?? []).find((p: any) => p.driver === 'comfyui');
  rec(Boolean(comfy), 'the app has a comfyui provider', comfy ? `${comfy.id} → ${comfy.baseUrl}` : 'none');
  if (!comfy) throw new Error('no comfyui provider');
  rec(comfy.baseUrl?.replace(/\/$/, '') === COMFY, 'and it points at this instance', comfy.baseUrl);

  console.log('\n── read endpoints, against the real server ─────────────');
  const stats = await j(`${PROXY(comfy.id)}?target=stats`);
  rec(stats.status === 200 && stats.data?.connected === true, 'stats proxies through');
  rec(stats.data?.version === sys?.system?.comfyui_version, 'version matches /system_stats directly',
    `${stats.data?.version} vs ${sys?.system?.comfyui_version}`);

  const models = await j(`${PROXY(comfy.id)}?target=models`);
  rec(models.status === 200, 'models target succeeds');
  const realFolders: string[] = await (await fetch(`${COMFY}/models`)).json();
  rec(realFolders.includes('checkpoints') && realFolders.includes('loras'), 'ComfyUI reports its folder list', `${realFolders.length} folders`);
  const realCkpts: string[] = await (await fetch(`${COMFY}/models/checkpoints`)).json();
  rec(JSON.stringify(models.data?.folders?.checkpoints ?? []) === JSON.stringify(realCkpts),
    'proxy returns exactly what /models/checkpoints returns', (models.data?.folders?.checkpoints ?? []).join(', '));
  rec((models.data?.folders?.checkpoints ?? []).every((f: string) => f.endsWith('.safetensors')),
    'every entry is a real weight file, not a node class name');
  rec(!(models.data?.folders?.checkpoints ?? []).includes('CheckpointLoaderSimple'),
    'the old node-class-name bug is gone');

  const nodes = await j(`${PROXY(comfy.id)}?target=nodes`);
  const realInfo = await (await fetch(`${COMFY}/object_info`)).json();
  const realCount = Object.keys(realInfo).length;
  rec(nodes.data?.total === realCount, 'node count matches /object_info', String(nodes.data?.total));
  rec((nodes.data?.nodes ?? []).some((n: any) => n.type === 'KSampler' && n.category === realInfo.KSampler?.category),
    'node categories are passed through', (nodes.data?.nodes ?? []).find((n: any) => n.type === 'KSampler')?.category);
  rec(nodes.raw.length < 400_000, 'the proxy reduces /object_info instead of forwarding it',
    `${(nodes.raw.length / 1024).toFixed(0)} KB proxied vs ${(JSON.stringify(realInfo).length / 1048576).toFixed(1)} MB upstream`);

  console.log('\n── workflows, against the real server ──────────────────');
  const wfs = await j(`${PROXY(comfy.id)}?target=workflows`);
  const realList: string[] = await (await fetch(`${COMFY}/userdata?dir=workflows&recurse=true`)).json();
  const proxyPaths = (wfs.data?.workflows ?? []).map((w: any) => w.path).sort();
  rec(JSON.stringify(proxyPaths) === JSON.stringify([...realList].sort()),
    'workflow list matches /userdata exactly', proxyPaths.join(', '));
  rec(realList.some(p => p.includes('/')), 'real ComfyUI nests subfolder workflows with a slash',
    realList.find(p => p.includes('/')) ?? 'none');
  rec(realList.every(p => !p.startsWith('workflows/')),
    'real listing is dir-relative, so the proxy must re-add the prefix (it does)');

  const hero = (wfs.data?.workflows ?? []).find((w: any) => w.path.endsWith('afs_hero_api.json'));
  rec(Boolean(hero), 'the API-format fixture is listed');
  const editor = (wfs.data?.workflows ?? []).find((w: any) => w.path.endsWith('afs_hero_editor.json'));
  rec(Boolean(editor), 'the editor-format fixture is listed');

  if (hero) {
    const one = await j(`${PROXY(comfy.id)}?target=workflow&path=${encodeURIComponent(hero.path)}`);
    rec(one.status === 200, 'fetches a workflow through the proxy');
    const directRes = await fetch(userdataUrl(COMFY, hero.path));
    rec(directRes.status === 200, 'a direct ComfyUI GET of the same file succeeds (encoding is right)', `HTTP ${directRes.status}`);
    const single = await fetch(`${COMFY}/userdata/${hero.path.split('/').map(encodeURIComponent).join('/')}`);
    rec(single.status === 404, 'and single-encoded would 404 — the bug this guards against', `HTTP ${single.status}`);
    const direct = await directRes.text();
    rec(direct.length > 0, 'the direct GET returns a body', `${direct.length} bytes`);
    if (!direct.length) throw new Error(`empty body from ${userdataUrl(COMFY, hero.path)} — cannot continue`);
    rec(JSON.stringify(one.data?.json) === JSON.stringify(JSON.parse(direct)),
      'bytes round-trip identically vs a direct ComfyUI GET');
    rec(one.data?.format === 'api', 'classified as API format', one.data?.format);
    rec(detectFormat(JSON.parse(direct || 'null')) === 'api', 'detectFormat agrees on the real file');
  }
  if (editor) {
    const ed = await j(`${PROXY(comfy.id)}?target=workflow&path=${encodeURIComponent(editor.path)}`);
    rec(ed.data?.format === 'ui', 'classified as editor/UI format', ed.data?.format);
    rec(detectFormat(ed.data?.json) === 'ui', 'detectFormat agrees on a real ComfyUI editor export');
  }

  console.log('\n── writing to the real server ──────────────────────────');
  const stamp = Date.now().toString(36);
  const graph = {
    '3': { class_type: 'KSampler', inputs: { seed: '{{seed}}', steps: '{{steps}}' } },
    '6': { class_type: 'SaveImage', inputs: { filename_prefix: 'AFS', images: ['3', 0] } }
  };
  const saved = await j(`${PROXY(comfy.id)}?target=save`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `afs proxy write ${stamp}`, workflow: graph })
  });
  rec(saved.status === 200 && saved.data?.saved === true, 'the proxy writes a workflow into ComfyUI', saved.data?.path ?? saved.err?.message);
  const onDiskRes = await fetch(userdataUrl(COMFY, `workflows/afs-proxy-write-${stamp}.json`));
  rec(onDiskRes.status === 200, 'the saved file is readable back from ComfyUI', `HTTP ${onDiskRes.status}`);
  const onDisk = await onDiskRes.text();
  rec(JSON.stringify(JSON.parse(onDisk || 'null')) === JSON.stringify(graph),
    'the file on disk is the workflow itself, not a wrapper envelope');
  const relisted: string[] = await (await fetch(`${COMFY}/userdata?dir=workflows&recurse=true`)).json();
  rec(relisted.includes(`afs-proxy-write-${stamp}.json`), 'real ComfyUI now lists it');

  console.log('\n── real ComfyUI error behaviour ────────────────────────');
  // Verified on ComfyUI 0.37.0: a UI-format document is not a clean validation
  // failure. node_replace_manager.py iterates every top-level value and hits
  // `if "class_type" not in 6`, so the request 500s with an HTML body.
  const uiPost = await fetch(`${COMFY}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: { last_node_id: 6, nodes: [], links: [] }, client_id: 'afs-ui' })
  });
  rec(uiPost.status === 500, 'a UI-format graph makes real ComfyUI return HTTP 500', `HTTP ${uiPost.status}`);
  const uiBody = await uiPost.text();
  rec(!uiBody.trim().startsWith('{'), 'and the 500 body is not JSON, so it cannot be explained to the user',
    JSON.stringify(uiBody.slice(0, 60)));
  rec(detectFormat({ last_node_id: 6, nodes: [], links: [] }) === 'ui',
    'which is why the client refuses UI format before submitting');

  // ComfyUI coerces numeric strings: INT inputs arrive as "1024" from the
  // adapter's {{token}} substitution and are accepted.
  const asStrings = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'afs_test_sd15.safetensors' } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: '1024', height: '1024', batch_size: '1' } },
    '6': { class_type: 'SaveImage', inputs: { filename_prefix: 'AFS', images: ['4', 0] } }
  };
  const coerced = await fetch(`${COMFY}/prompt`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: asStrings, client_id: 'afs-str' })
  });
  const coercedBody: any = await coerced.json().catch(() => ({}));
  const coercedTypes = Object.values(coercedBody?.node_errors ?? {})
    .flatMap((n: any) => (n?.errors ?? []).map((e: any) => e.type));
  rec(!coercedTypes.includes('invalid_input_type'),
    'numeric strings are accepted for INT inputs (no invalid_input_type)', coercedTypes.join(', ') || 'no node errors');

  console.log('\n── the app reaches real ComfyUI validation ─────────────');
  const reg = await j(`${APP}/api/models`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: comfy.id, name: 'ComfyUI · real validation probe',
      driverModel: `workflow:real-probe-${stamp}`, kind: 'image', capabilities: ['image'],
      config: { workflowJson: graph }, features: ['comfyui', 'workflow']
    })
  });
  rec(reg.status === 200 && Boolean(reg.data?.id), 'registers a workflow model against the real provider', reg.err?.message);

  const gen = await j(`${APP}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'image', modelId: reg.data?.id, prompt: 'probe', seed: 7, count: 1 })
  });
  let job: any = null;
  for (let i = 0; i < 60 && gen.data?.job?.id; i++) {
    await sleep(700);
    const r = await j(`${APP}/api/jobs/${gen.data.job.id}`);
    if (['succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(r.data?.status)) { job = r.data; break; }
  }
  rec(Boolean(job), 'the job reached a terminal state', job?.status ?? 'timed out');
  rec(job?.modelId === reg.data?.id, 'it ran on the selected model, not a strategy pick', `${job?.modelId}`);
  // No real weights are installed, so ComfyUI must reject the checkpoint. That
  // rejection is the proof the submit path reached a real ComfyUI validator —
  // and it must surface as a hard failure rather than silently falling back to
  // the demo engine and pretending to succeed.
  const msg = JSON.stringify(job?.error ?? '');
  rec(job?.status === 'failed' || job?.status === 'error', 'the job fails, as it must without real weights', job?.status);
  rec(msg.length > 2, 'the failure is recorded on the job', msg.slice(0, 160));
  // classifyHttpError marks 4xx non-retryable, so a ComfyUI validation rejection
  // must NOT quietly fall back to the demo engine and report success.
  rec(job?.output?.demo !== true, 'it did NOT silently fall back to the demo engine', `demo=${job?.output?.demo}`);
  const logs = (job?.logs ?? []).map((l: any) => l.msg).join(' | ');
  rec(/ComfyUI/.test(logs), 'the job log names ComfyUI as the provider it talked to', logs.slice(0, 180));

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed against real ComfyUI ${sys?.system?.comfyui_version}\n`);
  return fail === 0 ? 0 : 1;
}

main()
  .then(code => { killAll(); process.exit(code); })
  .catch(err => { console.error('\nHarness error:', err); killAll(); process.exit(2); });
