import { getDb } from './db';
import { getSubscription, usageSummary } from './credits';
import { isDemoMode } from './ai/router';
import { providerStatusMap } from './ai/credentials';
import { PLANS } from './pricing';
import { seedRegistry } from './ai/seed';
import { config } from './config';
import { hasFfmpeg } from './media/ffmpeg';
import { listProjects } from './project';
import { queueSnapshot } from './queue';
import { storage } from './storage';
import { dbInfo } from './db';
import type { ModelDescriptor, ModelPreset, Project, Provider, User } from '@/types';

/**
 * One payload, two consumers.
 *
 * The `/api/bootstrap` route and the server-rendered layout both call this, so
 * the very first paint already has real data instead of a loading splash that
 * swaps out a moment later.
 */
export interface BootstrapPayload {
  user: { id: string; email: string; name: string; avatarColor: string; role: string; developerMode: boolean; theme: string; onboardingDone: boolean };
  subscription: Awaited<ReturnType<typeof getSubscription>>;
  plans: typeof PLANS;
  demoMode: boolean;
  ffmpeg: boolean;
  database: string;
  storage: string;
  providers: Provider[];
  models: ModelDescriptor[];
  presets: ModelPreset[];
  projects: ProjectSummary[];
  queue: { active: Awaited<ReturnType<typeof queueSnapshot>>['active']; counts: Record<string, number> };
  usage: Awaited<ReturnType<typeof usageSummary>>;
  limits: { maxUploadMb: number; authMode: string };
}

export interface ProjectSummary {
  id: string; name: string; type: Project['type']; stage: Project['stage']; rev: number;
  updatedAt: string; coverAssetId: string | null; coverUrl: string | null;
  stageStates: Project['stageStates']; description: string; tags: string[];
  runtimeSec: number; shotCount: number; assetCount: number;
}

export async function buildBootstrap(user: User): Promise<BootstrapPayload> {
  await seedRegistry();
  const db = await getDb();
  const [sub, demo, statuses, presets, providers, models, projects, queue, ffmpeg, usage, info] = await Promise.all([
    getSubscription(user.id), isDemoMode(user.id), providerStatusMap(user.id),
    db.repo('presets').findMany({}) as unknown as Promise<ModelPreset[]>,
    db.repo('providers').findMany({ orderBy: { priority: 'asc' } }) as unknown as Promise<Provider[]>,
    db.repo('models').findMany({}) as unknown as Promise<ModelDescriptor[]>,
    listProjects(user.id), queueSnapshot(user.id), hasFfmpeg(), usageSummary(user.id), dbInfo()
  ]);

  // Resolve cover art + a few counts in one pass so project cards can render
  // real generated frames instead of a placeholder gradient.
  const ids = projects.map(p => p.id);
  const [assets, shots] = await Promise.all([
    ids.length ? db.repo('assets').findMany({}) as unknown as Promise<{ projectId: string | null; id: string; url: string; kind: string; demo: boolean; createdAt: string }[]> : Promise.resolve([]),
    ids.length ? db.repo('shots').findMany({}) as unknown as Promise<{ projectId: string; videoAssetId: string | null; frameAssetId: string | null; durationSec: number }[]> : Promise.resolve([])
  ]);
  const byProject = new Map<string, typeof assets>();
  for (const a of assets) {
    if (!a.projectId) continue;
    const arr = byProject.get(a.projectId) ?? []; arr.push(a); byProject.set(a.projectId, arr);
  }
  const shotsByProject = new Map<string, typeof shots>();
  for (const s of shots) {
    const arr = shotsByProject.get(s.projectId) ?? []; arr.push(s); shotsByProject.set(s.projectId, arr);
  }

  const summaries: ProjectSummary[] = projects.slice(0, 24).map(p => {
    const pa = byProject.get(p.id) ?? [];
    const ps = shotsByProject.get(p.id) ?? [];
    const cover = (p.coverAssetId ? pa.find(a => a.id === p.coverAssetId) : null)
      ?? pa.find(a => a.kind === 'storyboard')
      ?? pa.find(a => a.kind === 'image')
      ?? pa.find(a => a.kind === 'character')
      ?? null;
    return {
      id: p.id, name: p.name, type: p.type, stage: p.stage, rev: p.rev, updatedAt: p.updatedAt,
      coverAssetId: p.coverAssetId, coverUrl: cover?.url ?? null,
      stageStates: p.stageStates, description: p.description, tags: p.tags,
      runtimeSec: Math.round(ps.reduce((a, s) => a + (s.durationSec ?? 0), 0)),
      shotCount: ps.length, assetCount: pa.length
    };
  });

  return {
    user: { id: user.id, email: user.email, name: user.name, avatarColor: user.avatarColor, role: user.role, developerMode: user.developerMode, theme: user.theme, onboardingDone: user.onboardingDone },
    subscription: sub, plans: PLANS, demoMode: demo, ffmpeg,
    database: info.driver, storage: storage().name,
    providers: providers.map(p => ({ ...p, credentialStatus: statuses[p.id] ?? 'missing' })),
    models, presets, projects: summaries,
    queue: { active: queue.active.slice(0, 20), counts: queue.counts },
    usage,
    limits: { maxUploadMb: config.maxUploadMb, authMode: config.authMode }
  };
}
