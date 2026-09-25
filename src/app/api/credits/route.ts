import { api } from '@/lib/api';
import { getSubscription, creditHistory, usageSummary } from '@/lib/credits';
import { PLANS, planById } from '@/lib/pricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const sub = await getSubscription(user.id);
  const history = await creditHistory(user.id, Number(query().get('take') ?? 40));
  return { subscription: sub, plan: planById(sub.planId), plans: PLANS, history, usage: await usageSummary(user.id) };
});
