/**
 * Static architecture guards.
 *
 *   npm run verify
 *
 * These three checks each caught a real bug during development, so they are
 * wired into the repo rather than left as tribal knowledge:
 *
 *   1. No client component may reach a `node:` builtin (breaks the browser build).
 *   2. No `instrumentation.ts` may exist — Next compiles it for the edge runtime
 *      too, and in `next dev` the NEXT_RUNTIME guard is not inlined, so webpack
 *      follows the import and dies with UnhandledSchemeError on `node:` specifiers.
 *   3. No Zustand selector may return a freshly-allocated reference, or React's
 *      getServerSnapshot comparison loops forever during SSR/hydration.
 */
import fs from 'node:fs';
import path from 'node:path';

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
  }
})('src');

const src = f => fs.readFileSync(f, 'utf8');
const isClient = f => /^['"]use client['"]/m.test(src(f).slice(0, 200));
/**
 * Runtime imports only.
 *
 * `import type { X } from '…'` and `export type { X } from '…'` are erased by
 * the compiler, so they cannot leak a node: builtin into a client bundle and
 * must not be counted here.
 */
function importsOf(f) {
  const s = src(f); const out = []; let m;
  const re1 = /(^|[;\n])\s*import\s+type\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  const typeOnly = new Set();
  while ((m = re1.exec(s))) typeOnly.add(m[2]);
  const re1b = /(^|[;\n])\s*export\s+type\s[^;]*?from\s+['"]([^'"]+)['"]/g;
  while ((m = re1b.exec(s))) typeOnly.add(m[2]);

  const re2 = /from\s+['"]([^'"]+)['"]/g;
  while ((m = re2.exec(s))) { if (!typeOnly.has(m[1])) out.push(m[1]); }
  const re3 = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = re3.exec(s))) out.push(m[1]);
  return out;
}
function resolve(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/')) return null;
  const base = spec.startsWith('@/') ? path.join('src', spec.slice(2)) : path.join(path.dirname(from), spec);
  for (const c of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

let failures = 0;
const fail = (rule, msg) => { failures++; console.log(`  ✗ ${rule}\n      ${msg}`); };
const pass = (rule, detail) => console.log(`  ✓ ${rule}${detail ? ' — ' + detail : ''}`);

console.log('\nAI Film Studio — architecture guards\n');

/* 1. client → node: builtin reachability */
{
  const nodeOnly = new Set(files.filter(f => /from ['"]node:/.test(src(f))));
  const seen = new Set(); const parent = new Map();
  const queue = files.filter(isClient);
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const spec of importsOf(f)) {
      const r = resolve(f, spec);
      if (r && !seen.has(r)) { parent.set(r, f); queue.push(r); }
    }
  }
  const leaks = [...nodeOnly].filter(f => seen.has(f));
  if (leaks.length) {
    for (const l of leaks) {
      const chain = [l]; let c = l;
      while (parent.get(c)) { c = parent.get(c); chain.unshift(c); }
      fail('client bundle purity', chain.join(' → '));
    }
  } else {
    pass('client bundle purity', `${queue.length === 0 ? '' : ''}${files.filter(isClient).length} client components, none reach a node: builtin`);
  }
}

/* 2. no instrumentation file */
{
  const instr = ['instrumentation.ts', 'instrumentation.tsx', 'src/instrumentation.ts', 'src/instrumentation.tsx'].filter(f => fs.existsSync(f));
  if (instr.length) {
    fail('no edge-compiled instrumentation', `${instr.join(', ')} exists — Next builds it for the edge runtime and \`next dev\` cannot fold the NEXT_RUNTIME guard. Boot from src/lib/boot.ts (ensureBooted) instead.`);
  } else {
    pass('no edge-compiled instrumentation', 'boot runs lazily via ensureBooted()');
  }
}

/* 3. zustand selector reference stability */
{
  const bad = [];
  for (const f of files) {
    const s = src(f);
    const re = /use(?:App|Project|Editor)\(\s*(?:\([^)]*\)|\w+)\s*=>\s*([^)\n]*(?:\?\?\s*\[\s*\]|\?\?\s*\{\s*\}|\.filter\(|\.map\(|\.slice\(|\.sort\(|\.flatMap\(|\[\s*\.\.\.))[^\n]*/g;
    let m;
    while ((m = re.exec(s))) {
      // allow `useShallow(...)` wrappers — they memoise with shallow equality
      const before = s.slice(Math.max(0, m.index - 20), m.index + m[0].length);
      if (before.includes('useShallow')) continue;
      const line = s.slice(0, m.index).split('\n').length;
      bad.push(`${f}:${line}  ${m[0].trim().slice(0, 96)}`);
    }
    // inline object selectors: useX(s => ({ ... }))
    const re2 = /use(?:App|Project|Editor)\(\s*(?:\([^)]*\)|\w+)\s*=>\s*\(\{/g;
    while ((m = re2.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 20), m.index);
      if (before.includes('useShallow')) continue;
      const line = s.slice(0, m.index).split('\n').length;
      bad.push(`${f}:${line}  object-literal selector (allocate-free alternatives: one primitive per selector, or useShallow)`);
    }
  }
  if (bad.length) { for (const b of bad) fail('selector stability', b); }
  else pass('selector stability', 'every store selector returns a stable reference');
}

/* 4. boot accessors are the only readers of boot data */
{
  const offenders = [];
  for (const f of files) {
    if (f.endsWith('boot-accessors.ts') || f.endsWith('store/app.ts')) continue;
    const s = src(f);
    // `s.boot` only — not `s.booting` / `s.bootError`, which are unrelated fields.
    if (/use(?:App|Project|Editor)\([^)]*\bs\.boot\b(?!ing|Error)/.test(s)) offenders.push(f);
  }
  if (offenders.length) {
    for (const o of offenders) fail('boot accessors', `${o} reads s.boot directly — use useBoot()/useDemoMode()/… so SSR context is honoured`);
  } else pass('boot accessors', 'all boot reads go through the SSR-aware accessors');
}

console.log(failures ? `\n  ${failures} guard(s) failed\n` : '\n  all guards passed\n');
process.exit(failures ? 1 : 0);
