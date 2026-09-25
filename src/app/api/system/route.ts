import { api } from '@/lib/api';
import { dbInfo } from '@/lib/db';
import { storage } from '@/lib/storage';
import { config, isProd } from '@/lib/config';
import { hasFfmpeg } from '@/lib/media/ffmpeg';
import { isDemoMode } from '@/lib/ai/router';
import { liveCount, queueSnapshot } from '@/lib/queue';
import { registeredDrivers } from '@/lib/ai/adapters';
import { securityWarnings } from '@/lib/config';
import { recentAudit } from '@/lib/security/audit';
import { deploymentReport } from '@/lib/deployment';

export const runtime = 'nodejs';

export const GET = api(async ({ user }) => {
  const [db, ffmpeg, demo, queue] = await Promise.all([
    dbInfo(), hasFfmpeg(), isDemoMode(user.id), queueSnapshot(user.id)
  ]);
  const st = storage();
  return {
    version: '1.0.0',
    env: config.nodeEnv,
    database: db,
    storage: { driver: st.name, bytesUsed: await st.bytesUsed().catch(() => 0) },
    ffmpeg: { available: ffmpeg, path: config.ffmpegPath },
    queue: { driver: config.queueDriver, concurrency: config.workerConcurrency, live: liveCount(), active: queue.active.length, counts: queue.counts },
    ai: { drivers: registeredDrivers(), demoMode: demo, forced: config.demoMode },
    auth: { mode: config.authMode },
    warnings: securityWarnings(),
    isProd,
    deployment: await deploymentReport(user.id)
  };
});

export const dynamic = 'force-dynamic';
