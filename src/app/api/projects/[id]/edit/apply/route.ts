import { api, badRequest, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { activeTimeline, saveTimeline, snapshot } from '@/lib/project';
import { applyOps } from '@/lib/timeline/ops';
import type { EditProposal, TimelineOp } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Apply a reviewed AI edit proposal. Always snapshots first — nothing is lost. */
export const POST = api(async ({ user, params, json }) => {
  const body = await json<{ proposalId?: string; ops?: TimelineOp[]; reason?: string }>();
  const db = await getDb();
  let ops = body.ops;
  let proposal: EditProposal | null = null;
  if (body.proposalId) {
    const row = await db.repo('kv').findUnique(`proposal:${body.proposalId}`) as unknown as { value?: EditProposal & { projectId: string } } | null;
    proposal = (row?.value ?? null) as (EditProposal & { projectId: string }) | null;
    if (!proposal || (proposal as { projectId?: string }).projectId !== params.id) throw notFound('Proposal not found or expired');
    ops = proposal.ops;
  }
  if (!ops?.length) throw badRequest('No operations to apply');
  const tl = await activeTimeline(params.id);
  if (!tl) throw notFound('No timeline on this project');
  await snapshot(params.id, user.id, body.reason ?? (proposal ? `AI edit: ${proposal.summary}` : 'Timeline edit'), 'aiedit');
  const next = applyOps(tl, ops);
  await saveTimeline(next);
  if (body.proposalId) await db.repo('kv').delete(`proposal:${body.proposalId}`);
  return { timeline: next, applied: ops.length, proposal: proposal ? { summary: proposal.summary, rationale: proposal.rationale } : null };
}, { strict: true });
