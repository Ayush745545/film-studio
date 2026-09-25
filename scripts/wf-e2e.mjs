// Prove a workflow runs end-to-end: create → run → approve every gate → finish.
// Guards against the infinite-loop bug (re-suspending on the same gate).
const B = 'http://127.0.0.1:3000';
const j = (r) => r.json();
async function call(method, path, body) {
  const res = await fetch(B + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, ...(await res.json().catch(() => ({}))) };
}
(async () => {
  const boot = await fetch(B + '/api/bootstrap').then(j);
  const projectId = boot.data?.projects?.[0]?.id ?? null;
  console.log('project:', projectId, boot.data?.projects?.[0]?.name);

  const created = await call('POST', '/api/automations', { name: 'E2E Storyboard', template: 'storyboard-only', projectId, requireApproval: true });
  const autoId = created.data?.id;
  console.log('automation:', autoId, 'nodes:', created.data?.nodes?.length);

  const run = await call('POST', `/api/automations/${autoId}/run`, { projectId });
  const runId = run.data?.id;
  console.log('run:', runId, 'status:', run.data?.status);

  const seenGates = [];
  let last = null;
  for (let approve = 0; approve < 12; approve++) {
    // poll until terminal or waiting
    let r = null;
    for (let i = 0; i < 120; i++) {
      await new Promise(s => setTimeout(s, 400));
      const rr = await call('GET', `/api/runs/${runId}`);
      r = rr.data?.run ?? rr.data;
      if (['succeeded', 'failed', 'cancelled', 'waiting'].includes(r?.status)) break;
    }
    last = r;
    if (!r) { console.log('no run state'); break; }
    if (r.status === 'waiting') {
      const gateKey = `${r.review?.nodeId}|${r.review?.prompt}`;
      seenGates.push(gateKey);
      // infinite-loop detector: same gate approved 3x in a row
      const tail = seenGates.slice(-3);
      if (tail.length === 3 && tail.every(x => x === tail[0])) { console.log('!! INFINITE LOOP: same gate re-requested:', r.review?.prompt); break; }
      console.log(`  gate #${approve + 1}: "${r.review?.prompt}" (progress ${r.progress}) → approving`);
      await call('POST', `/api/runs/${runId}/review`, { decision: 'approve' });
      continue;
    }
    break; // terminal
  }
  console.log('\nFINAL status:', last?.status, 'progress:', last?.progress, last?.error ? 'error=' + last.error : '');
  console.log('gates encountered:', seenGates.length, '| unique:', new Set(seenGates).size);
  console.log('visited nodes:', (last?.visited ?? []).length);
  const ok = last?.status === 'succeeded';
  console.log(ok ? '\n✅ WORKFLOW RAN TO COMPLETION' : `\n⚠ ended as "${last?.status}"`);
})().catch(e => console.error('CRASH', e));
