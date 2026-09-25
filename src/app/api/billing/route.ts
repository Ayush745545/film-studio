import { api, badRequest } from '@/lib/api';
import { getDb } from '@/lib/db';
import { getSubscription, setPlan, cancelPlan, creditHistory, usageSummary } from '@/lib/credits';
import { PLANS, planById } from '@/lib/pricing';
import { audit } from '@/lib/security/audit';
import type { PlanId } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user }) => {
  const db = await getDb();
  const sub = await getSubscription(user.id);
  const invoices = await db.repo('invoices').findMany({ where: { userId: user.id }, orderBy: { issuedAt: 'desc' }, take: 24 });
  return { subscription: sub, plan: planById(sub.planId), plans: PLANS, invoices, history: await creditHistory(user.id, 60), usage: await usageSummary(user.id) };
});

export const POST = api(async ({ user, json, ip }) => {
  const body = await json<{ action: 'change-plan' | 'cancel' | 'resume'; planId?: PlanId }>();
  if (body.action === 'change-plan') {
    if (!body.planId) throw badRequest('planId is required');
    const sub = await setPlan(user.id, body.planId);
    await audit({ userId: user.id, action: 'billing.plan', entity: 'subscription', entityId: sub.id, ip, meta: { planId: body.planId } });
    return { subscription: sub, plan: planById(sub.planId) };
  }
  if (body.action === 'cancel') {
    const sub = await cancelPlan(user.id);
    await audit({ userId: user.id, action: 'billing.cancel', entity: 'subscription', entityId: sub.id, ip });
    return { subscription: sub };
  }
  const db = await getDb();
  const sub = await getSubscription(user.id);
  const updated = await db.repo('subscriptions').update(sub.id, { cancelAtPeriodEnd: false, status: 'active' } as never);
  return { subscription: updated };
}, { strict: true });
