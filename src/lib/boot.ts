import { config, securityWarnings } from './config';

/**
 * Lazy, idempotent boot.
 *
 * This deliberately does NOT live in `instrumentation.ts`. Next compiles that
 * file for the edge runtime as well, and in `next dev` the
 * `process.env.NEXT_RUNTIME === 'nodejs'` guard is not inlined — so webpack
 * still traces the import and dies on the Node-only graph:
 *
 *   UnhandledSchemeError: Reading from "node:child_process" is not handled
 *   node:child_process ← lib/media/ffmpeg ← lib/pipeline/export ← lib/queue/handlers
 *
 * Booting from the request path instead means there is no instrumentation
 * bundle at all, and the app behaves identically in dev, `next build`,
 * `next start` and standalone output. Cost: the first request does a few
 * milliseconds of extra work (all of it cached on globalThis afterwards).
 */
interface BootGlobals {
  afsBooted?: boolean;
  afsBooting?: Promise<void>;
}
const g = globalThis as unknown as BootGlobals;

export function isBooted(): boolean { return g.afsBooted === true; }

export function ensureBooted(): Promise<void> {
  if (g.afsBooted) return Promise.resolve();
  if (g.afsBooting) return g.afsBooting;

  g.afsBooting = (async () => {
    const started = Date.now();
    // Imported lazily so this module itself stays free of Node-only deps and
    // can be referenced from anywhere without dragging the graph along.
    const [{ installHandlers }, { startQueue }, { startRateLimitSweeper }, { seedRegistry }, { getDb }, { ensureLocalUser }, { getSubscription }] =
      await Promise.all([
        import('./queue/handlers'),
        import('./queue'),
        import('./security/rate-limit'),
        import('./ai/seed'),
        import('./db'),
        import('./security/auth'),
        import('./credits')
      ]);

    // Workers must be registered before the scheduler can drain anything.
    installHandlers();
    startRateLimitSweeper();

    for (const w of securityWarnings()) console.warn(`[security] ${w}`);
    console.log(`[boot] env=${config.nodeEnv} auth=${config.authMode} queue=${config.queueDriver} workers=${config.workerMode}`);

    try {
      await getDb();
      await seedRegistry();
      const user = await ensureLocalUser();
      await getSubscription(user.id);
    } catch (err) {
      console.error('[boot] initialisation failed:', (err as Error).message);
    }

    startQueue();
    g.afsBooted = true;
    g.afsBooting = undefined;
    console.log(`[boot] AI Film Studio ready in ${Date.now() - started}ms`);
  })();

  return g.afsBooting;
}
