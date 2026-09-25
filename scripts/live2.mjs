// Live end-to-end probe against the CURRENT contract: { ok, data } envelope,
// provider.driver / model.driverModel fields. Auth mode = open (local profile),
// no Origin header (isSafeOrigin passes), no cookie needed.
const B = process.env.PROBE_BASE || 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
const log = [];
function rec(ok, name, detail) { (ok ? pass++ : fail++); log.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); }

async function call(method, path, body, opts = {}) {
  const res = await fetch(B + path, {
    method,
    headers: { ...(body && !opts.raw ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) },
    body: opts.raw ? body : (body ? JSON.stringify(body) : undefined)
  });
  let json = null; let text = '';
  try { text = await res.text(); json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text, data: json?.data, err: json?.error };
}

(async () => {
  const boot = await call('GET', '/api/bootstrap');
  rec(boot.status === 200 && boot.json?.ok, 'bootstrap', `status=${boot.status} user=${boot.data?.user?.id ?? '—'} project=${boot.data?.project?.id ?? '—'} credits=${boot.data?.credits ?? '—'}`);
  const projectId = boot.data?.project?.id ?? null;

  const provs = await call('GET', '/api/providers');
  const drivers = provs.data?.drivers ?? [];
  rec(provs.status === 200 && Array.isArray(provs.data?.providers), 'providers GET', `${provs.data?.providers?.length ?? 0} providers; openai-compatible=${drivers.includes('openai-compatible')} comfyui=${drivers.includes('comfyui')} ollama=${drivers.includes('ollama')}`);

  const addProv = await call('POST', '/api/providers', { name: 'Local LM Studio', driver: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1', capabilities: ['text', 'image'], notes: 'probe' });
  const newProvId = addProv.data?.provider?.id;
  rec(addProv.status === 200 && !!newProvId, 'add provider (local openai-compatible)', `id=${newProvId ?? '—'} status=${addProv.status}${addProv.err ? ' err=' + addProv.err.message : ''}`);

  const addComfy = await call('POST', '/api/providers', { name: 'Local ComfyUI', driver: 'comfyui', baseUrl: 'http://127.0.0.1:8188', capabilities: ['image', 'video'] });
  const comfyId = addComfy.data?.provider?.id;
  rec(addComfy.status === 200 && !!comfyId, 'add provider (local comfyui)', `id=${comfyId ?? '—'} status=${addComfy.status}${addComfy.err ? ' err=' + addComfy.err.message : ''}`);

  if (newProvId) {
    const cred = await call('POST', `/api/providers/${newProvId}/credentials`, { apiKey: 'lm-studio-no-key', baseUrl: 'http://127.0.0.1:1234/v1' });
    rec(cred.status === 200 && cred.json?.ok, 'provider credentials POST', `status=${cred.status}${cred.err ? ' err=' + cred.err.message : ''}`);
    const credGet = await call('GET', `/api/providers/${newProvId}/credentials`);
    rec(credGet.status === 200, 'provider credentials GET (masked)', `${Array.isArray(credGet.data) ? credGet.data.length : (credGet.data?.credentials?.length ?? 0)} creds`);
  } else rec(false, 'provider credentials POST', 'no provider id');

  if (newProvId) {
    const test = await call('POST', `/api/providers/${newProvId}/test`, {});
    const clean = test.status < 500;
    rec(clean, 'provider test (graceful)', `status=${test.status} body=${JSON.stringify(test.data ?? test.err ?? test.text?.slice(0, 120)).slice(0, 160)}`);
  } else rec(false, 'provider test', 'no provider id');

  let modelId = null;
  if (newProvId) {
    const addModel = await call('POST', '/api/models', { providerId: newProvId, name: 'Local Llama 3.1 8B', driverModel: 'llama-3.1-8b-instruct', kind: 'text', capabilities: ['text'], quality: 4, speed: 4, costPerUnit: 0, unit: 'request' });
    modelId = addModel.data?.id ?? addModel.data?.model?.id;
    rec(addModel.status === 200 && !!modelId, 'add model (driverModel)', `id=${modelId ?? '—'} status=${addModel.status}${addModel.err ? ' err=' + addModel.err.message : ''}`);
  } else rec(false, 'add model', 'no provider id');

  const models = await call('GET', '/api/models');
  rec(models.status === 200 && Array.isArray(models.data?.models), 'models GET', `${models.data?.models?.length ?? 0} models; readyProviders=${(models.data?.readyProviders ?? []).length}`);

  const kinds = ['text', 'image', 'video', 'voice', 'sound', 'music'];
  for (const kind of kinds) {
    const dry = await call('POST', '/api/generate', { kind, prompt: 'a neon-lit rainy alley, cinematic', dryRun: true, projectId });
    rec(dry.status === 200 && !!dry.data?.estimate, `generate dryRun (${kind})`, `credits=${dry.data?.estimate?.credits ?? '—'} model=${dry.data?.estimate?.modelId ?? dry.data?.estimate?.model ?? '—'}${dry.err ? ' err=' + dry.err.message : ''}`);
  }

  async function runJob(kind, extra = {}) {
    const r = await call('POST', '/api/generate', { kind, prompt: 'a lone astronaut on a red desert, golden hour, cinematic', projectId, ...extra });
    if (r.status !== 200 || !r.data?.job?.id) { rec(false, `generate run (${kind})`, `enqueue failed status=${r.status}${r.err ? ' err=' + r.err.message : ''}`); return; }
    const jobId = r.data.job.id;
    let job = null;
    for (let i = 0; i < 60; i++) {
      await new Promise(res => setTimeout(res, 400));
      const j = await call('GET', `/api/jobs/${jobId}`);
      job = j.data?.job ?? j.data;
      const st = job?.status;
      if (['succeeded','completed','done','failed','error','cancelled'].includes(st)) break;
    }
    const st = job?.status;
    const out = job?.output ?? job?.result ?? job?.assets ?? null;
    const okRun = ['succeeded','completed','done'].includes(st);
    rec(okRun, `generate run (${kind}) → job`, `status=${st ?? 'timeout'} hasOutput=${!!out}${job?.error ? ' err=' + String(job.error).slice(0, 120) : ''}`);
  }
  await runJob('image');
  await runJob('video', { durationSec: 3 });

  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6300010000050001', 'hex');
  const up = await call('POST', `/api/uploads?projectId=${projectId ?? ''}`, png, { raw: true, headers: { 'content-type': 'image/png', 'x-filename': 'probe.png' } });
  rec(up.status === 200 && (up.data?.assets?.length ?? 0) > 0, 'upload (image/png)', `assets=${up.data?.assets?.length ?? 0} id=${up.data?.assets?.[0]?.id ?? '—'}${up.err ? ' err=' + up.err.message : ''}`);

  const autos = await call('GET', '/api/automations');
  rec(autos.status === 200 && Array.isArray(autos.data?.templates), 'automations GET', `${autos.data?.automations?.length ?? 0} automations; ${autos.data?.templates?.length ?? 0} templates`);

  const createAuto = await call('POST', '/api/automations', { name: 'Probe Storyboard Flow', template: 'storyboard-only', projectId });
  const autoId = createAuto.data?.id ?? createAuto.data?.automation?.id;
  const nodeCount = (createAuto.data?.nodes ?? []).length;
  rec(createAuto.status === 200 && !!autoId, 'automation create (template)', `id=${autoId ?? '—'} nodes=${nodeCount}${createAuto.err ? ' err=' + createAuto.err.message : ''}`);

  let runId = null;
  if (autoId) {
    const run = await call('POST', `/api/automations/${autoId}/run`, { projectId });
    runId = run.data?.id ?? run.data?.run?.id;
    rec(run.status === 200 && !!runId, 'automation run', `runId=${runId ?? '—'} status=${run.data?.status ?? '—'}${run.err ? ' err=' + run.err.message : ''}`);
  } else rec(false, 'automation run', 'no automation id');

  if (runId) {
    let run = null;
    for (let i = 0; i < 40; i++) {
      await new Promise(res => setTimeout(res, 400));
      const r = await call('GET', `/api/runs/${runId}`);
      run = r.data?.run ?? r.data;
      const st = run?.status;
      if (['succeeded','completed','failed','error','cancelled','awaiting_approval','waiting_approval','paused'].includes(st)) break;
    }
    rec(true, 'automation run poll', `status=${run?.status ?? 'timeout'} progress=${run?.progress ?? '—'}`);
  }

  const usage = await call('GET', '/api/usage');
  rec(usage.status === 200 && usage.json?.ok, 'usage endpoint /api/usage', `status=${usage.status}${usage.err ? ' err=' + usage.err.message : (usage.status === 404 ? ' (MISSING — needs building)' : '')}`);

  console.log(log.join('\n'));
  console.log(`\n==== ${pass} passed / ${fail} failed (of ${pass + fail}) ====`);
})().catch(e => { console.log(log.join('\n')); console.error('PROBE CRASH', e); });
