import { config, isProd, securityWarnings } from './config';
import { hasFfmpeg } from './media/ffmpeg';
import { getDb, dbInfo } from './db';
import { storage } from './storage';
import { providerStatusMap } from './ai/credentials';

/**
 * Deployment posture and a production-readiness checklist.
 *
 * The product runs in three legitimate shapes — fully offline on one machine,
 * hybrid (cloud storage or database, local media), or fully cloud-native — and
 * each has different requirements. Rather than a wall of env vars, this reports
 * what is currently true and what is still outstanding.
 */
export type Posture = 'offline' | 'hybrid' | 'cloud';

export interface ChecklistItem {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'todo';
  detail: string;
  fix?: string;
}

export interface DeploymentReport {
  posture: Posture;
  postureLabel: string;
  postureDetail: string;
  isProd: boolean;
  components: {
    database: { driver: string; detail: string; managed: boolean };
    storage: { driver: string; managed: boolean };
    queue: { driver: string; workerMode: string; separated: boolean };
    media: { ffmpeg: boolean };
    auth: { mode: string; multiUser: boolean };
    ai: { engine: 'built-in' | 'providers'; readyProviders: number; totalProviders: number };
  };
  checklist: ChecklistItem[];
  warnings: string[];
}

export async function deploymentReport(userId: string): Promise<DeploymentReport> {
  const [ffmpeg, info, statuses] = await Promise.all([hasFfmpeg(), dbInfo(), providerStatusMap(userId)]);
  const st = storage();

  const dbManaged = info.driver === 'prisma';
  const storageManaged = st.name === 's3';
  const readyProviders = Object.values(statuses).filter(s => s === 'connected' || s === 'env').length;
  const totalProviders = Object.keys(statuses).length;

  const posture: Posture = dbManaged && storageManaged ? 'cloud' : dbManaged || storageManaged ? 'hybrid' : 'offline';
  const postureLabel = { offline: 'Offline / single host', hybrid: 'Hybrid', cloud: 'Cloud-native' }[posture];
  const postureDetail = {
    offline: 'Embedded file database and local disk storage. Everything runs on one machine with no external services — ideal for a single operator, an edit suite, or air-gapped use.',
    hybrid: 'Some state lives in managed services and some on local disk. Workable for a small team; make both managed before scaling out.',
    cloud: 'Managed PostgreSQL and S3-compatible object storage. Safe to run multiple app instances behind a load balancer.'
  }[posture];

  const checklist: ChecklistItem[] = [
    {
      id: 'encryption-key',
      label: 'Credential encryption key',
      status: config.encryptionKey.includes('dev-only') ? (isProd ? 'todo' : 'warn') : 'ok',
      detail: config.encryptionKey.includes('dev-only')
        ? 'Using the development default. Provider API keys are encrypted, but with a key anyone can read from the repo.'
        : 'A unique AFS_ENCRYPTION_KEY is set. Provider keys are encrypted with it at rest.',
      fix: 'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" → AFS_ENCRYPTION_KEY'
    },
    {
      id: 'session-secret',
      label: 'Session signing secret',
      status: config.sessionSecret.includes('dev-only') ? (isProd ? 'todo' : 'warn') : 'ok',
      detail: config.sessionSecret.includes('dev-only') ? 'Using the development default — sessions and signed media URLs are forgeable.' : 'A unique AFS_SESSION_SECRET is set.',
      fix: 'Set AFS_SESSION_SECRET to a fresh 32-byte hex value'
    },
    {
      id: 'database',
      label: 'Database',
      status: dbManaged ? 'ok' : (isProd ? 'warn' : 'ok'),
      detail: dbManaged ? `PostgreSQL via Prisma (${info.detail}).` : `Embedded file driver at ${info.detail}. Single-host only — safe for one operator, not for multiple instances.`,
      fix: dbManaged ? undefined : 'Set DATABASE_URL and run npx prisma db push'
    },
    {
      id: 'storage',
      label: 'Object storage',
      status: storageManaged ? 'ok' : (isProd ? 'warn' : 'ok'),
      detail: storageManaged ? 'S3-compatible storage — media is shared across instances and survives container restarts.' : 'Local filesystem. Media is written inside the container/host and is not shared between instances.',
      fix: storageManaged ? undefined : 'Set AFS_STORAGE_DRIVER=s3 with AWS_S3_BUCKET / credentials / endpoint'
    },
    {
      id: 'auth',
      label: 'Authentication',
      status: config.authMode === 'credentials' ? 'ok' : (isProd ? 'warn' : 'ok'),
      detail: config.authMode === 'credentials'
        ? 'Email + password with bcrypt hashing and a JWT in an httpOnly, SameSite cookie.'
        : 'Open mode: one local profile, no sign-in. Right for a single operator or an air-gapped suite.',
      fix: config.authMode === 'credentials' ? undefined : 'Set AFS_AUTH_MODE=credentials for multi-user access'
    },
    {
      id: 'ffmpeg',
      label: 'FFmpeg (server renders)',
      status: ffmpeg ? 'ok' : 'warn',
      detail: ffmpeg
        ? 'Available — server-side H.264 / H.265 / ProRes renders are enabled.'
        : 'Not found. The in-browser renderer, stem mixdowns and project bundles still work; server video renders are disabled and say so.',
      fix: ffmpeg ? undefined : 'Install ffmpeg, or set FFMPEG_PATH. The Docker image already includes it.'
    },
    {
      id: 'worker',
      label: 'Media worker separation',
      status: config.workerMode === 'external' ? 'ok' : 'warn',
      detail: config.workerMode === 'external'
        ? 'Heavy exports run in a separate process, so a long render cannot block request handling.'
        : 'Exports run inside the web process. Fine for a single user; separate them for concurrent renders.',
      fix: config.workerMode === 'external' ? undefined : 'Set AFS_WORKER_MODE=external and run `npm run worker` (compose does this for you)'
    },
    {
      id: 'providers',
      label: 'AI providers',
      status: readyProviders > 0 ? 'ok' : 'warn',
      detail: readyProviders > 0
        ? `${readyProviders} of ${totalProviders} providers have usable credentials. The router picks by capability, quality and cost, with automatic fallback.`
        : `No provider credentials yet — generation is served by the built-in Studio Engine, which renders previsualisation media at zero cost.`,
      fix: readyProviders > 0 ? undefined : 'Settings → AI Providers → add a key, or set platform keys in the environment'
    },
    {
      id: 'uploads',
      label: 'Upload limits',
      status: 'ok',
      detail: `MIME allow-list enforced, ${config.maxUploadMb}MB per file, metadata extracted server-side.`
    }
  ];

  return {
    posture, postureLabel, postureDetail, isProd,
    components: {
      database: { driver: info.driver, detail: info.detail, managed: dbManaged },
      storage: { driver: st.name, managed: storageManaged },
      queue: { driver: config.queueDriver, workerMode: config.workerMode, separated: config.workerMode === 'external' },
      media: { ffmpeg },
      auth: { mode: config.authMode, multiUser: config.authMode === 'credentials' },
      ai: { engine: readyProviders > 0 ? 'providers' : 'built-in', readyProviders, totalProviders }
    },
    checklist,
    warnings: securityWarnings()
  };
}
