import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import type { Asset, Project, SearchHit } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Global search across projects and assets. */
export const GET = api(async ({ user, query }) => {
  const q = (query().get('q') ?? '').trim().toLowerCase();
  const db = await getDb();
  const [projects, assets] = await Promise.all([
    db.repo('projects').findMany({ where: { userId: user.id }, orderBy: { lastOpenedAt: 'desc' }, take: 100 }) as unknown as Promise<Project[]>,
    db.repo('assets').findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 500 }) as unknown as Promise<Asset[]>
  ]);
  if (!q) return { hits: [], query: q };
  const hits: SearchHit[] = [];
  for (const p of projects) {
    const hay = `${p.name} ${p.description} ${p.tags.join(' ')} ${p.story?.logline ?? ''} ${p.idea?.text ?? ''}`.toLowerCase();
    if (hay.includes(q)) hits.push({ id: p.id, kind: 'project', title: p.name, subtitle: `${p.type} · rev ${p.rev}`, projectId: p.id, stage: p.stage, score: hay.startsWith(q) ? 3 : 2 });
  }
  for (const a of assets) {
    const hay = `${a.name} ${a.prompt} ${a.tags.join(' ')}`.toLowerCase();
    if (hay.includes(q)) hits.push({ id: a.id, kind: 'asset', title: a.name, subtitle: `${a.kind}${a.demo ? ' · demo' : ''}`, projectId: a.projectId, stage: null, score: 1.2 });
  }
  return { hits: hits.sort((a, b) => b.score - a.score).slice(0, 40), query: q };
});
