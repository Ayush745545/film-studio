import { api } from '@/lib/api';
import { cancelRun } from '@/lib/automation/engine';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const POST = api(async ({ user, params }) => ({ ok: await cancelRun(params.id, user.id) }), { strict: true });
