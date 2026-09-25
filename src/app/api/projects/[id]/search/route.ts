import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getProject } from '@/lib/project';
import { scriptText } from '@/lib/domain/script';
import type { Asset, Character, GenerationJob, Location, Scene, Shot, SoundCue, VoiceLine } from '@/types';
import type { SearchHit } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Project-scoped search across every entity type. */
export const GET = api(async ({ user, params, query }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const q = (query().get('q') ?? '').trim().toLowerCase();
  if (!q) return { hits: [], query: q };
  const db = await getDb();
  const [characters, locations, scenes, shots, voices, sounds, assets, jobs] = await Promise.all([
    db.repo('characters').findMany({ where: { projectId: params.id } }) as unknown as Promise<Character[]>,
    db.repo('locations').findMany({ where: { projectId: params.id } }) as unknown as Promise<Location[]>,
    db.repo('scenes').findMany({ where: { projectId: params.id } }) as unknown as Promise<Scene[]>,
    db.repo('shots').findMany({ where: { projectId: params.id } }) as unknown as Promise<Shot[]>,
    db.repo('voices').findMany({ where: { projectId: params.id } }) as unknown as Promise<VoiceLine[]>,
    db.repo('sounds').findMany({ where: { projectId: params.id } }) as unknown as Promise<SoundCue[]>,
    db.repo('assets').findMany({ where: { projectId: params.id } }) as unknown as Promise<Asset[]>,
    db.repo('jobs').findMany({ where: { projectId: params.id }, orderBy: { createdAt: 'desc' }, take: 200 }) as unknown as Promise<GenerationJob[]>
  ]);
  const hits: SearchHit[] = [];
  const score = (hay: string, weight = 1) => {
    const h = hay.toLowerCase();
    if (h === q) return 3 * weight;
    if (h.startsWith(q)) return 2.2 * weight;
    if (h.includes(q)) return 1.4 * weight;
    return 0;
  };
  for (const c of characters) {
    const s = score(c.name, 1.6) + score(c.role, 0.6) + score(c.description, 0.4) + score(c.identityPrompt, 0.3);
    if (s) hits.push({ id: c.id, kind: 'character', title: c.name, subtitle: `${c.role}${c.locked ? ' · locked' : ''}`, projectId: params.id, stage: 'characters', score: s });
  }
  for (const l of locations) {
    const s = score(l.name, 1.5) + score(l.description, 0.4);
    if (s) hits.push({ id: l.id, kind: 'location', title: l.name, subtitle: `${l.timeOfDay} · ${l.lighting}`.slice(0, 70), projectId: params.id, stage: 'world', score: s });
  }
  for (const sc of scenes) {
    const s = score(sc.heading, 1.3) + score(sc.action, 0.5) + score(sc.dialogue, 0.7) + score(sc.emotion, 0.3);
    if (s) hits.push({ id: sc.id, kind: 'scene', title: `Scene ${sc.index}`, subtitle: sc.heading, projectId: params.id, stage: 'scenes', score: s });
  }
  for (const sh of shots) {
    const s = score(sh.prompt, 0.9) + score(sh.description, 0.7) + score(sh.size, 0.5) + score(sh.dialogue, 0.6);
    if (s) hits.push({ id: sh.id, kind: 'shot', title: `Shot ${sh.index} · ${sh.size}`, subtitle: `${sh.lens} · ${sh.move} · ${sh.durationSec}s`, projectId: params.id, stage: 'shots', score: s });
  }
  for (const v of voices) {
    const s = score(v.text, 1.1) + score(v.speaker, 1.2);
    if (s) hits.push({ id: v.id, kind: 'dialogue', title: `${v.speaker}: “${v.text.slice(0, 48)}”`, subtitle: `${v.emotion} · ${v.voiceId}`, projectId: params.id, stage: 'voice', score: s });
  }
  for (const c of sounds) {
    const s = score(c.name, 1.1) + score(c.prompt, 0.6);
    if (s) hits.push({ id: c.id, kind: 'prompt', title: c.name, subtitle: `${c.kind} · ${c.durationSec}s`, projectId: params.id, stage: 'sound', score: s });
  }
  for (const a of assets) {
    const s = score(a.name, 1.2) + score(a.prompt, 0.5) + score(a.tags.join(' '), 0.6);
    if (s) hits.push({ id: a.id, kind: 'asset', title: a.name, subtitle: `${a.kind}${a.demo ? ' · demo' : ''} · ${a.mimeType}`, projectId: params.id, stage: null, score: s });
  }
  for (const j of jobs) {
    const s = score(j.label, 0.9) + score(j.sublabel, 0.5);
    if (s) hits.push({ id: j.id, kind: 'generation', title: j.label, subtitle: `${j.status} · ${j.kind}`, projectId: params.id, stage: j.stage as never, score: s });
  }
  if (p.screenplay) {
    const t = scriptText(p.screenplay);
    const lines = t.split('\n');
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(q) && hits.filter(h => h.kind === 'dialogue').length < 8) {
        hits.push({ id: `${p.screenplay!.id}-${i}`, kind: 'dialogue', title: line.trim().slice(0, 70), subtitle: `Screenplay line ${i + 1}`, projectId: params.id, stage: 'script', score: 1 });
      }
    });
  }
  return { hits: hits.sort((a, b) => b.score - a.score).slice(0, 60), query: q };
});
