import { api, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { templateNodes } from '@/lib/automation/engine';
import { uid, nowIso } from '@/lib/ids';
import type { Automation } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const db = await getDb();
  const projectId = query().get('projectId');
  const rows = await db.repo('automations').findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } }) as unknown as Automation[];
  const runs = await db.repo('runs').findMany({ where: { userId: user.id }, orderBy: { startedAt: 'desc' }, take: 40 });
  return {
    automations: projectId ? rows.filter(a => a.projectId === projectId) : rows,
    runs,
    templates: [
      { id: 'full-film', name: 'Idea → Finished Film', description: 'The complete pipeline with four human review gates before anything expensive runs.', nodes: 18 },
      { id: 'storyboard-only', name: 'Storyboard Only', description: 'Break the script into shots, generate frames, stop for approval before video.', nodes: 6 },
      { id: 'social-cut', name: 'Social Cut + Export', description: 'Assemble a vertical captioned cut and export it.', nodes: 6 }
    ]
  };
});

export const POST = api(async ({ user, json }) => {
  const body = await json<Partial<Automation> & { name: string; template?: string; projectId?: string | null }>();
  if (!body.name?.trim()) throw badRequest('Workflow name is required');
  const db = await getDb();
  const id = uid('auto');
  const tpl = body.template ? templateNodes(body.template as 'full-film' | 'storyboard-only' | 'social-cut') : { nodes: body.nodes ?? [], edges: body.edges ?? [] };
  const created = await db.repo('automations').create({
    id, projectId: body.projectId ?? null, userId: user.id,
    name: body.name.trim().slice(0, 90), description: body.description ?? '',
    nodes: tpl.nodes.map((n: any) => ({ ...n, automationId: id })),
    edges: tpl.edges.map((e: any) => ({ ...e, automationId: id })),
    trigger: body.trigger ?? 'manual', schedule: body.schedule ?? null,
    maxCostCredits: body.maxCostCredits ?? 500, requireApproval: body.requireApproval !== false,
    enabled: body.enabled !== false, lastRunId: null, createdAt: nowIso(), updatedAt: nowIso()
  } as never);
  return created;
}, { auditAction: 'automation.create' });
