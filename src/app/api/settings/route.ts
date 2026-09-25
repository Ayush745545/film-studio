import { api } from '@/lib/api';
import { getDb } from '@/lib/db';
import { config, securityWarnings } from '@/lib/config';
import { currentUser } from '@/lib/security/auth';
import { recentAudit } from '@/lib/security/audit';
import { nowIso } from '@/lib/ids';
import { isThemeId, DEFAULT_THEME } from '@/lib/themes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user }) => {
  const db = await getDb();
  const prefs = await db.repo('kv').findUnique(`prefs:${user.id}`) as unknown as { value?: Record<string, unknown> } | null;
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, developerMode: user.developerMode, theme: user.theme, onboardingDone: user.onboardingDone },
    preferences: prefs?.value ?? {},
    system: {
      env: config.nodeEnv, authMode: config.authMode, dbDriver: config.dbDriver,
      storageDriver: config.storageDriver, queueDriver: config.queueDriver,
      workerConcurrency: config.workerConcurrency, maxUploadMb: config.maxUploadMb,
      demoMode: config.demoMode, ffmpegPath: config.ffmpegPath,
      hasDatabaseUrl: Boolean(config.databaseUrl),
      platformKeys: Object.entries(config.platformKeys).map(([k, v]) => ({ key: k, configured: Boolean(v) })),
      warnings: securityWarnings()
    },
    audit: (await recentAudit(30)).map((a: any) => ({ id: a.id, action: a.action, entity: a.entity, entityId: a.entityId, createdAt: a.createdAt, meta: a.meta }))
  };
});

export const PATCH = api(async ({ user, json }) => {
  const db = await getDb();
  const body = await json<{ name?: string; developerMode?: boolean; theme?: string; preferences?: Record<string, unknown> }>();
  const userPatch: Record<string, unknown> = { updatedAt: nowIso() };
  if (typeof body.name === 'string' && body.name.trim()) userPatch.name = body.name.trim().slice(0, 80);
  if (typeof body.developerMode === 'boolean') userPatch.developerMode = body.developerMode;
  // Accept any registered theme id; reject anything else rather than persisting
  // a value that would fall back to the default on the next paint.
  if (body.theme !== undefined) {
    if (isThemeId(body.theme)) userPatch.theme = body.theme;
    else if (body.theme === 'dark') userPatch.theme = DEFAULT_THEME;   // legacy value migration
  }
  await db.repo('users').update(user.id, userPatch as never);

  if (body.preferences && typeof body.preferences === 'object') {
    const key = `prefs:${user.id}`;
    const existing = await db.repo('kv').findUnique(key) as unknown as { value?: Record<string, unknown> } | null;
    await db.repo('kv').upsert(key, { id: key, key, value: { ...(existing?.value ?? {}), ...body.preferences }, updatedAt: nowIso() } as never);
  }
  const u = await db.repo('users').findUnique(user.id);
  return { user: u };
}, { auditAction: 'settings.update' });
