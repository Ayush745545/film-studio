import { getDb } from '../db';
import { uid, nowIso } from '../ids';

/** Append-only audit trail. Never include secrets in `meta`. */
export async function audit(entry: {
  userId?: string | null; action: string; entity: string; entityId?: string | null;
  ip?: string | null; meta?: Record<string, unknown>;
}) {
  try {
    const db = await getDb();
    await db.repo('auditLogs').create({
      id: uid('aud'), userId: entry.userId ?? null, action: entry.action, entity: entry.entity,
      entityId: entry.entityId ?? null, ip: entry.ip ?? null,
      meta: redact(entry.meta ?? {}), createdAt: nowIso()
    } as never);
  } catch (err) {
    console.warn('[audit] write failed:', (err as Error).message);
  }
}

const SECRETISH = /(key|token|secret|password|authorization|credential|apikey)/i;
function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = SECRETISH.test(k) ? '[redacted]' : v;
  return out;
}

export async function recentAudit(limit = 100) {
  const db = await getDb();
  return db.repo('auditLogs').findMany({ orderBy: { createdAt: 'desc' }, take: limit });
}
