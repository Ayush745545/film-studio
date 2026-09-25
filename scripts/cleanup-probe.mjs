// Remove artifacts left by the live probes so the dev DB returns to a pristine
// demo state (demo mode on, no stray providers/models/workflows).
const B = 'http://127.0.0.1:3000';
const j = r => r.json();
async function call(method, path, body) {
  const res = await fetch(B + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  let d = null; try { d = await res.json(); } catch {}
  return { status: res.status, d };
}
const PROBE_AUTO_NAMES = new Set(['Probe Storyboard Flow', 'E2E Storyboard']);
(async () => {
  const provs = (await fetch(B + '/api/providers').then(j)).data.providers;
  const custom = provs.filter(p => !p.builtIn);
  const customIds = new Set(custom.map(p => p.id));
  console.log('custom providers to remove:', custom.map(p => `${p.name}(${p.id})`).join(', ') || 'none');

  // models attached to custom providers
  const models = (await fetch(B + '/api/models').then(j)).data.models;
  const orphanModels = models.filter(m => customIds.has(m.providerId) || (m.custom && !provs.some(p => p.id === m.providerId && p.builtIn)));
  for (const m of orphanModels) { const r = await call('DELETE', `/api/models/${m.id}`); console.log('  del model', m.name, r.status); }

  // credentials + providers
  for (const p of custom) {
    const rc = await call('DELETE', `/api/providers/${p.id}/credentials`); console.log('  del creds', p.name, rc.status);
    const rp = await call('DELETE', `/api/providers/${p.id}`); console.log('  del provider', p.name, rp.status);
  }

  // probe automations
  const autos = (await fetch(B + '/api/automations').then(j)).data.automations;
  for (const a of autos.filter(a => PROBE_AUTO_NAMES.has(a.name))) {
    const r = await call('DELETE', `/api/automations/${a.id}`); console.log('  del automation', a.name, r.status);
  }

  // verify demo mode restored
  const sys = (await fetch(B + '/api/system').then(j)).data;
  console.log('\ndemoMode now:', sys.ai?.demoMode, '| providers left:', (await fetch(B + '/api/providers').then(j)).data.providers.length);
})().catch(e => console.error('CRASH', e));
