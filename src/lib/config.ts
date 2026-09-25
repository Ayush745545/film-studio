/** Central runtime configuration. Every value is optional — the app boots in Demo Mode. */
function str(k: string, d = ''): string { return process.env[k] ?? d; }
function int(k: string, d: number): number { const v = Number(process.env[k]); return Number.isFinite(v) && process.env[k] ? v : d; }

export const config = {
  dataDir: str('AFS_DATA_DIR', './.afs-data'),
  dbDriver: str('AFS_DB_DRIVER', 'auto') as 'auto' | 'file' | 'prisma',
  databaseUrl: str('DATABASE_URL', ''),

  storageDriver: str('AFS_STORAGE_DRIVER', 'local') as 'local' | 's3',
  storageDir: str('AFS_STORAGE_DIR', './.afs-data/storage'),
  s3: {
    bucket: str('AWS_S3_BUCKET', ''),
    region: str('AWS_REGION', 'us-east-1'),
    endpoint: str('AWS_S3_ENDPOINT', ''),
    accessKeyId: str('AWS_ACCESS_KEY_ID', ''),
    secretAccessKey: str('AWS_SECRET_ACCESS_KEY', '')
  },
  signedUrlTtl: int('AFS_SIGNED_URL_TTL', 900),

  encryptionKey: str('AFS_ENCRYPTION_KEY', 'dev-only-insecure-encryption-key-change-me'),
  sessionSecret: str('AFS_SESSION_SECRET', 'dev-only-insecure-session-secret-change-me'),
  authMode: str('AFS_AUTH_MODE', 'open') as 'open' | 'credentials',
  rateLimit: { windowMs: int('AFS_RATE_LIMIT_WINDOW_MS', 60_000), max: int('AFS_RATE_LIMIT_MAX', 240) },

  queueDriver: str('AFS_QUEUE_DRIVER', 'memory') as 'memory' | 'redis',
  /**
   * `inline`  — the web process runs every job (default, zero setup).
   * `external`— the web process leaves heavy media jobs (export/stems/bundle)
   *            queued for `npm run worker`, which polls the shared database.
   */
  workerMode: str('AFS_WORKER_MODE', 'inline') as 'inline' | 'external',
  redisUrl: str('REDIS_URL', ''),
  workerConcurrency: int('AFS_WORKER_CONCURRENCY', 3),
  demoMode: str('AFS_DEMO_MODE', 'auto') as 'auto' | 'on' | 'off',

  maxUploadMb: int('AFS_MAX_UPLOAD_MB', 512),
  ffmpegPath: str('FFMPEG_PATH', 'ffmpeg'),
  nodeEnv: str('NODE_ENV', 'development'),

  /** Platform-owned keys. Read server-side only; never serialised to the client. */
  platformKeys: {
    OPENAI_API_KEY: str('OPENAI_API_KEY', ''),
    OPENAI_BASE_URL: str('OPENAI_BASE_URL', ''),
    OPENROUTER_API_KEY: str('OPENROUTER_API_KEY', ''),
    ANTHROPIC_API_KEY: str('ANTHROPIC_API_KEY', ''),
    REPLICATE_API_TOKEN: str('REPLICATE_API_TOKEN', ''),
    FAL_KEY: str('FAL_KEY', ''),
    ELEVENLABS_API_KEY: str('ELEVENLABS_API_KEY', ''),
    SUNO_API_KEY: str('SUNO_API_KEY', ''),
    COMFYUI_URL: str('COMFYUI_URL', ''),
    OLLAMA_BASE_URL: str('OLLAMA_BASE_URL', '')
  }
} as const;

export const isProd = config.nodeEnv === 'production';
export const isDev = config.nodeEnv !== 'production';

export function securityWarnings(): string[] {
  const w: string[] = [];
  if (isProd && config.encryptionKey.includes('dev-only')) w.push('AFS_ENCRYPTION_KEY is the development default — provider API keys are not safely encrypted.');
  if (isProd && config.sessionSecret.includes('dev-only')) w.push('AFS_SESSION_SECRET is the development default.');
  if (isProd && !config.databaseUrl) w.push('DATABASE_URL is not set — running on the embedded file database, which is not suitable for multi-instance production.');
  if (isProd && config.storageDriver === 'local') w.push('Storage driver is "local" — generated media will not be shared across instances.');
  return w;
}
