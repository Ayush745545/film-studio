import { api } from '@/lib/api';
import { buildBootstrap } from '@/lib/bootstrap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Everything the shell needs on first paint — one round trip instead of twelve. */
export const GET = api(async ({ user }) => buildBootstrap(user));
