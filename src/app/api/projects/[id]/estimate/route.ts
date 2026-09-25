import { api, notFound, badRequest } from '@/lib/api';
import { getProject, getScenes, getShots, getCharacters, getLocations, loadTimeline } from '@/lib/project';
import { getDb } from '@/lib/db';
import { estimate } from '@/lib/ai/router';
import { baseCredits } from '@/lib/pricing';
import type { SoundCue, VoiceLine } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Pre-flight pricing. Expensive operations must be shown to the user before
 * they run — this endpoint computes exactly what a batch would cost.
 */
export const POST = api(async ({ user, params, json }) => {
  const p = await getProject(params.id, user.id);
  if (!p) throw notFound('Project not found');
  const body = await json<{ action: string; params?: Record<string, any>; modelId?: string | null; presetId?: string | null }>();
  const q = body.params ?? {};
  const db = await getDb();

  const shots = await getShots(p.id);
  const scenes = await getScenes(p.id);
  let units = 1; let kind: 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'text' | 'upscale' = 'text';
  let seconds = 0;

  switch (body.action) {
    case 'frames': {
      kind = 'image';
      const sel = q.shotId ? shots.filter(s => s.id === q.shotId) : q.sceneId ? shots.filter(s => s.sceneId === q.sceneId) : q.missingOnly ? shots.filter(s => !s.frameAssetId) : shots;
      units = sel.length * Math.max(1, Math.min(8, Number(q.count ?? q.variations ?? 1)));
      break;
    }
    case 'videos': {
      kind = 'video';
      const sel = q.shotId ? shots.filter(s => s.id === q.shotId) : q.sceneId ? shots.filter(s => s.sceneId === q.sceneId) : shots;
      units = sel.length;
      seconds = sel.reduce((a, s) => a + Math.min(12, Math.max(1, Number(q.durationSec ?? s.durationSec ?? 5))), 0);
      break;
    }
    case 'character-look': {
      kind = 'image';
      const chars = q.all ? await getCharacters(p.id) : (await getCharacters(p.id)).filter(c => c.id === q.characterId);
      units = chars.length * Math.max(1, Math.min(8, Number(q.count ?? q.variations ?? 3)));
      break;
    }
    case 'location-image': {
      kind = 'image';
      const locs = q.all ? await getLocations(p.id) : (await getLocations(p.id)).filter(l => l.id === q.locationId);
      units = locs.length * Math.max(1, Math.min(8, Number(q.count ?? q.variations ?? 2)));
      break;
    }
    case 'voices': {
      kind = 'voice';
      const v = await db.repo('voices').findMany({ where: { projectId: p.id } }) as unknown as VoiceLine[];
      const sel = q.lineId ? v.filter(x => x.id === q.lineId) : q.sceneId ? v.filter(x => x.sceneId === q.sceneId) : q.all ? v : v.filter(x => !x.assetId);
      units = sel.length;
      break;
    }
    case 'cues': {
      const s = await db.repo('sounds').findMany({ where: { projectId: p.id } }) as unknown as SoundCue[];
      const sel = q.cueId ? s.filter(x => x.id === q.cueId) : q.kind ? s.filter(x => x.kind === q.kind) : q.all ? s : s.filter(x => !x.assetId);
      const music = sel.filter(x => x.kind === 'score' || x.kind === 'music');
      const sfx = sel.filter(x => x.kind !== 'score' && x.kind !== 'music');
      const est1 = await estimate({ kind: 'music', modelId: body.modelId ?? '', prompt: 'score' }, { userId: user.id, kind: 'music', modelId: body.modelId, presetId: body.presetId, allowDemo: true });
      const est2 = await estimate({ kind: 'sfx', modelId: body.modelId ?? '', prompt: 'sfx' }, { userId: user.id, kind: 'sfx', modelId: body.modelId, presetId: body.presetId, allowDemo: true });
      return {
        kind: 'mixed', units: sel.length, credits: Math.round((music.length * est1.credits + sfx.length * est2.credits) * 100) / 100,
        model: est1.model, provider: est1.provider, providerId: est1.providerId, demo: est1.demo && est2.demo,
        strategy: est1.strategy,
        reason: [est1.reason, est2.reason].filter((reason, index, reasons) => reasons.indexOf(reason) === index).join(' · '),
        credentialSource: est1.credentialSource !== 'none' ? est1.credentialSource : est2.credentialSource,
        fallbacks: [...est1.fallbacks, ...est2.fallbacks].filter((fallback, index, fallbacks) =>
          fallbacks.findIndex(candidate => candidate.model === fallback.model && candidate.providerId === fallback.providerId) === index),
        breakdown: `${music.length} music cue(s) + ${sfx.length} sound cue(s)`,
        images: 0, videos: 0, audio: sel.length,
        estSeconds: Math.round(music.reduce((a, c) => a + c.durationSec, 0) + sfx.reduce((a, c) => a + c.durationSec, 0))
      };
    }
    case 'story': case 'script': case 'cast': case 'world': case 'edit-plan': case 'copilot': {
      kind = 'text'; units = 1; break;
    }
    case 'assemble': case 'breakdown': case 'sound-design': case 'dialogue': {
      return {
        kind: 'local', units: 1, credits: 0, breakdown: 'Runs locally — no provider cost',
        model: 'local', provider: 'local', providerId: 'local', strategy: 'explicit', reason: 'Runs locally — no provider routing required',
        credentialSource: 'none', fallbacks: [], demo: true, images: 0, videos: 0, audio: 0, estSeconds: 0
      };
    }
    case 'upscale': { kind = 'upscale'; units = 1; break; }
    case 'image': case 'video': case 'music': case 'sfx': case 'text': {
      kind = body.action; units = body.action === 'image' ? Math.max(1, Math.min(8, Number(q.count ?? 1))) : 1;
      if (body.action === 'video') seconds = Math.min(12, Math.max(1, Number(q.durationSec ?? 5)));
      if (body.action === 'music') seconds = Math.min(120, Math.max(2, Number(q.durationSec ?? 30)));
      break;
    }
    default: throw badRequest(`Unknown action "${body.action}"`);
  }

  const probe = await estimate(
    { kind, modelId: body.modelId ?? '', prompt: String(q.prompt ?? 'x').repeat(Math.max(1, Math.min(40, units))), durationSec: seconds || undefined, count: units },
    { userId: user.id, kind, modelId: body.modelId, presetId: body.presetId, allowDemo: true }
  );
  const perUnit = units > 0 ? probe.credits / units : probe.credits;
  const credits = Math.round((seconds ? probe.credits : perUnit * units) * 100) / 100;
  const ruleCredits = baseCredits(kind, { durationSec: seconds || 5, resolution: q.resolution });
  const fallbackCredits = Math.round(ruleCredits * (seconds ? seconds / 5 : units) * 100) / 100;

  return {
    kind, units, seconds,
    credits: probe.demo ? 0 : Math.max(credits, 0),
    fallbackCredits,
    model: probe.model, provider: probe.provider, providerId: probe.providerId, demo: probe.demo,
    strategy: probe.strategy, reason: probe.reason, credentialSource: probe.credentialSource, fallbacks: probe.fallbacks,
    breakdown: probe.breakdown,
    images: kind === 'image' || kind === 'upscale' ? units : 0,
    videos: kind === 'video' ? units : 0,
    audio: kind === 'voice' || kind === 'music' || kind === 'sfx' ? units : 0,
    estSeconds: estTime(kind, units, seconds),
    scenes: scenes.length, shots: shots.length,
    runtimeSec: Math.round(shots.reduce((a, s) => a + s.durationSec, 0))
  };
});

function estTime(kind: string, units: number, seconds: number): number {
  const per = kind === 'video' ? Math.max(45, seconds * 9) : kind === 'image' ? 14 : kind === 'voice' ? 6 : kind === 'music' ? 40 : 8;
  return Math.round(per * Math.max(1, units));
}
