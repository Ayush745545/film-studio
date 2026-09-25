/**
 * End-to-end verification of the public API (`/api/open/*`) and the key
 * lifecycle behind it. Real server, real database, no mocks.
 *
 *   npm run build && npm run verify:open-api
 *
 * Covers the parts that are easy to get subtly wrong: that an open route cannot
 * be reached without a key, that a browser session cannot be used as one, that
 * revocation and expiry take effect immediately, that scopes are enforced per
 * route, and that the plaintext key appears in exactly one response and is
 * recoverable from nowhere else.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { hashKey, scopeAllows, type KeyScope } from '@/lib/security/api-keys';

const APP = process.env.APP_URL ?? 'http://127.0.0.1:3112';
const OPEN = `${APP}/api/open`;

let pass = 0, fail = 0;
const rec = (ok: boolean, name: string, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

interface Resp { status: number; body: any; data: any; err: any; raw: string }

async function call(path: string, opts: { key?: string; cookie?: string; method?: string; body?: unknown; rawBody?: string } = {}): Promise<Resp> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (opts.key) headers.authorization = `Bearer ${opts.key}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${APP}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers,
    body: opts.rawBody ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
  });
  const raw = await res.text();
  let body: any = null;
  try { body = JSON.parse(raw); } catch { body = raw; }
  return { status: res.status, body, data: body?.ok ? body.data : undefined, err: body?.ok === false ? body.error : undefined, raw };
}

async function waitFor(url: string, label: string, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url, { signal: AbortSignal.timeout(4000) }); if (r.status < 500) return; } catch { /* not up */ }
    await sleep(1000);
  }
  throw new Error(`${label} never came up at ${url}`);
}

const children: ReturnType<typeof spawn>[] = [];
const killAll = () => { for (const c of children) c.kill('SIGKILL'); };

const OPEN_ROUTES = ['/api/open/system', '/api/open/projects', '/api/open/models', '/api/open/assets', '/api/open/jobs'];

async function main() {
  if (!process.env.APP_URL) {
    if (!existsSync('.next/BUILD_ID')) throw new Error('No production build. Run `npm run build` first.');
    console.log('Starting Next.js on :3112 …');
    const p = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3112'], { stdio: ['ignore', 'pipe', 'pipe'] });
    p.stdout?.on('data', d => process.stdout.write(`[next] ${d}`));
    p.stderr?.on('data', d => process.stdout.write(`[next!] ${d}`));
    children.push(p);
  }
  await waitFor(`${APP}/api/system`, 'Next.js');
  console.log(`\nApp under test: ${APP}`);

  console.log('\n── nothing is reachable without a key ──────────────────');
  for (const r of OPEN_ROUTES) {
    const res = await call(r);
    rec(res.status === 401, `${r} rejects an anonymous caller`, `HTTP ${res.status}`);
    rec(res.err?.code === 'invalid_api_key', `${r} says why`, res.err?.code);
    rec(/Bearer/.test(res.err?.hint ?? ''), `${r} tells the caller what to send instead`);
  }
  const noKeyWrite = await call('/api/open/projects', { method: 'POST', body: { name: 'should not exist' } });
  rec(noKeyWrite.status === 401, 'POST /api/open/projects rejects an anonymous caller', `HTTP ${noKeyWrite.status}`);

  console.log('\n── a browser session is not an API key ─────────────────');
  // The open surface must not accept ambient cookie auth, or which routes are
  // public would depend on who happens to be signed in.
  // Grab a real session cookie off a session-authed route. In the default
  // AFS_AUTH_MODE=open the local profile is provisioned on first request, so
  // this works without credentials.
  const probe = await fetch(`${APP}/api/projects`, { headers: { accept: 'application/json' } });
  const cookie = probe.headers.getSetCookie?.().map(c => c.split(';')[0]).join('; ') ?? '';
  rec(probe.status < 500, 'the session API is reachable for comparison', `HTTP ${probe.status}`);
  if (cookie) {
    const withCookie = await call('/api/open/system', { cookie });
    rec(withCookie.status === 401, 'a valid session cookie does NOT authenticate an open route', `HTTP ${withCookie.status}`);
  } else {
    rec(true, 'no session cookie was set (open auth mode keeps no session) — skipped');
  }

  console.log('\n── malformed keys ──────────────────────────────────────');
  for (const bad of ['', 'afs_', 'afs_tooshort', 'not-ours-at-all', 'Bearer afs_nested', 'afs_' + 'x'.repeat(200)]) {
    const res = await call('/api/open/system', { key: bad });
    rec(res.status === 401, `rejects ${JSON.stringify(bad.slice(0, 24))}`, `HTTP ${res.status}`);
  }

  console.log('\n── issuing a key ───────────────────────────────────────');
  const created = await call('/api/keys', { method: 'POST', body: { name: 'Verify harness', scopes: [], expiresInDays: null } });
  rec(created.status === 200 || created.status === 201, 'POST /api/keys creates a key', `HTTP ${created.status}`);
  const key: string | undefined = created.data?.plaintext;
  rec(typeof key === 'string' && key.startsWith('afs_') && key.length >= 40, 'the plaintext is returned once, shaped afs_…', key?.slice(0, 12) + '…');
  rec(created.data?.id && created.data?.name === 'Verify harness', 'the stored view carries id and name');
  rec(created.data?.keyHash === undefined, 'the response omits keyHash');
  rec(!created.raw.includes(hashKey(key ?? '')), 'and the hash is not anywhere in the response body');
  rec(Array.isArray(created.data?.scopes) && created.data.scopes.length === 0, 'empty scopes = unrestricted', JSON.stringify(created.data?.scopes));
  rec(typeof created.data?.prefix === 'string' && created.data.prefix.endsWith('…'), 'a display prefix is stored instead', created.data?.prefix);

  const noName = await call('/api/keys', { method: 'POST', body: { name: '   ' } });
  rec(noName.status === 400, 'a blank name is rejected', noName.err?.message);
  const badScope = await call('/api/keys', { method: 'POST', body: { name: 'x', scopes: ['launch-missiles'] } });
  rec(badScope.status === 400, 'an unknown scope is rejected', badScope.err?.message);
  rec(/Available scopes/.test(badScope.err?.hint ?? ''), 'and the hint lists the real ones');
  const badExpiry = await call('/api/keys', { method: 'POST', body: { name: 'x', expiresInDays: 0 } });
  rec(badExpiry.status === 400, 'a zero-day expiry is rejected', badExpiry.err?.message);
  const hugeExpiry = await call('/api/keys', { method: 'POST', body: { name: 'x', expiresInDays: 99999 } });
  rec(hugeExpiry.status === 400, 'an absurd expiry is rejected', hugeExpiry.err?.message);

  if (!key) throw new Error('could not create a key; cannot continue');

  console.log('\n── the key works ───────────────────────────────────────');
  const sys = await call('/api/open/system', { key });
  rec(sys.status === 200 && sys.data?.ok === true, 'GET /api/open/system with the key', `HTTP ${sys.status}`);
  rec(sys.data?.authenticatedAs === 'Verify harness', 'it reports which key is calling', sys.data?.authenticatedAs);
  rec(Array.isArray(sys.data?.capabilities?.generationKinds), 'it advertises capabilities');

  const viaHeader = await fetch(`${OPEN}/system`, { headers: { 'x-api-key': key } });
  rec(viaHeader.status === 200, 'x-api-key is accepted as an alternative header', `HTTP ${viaHeader.status}`);

  const listed = await call('/api/keys');
  rec(listed.status === 200 && (listed.data?.keys ?? []).some((k: any) => k.id === created.data.id), 'the key appears in the management list');
  rec(!(listed.data?.keys ?? []).some((k: any) => 'keyHash' in k), 'the list never includes a hash');
  rec(!listed.raw.includes(key), 'and never includes any plaintext key');

  console.log('\n── projects over the open API ──────────────────────────');
  const made = await call('/api/open/projects', { key, body: { name: 'Open API probe', type: 'short-film' } });
  rec(made.status === 200 || made.status === 201, 'creates a project', made.err?.message ?? made.data?.id);
  const pid = made.data?.id;
  rec(typeof pid === 'string' && pid.length > 0, 'and returns its id', pid);

  const badType = await call('/api/open/projects', { key, body: { name: 'x', type: 'not-a-type' } });
  rec(badType.status === 400, 'an unknown project type is rejected', badType.err?.message);
  const noNameP = await call('/api/open/projects', { key, body: {} });
  rec(noNameP.status === 400, 'a nameless project is rejected');

  const all = await call('/api/open/projects', { key });
  rec(all.status === 200 && (all.data?.projects ?? []).some((p: any) => p.id === pid), 'the project is listed');

  const one = await call(`/api/open/projects/${pid}`, { key });
  rec(one.status === 200 && one.data?.id === pid, 'fetches it by id');
  rec(one.data?.name === 'Open API probe', 'with the right contents', one.data?.name);

  const patched = await call(`/api/open/projects/${pid}`, { key, method: 'PATCH', body: { description: 'updated via open api', tags: ['api'] } });
  rec(patched.status === 200 && patched.data?.description === 'updated via open api', 'PATCH applies an allowlisted field');
  const emptyPatch = await call(`/api/open/projects/${pid}`, { key, method: 'PATCH', body: {} });
  rec(emptyPatch.status === 400, 'an empty PATCH is rejected rather than silently no-oping', emptyPatch.err?.message);
  const forbiddenPatch = await call(`/api/open/projects/${pid}`, { key, method: 'PATCH', body: { userId: 'someone-else' } });
  rec(forbiddenPatch.status === 400, 'a non-allowlisted field cannot be written', forbiddenPatch.err?.message);

  const missing = await call('/api/open/projects/proj_doesnotexist', { key });
  rec(missing.status === 404, 'an unknown project 404s', `HTTP ${missing.status}`);

  console.log('\n── other read endpoints ────────────────────────────────');
  const models = await call('/api/open/models', { key });
  rec(models.status === 200 && Array.isArray(models.data?.models), 'lists models', `${models.data?.models?.length ?? 0} models`);
  rec(models.data?.readyProviders === undefined, 'does not leak which providers have credentials');
  rec((models.data?.models ?? []).every((m: any) => m.enabled !== false), 'only enabled models are exposed');
  const assets = await call('/api/open/assets', { key });
  rec(assets.status === 200 && Array.isArray(assets.data?.assets), 'lists assets');
  const jobs = await call('/api/open/jobs', { key });
  rec(jobs.status === 200 && Array.isArray(jobs.data?.recent), 'lists jobs');

  console.log('\n── generation ──────────────────────────────────────────');
  const dry = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'a lighthouse in fog', dryRun: true } });
  rec(dry.status === 200 && dry.data?.estimate, 'dry run prices a generation without spending credits', dry.data?.estimate?.breakdown);
  const badKind = await call('/api/open/generate', { key, body: { kind: 'teleport', prompt: 'x' } });
  rec(badKind.status === 400, 'an unknown kind is rejected', badKind.err?.message);
  const noPrompt = await call('/api/open/generate', { key, body: { kind: 'image' } });
  rec(noPrompt.status === 400, 'a missing prompt is rejected', noPrompt.err?.message);
  const badRatio = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'x', aspectRatio: '7:3' } });
  rec(badRatio.status === 400, 'an unknown aspectRatio is rejected before it reaches a provider', badRatio.err?.message);
  const badCount = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'x', count: 999 } });
  rec(badCount.status === 400, 'an absurd count is rejected', badCount.err?.message);
  const badModel = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'x', modelId: 'mdl_nope' } });
  rec(badModel.status === 400, 'an unknown modelId is rejected with a pointer to the model list', badModel.err?.hint);
  const foreignProject = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'x', projectId: 'proj_notmine' } });
  rec(foreignProject.status === 404, 'a generation cannot be attached to a project the key does not own', `HTTP ${foreignProject.status}`);

  const real = await call('/api/open/generate', { key, body: { kind: 'image', prompt: 'a lighthouse in fog', count: 1 } });
  rec(real.status === 200 && real.data?.job?.id, 'a real generation enqueues and returns a job', real.data?.job?.id ?? real.err?.message);
  if (real.data?.job?.id) {
    let job: any = null;
    for (let i = 0; i < 45; i++) {
      await sleep(600);
      const r = await call(`/api/open/jobs/${real.data.job.id}`, { key });
      if (['succeeded', 'completed', 'failed', 'error', 'cancelled'].includes(r.data?.status)) { job = r.data; break; }
    }
    rec(Boolean(job), 'the job can be polled to a terminal state', job?.status ?? 'timed out');
    rec(job?.input === undefined, 'the public job shape omits `input`');
    rec(job?.logs === undefined, 'and omits internal logs');
    rec(typeof job?.status === 'string' && Array.isArray(job?.assetIds), 'but keeps status and assetIds', `${job?.status}, ${job?.assetIds?.length ?? 0} assets`);
    const otherJob = await call('/api/open/jobs/job_doesnotexist', { key });
    rec(otherJob.status === 404, 'an unknown job 404s');
  }

  console.log('\n── scopes ──────────────────────────────────────────────');
  const narrow = await call('/api/keys', { method: 'POST', body: { name: 'Read only', scopes: ['models'] } });
  const narrowKey: string = narrow.data?.plaintext;
  if (narrowKey) {
    rec((await call('/api/open/models', { key: narrowKey })).status === 200, 'a models-scoped key can read models');
    const denied = await call('/api/open/projects', { key: narrowKey });
    rec(denied.status === 403, 'and is refused on projects', `HTTP ${denied.status}`);
    rec(denied.err?.code === 'insufficient_scope', 'with an insufficient_scope code', denied.err?.code);
    rec(/limited to: models/.test(denied.err?.hint ?? ''), 'and a hint naming the scopes it does have', denied.err?.hint);
    rec((await call('/api/open/generate', { key: narrowKey, body: { kind: 'image', prompt: 'x' } })).status === 403, 'and on generate');
    rec((await call('/api/open/system', { key: narrowKey })).status === 403, 'and on system');
    await call(`/api/keys/${narrow.data.id}`, { method: 'DELETE' });
  } else {
    rec(false, 'could not create a scoped key', narrow.err?.message);
  }
  rec(scopeAllows([], 'generate') === true, 'scopeAllows: empty scope list means unrestricted');
  rec(scopeAllows(['models'], 'generate') === false, 'scopeAllows: a listed scope does not grant others');
  rec(scopeAllows(['models', 'generate'], 'generate') === true, 'scopeAllows: an explicit grant works');

  console.log('\n── revocation is immediate ─────────────────────────────');
  const before = await call('/api/open/system', { key });
  rec(before.status === 200, 'the key works before revocation');
  const rev = await call(`/api/keys/${created.data.id}`, { method: 'DELETE' });
  rec(rev.status === 200 && rev.data?.revoked === true, 'DELETE /api/keys/{id} revokes it');
  const after = await call('/api/open/system', { key });
  rec(after.status === 401, 'and the very next request with it is refused', `HTTP ${after.status}`);
  rec(after.err?.code === 'invalid_api_key', 'with no hint that it was once valid', after.err?.code);
  const afterProjects = await call('/api/open/projects', { key });
  rec(afterProjects.status === 401, 'every open route refuses it, not just the one we tested');
  // DELETE is idempotent: an already-revoked key already satisfies it. What must
  // not happen is a second `revoked: true` that hides the fact nothing changed.
  const revokeAgain = await call(`/api/keys/${created.data.id}`, { method: 'DELETE' });
  rec(revokeAgain.status === 200 && revokeAgain.data?.revoked === true, 'revoking twice is idempotent, not an error', `HTTP ${revokeAgain.status}`);
  rec(revokeAgain.data?.alreadyRevoked === true, 'and says it was already revoked', `alreadyRevoked=${revokeAgain.data?.alreadyRevoked}`);
  rec(rev.data?.alreadyRevoked === false, 'while the first revocation reports it did the work', `alreadyRevoked=${rev.data?.alreadyRevoked}`);
  const revokeForeign = await call('/api/keys/key_doesnotexist', { method: 'DELETE' });
  rec(revokeForeign.status === 404, 'an unknown key id 404s');

  const listedAfter = await call('/api/keys');
  const revokedRow = (listedAfter.data?.keys ?? []).find((k: any) => k.id === created.data.id);
  rec(revokedRow?.enabled === false, 'the revoked key is still listed, marked disabled, for audit');
  rec(revokedRow?.lastUsedAt !== null, 'and records that it was used');

  console.log('\n── hashing ─────────────────────────────────────────────');
  rec(hashKey(key) === hashKey(key), 'hashKey is deterministic, so lookup by hash works');
  rec(hashKey(key) !== hashKey(`${key}x`), 'and a one-character change produces a different hash');
  rec(!hashKey(key).includes(key), 'the hash does not contain the key');
  rec(hashKey('afs_abc') === hashKey('  afs_abc  '), 'surrounding whitespace is normalised before hashing');
  rec(hashKey('afs_abc') !== hashKey('afs_abcd'), 'but keys differing by a character stay distinct');

  // The bug this guards against: creation hashed the trimmed key while
  // verification hashed it raw, and the shape check ran before trimming, so a
  // valid key could be rejected with nothing to explain why. `Bearer  key` is
  // legal (the separator is \s+), so the captured value can carry padding.
  //
  // Needs its OWN key: `key` was revoked in the section above, and testing
  // whitespace handling with a dead key passes for the wrong reason (or fails
  // for one that has nothing to do with whitespace).
  const ws = await call('/api/keys', { method: 'POST', body: { name: 'Whitespace probe' } });
  const wsKey: string = ws.data?.plaintext;
  if (wsKey) {
    const dblSpace = await fetch(`${OPEN}/system`, { headers: { authorization: `Bearer  ${wsKey}` } });
    rec(dblSpace.status === 200, 'two spaces after Bearer still authenticates', `HTTP ${dblSpace.status}`);
    const tabbed = await fetch(`${OPEN}/system`, { headers: { authorization: `Bearer\t${wsKey}` } });
    rec(tabbed.status === 200, 'a tab separator still authenticates', `HTTP ${tabbed.status}`);
    const padded = await fetch(`${OPEN}/system`, { headers: { 'x-api-key': `  ${wsKey}  ` } });
    rec(padded.status === 200, 'padding in x-api-key still authenticates', `HTTP ${padded.status}`);
    const baseline = await call('/api/open/system', { key: wsKey });
    rec(baseline.status === 200, 'and the same key works normally, so the above are not false positives', `HTTP ${baseline.status}`);
    await call(`/api/keys/${ws.data.id}`, { method: 'DELETE' });
  } else {
    rec(false, 'could not create a key for the whitespace probe', ws.err?.message);
  }

  // The keys we made are gone from the live set; clean up the project too.
  await call(`/api/open/projects/${pid}`, { key, method: 'DELETE' }).catch(() => {});

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
  return fail === 0 ? 0 : 1;
}

main()
  .then(code => { killAll(); process.exit(code); })
  .catch(err => { console.error('\nHarness error:', err); killAll(); process.exit(2); });
