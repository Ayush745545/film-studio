import { getDb } from './db';
import { uid, nowIso } from './ids';
import { planById } from './pricing';
import { bus } from './events';
import type { PlanId, Subscription } from '@/types';

export class InsufficientCredits extends Error {
  code = 'insufficient_credits';
  constructor(public required: number, public balance: number) {
    super(`This needs ${required} credits but only ${balance} remain.`);
    this.name = 'InsufficientCredits';
  }
}

export async function getSubscription(userId: string): Promise<Subscription> {
  const db = await getDb();
  const subs = db.repo('subscriptions');
  const existing = await subs.findFirst({ where: { userId } });
  if (existing) return existing as unknown as Subscription;
  const plan = planById('free');
  return await subs.create({
    id: uid('sub'), userId, planId: 'free', status: 'active',
    credits: plan.creditsMonthly, creditsLifetime: 0, renewsAt: in30(),
    cancelAtPeriodEnd: false, providerRef: null, startedAt: nowIso()
  } as never) as unknown as Subscription;
}

const in30 = () => new Date(Date.now() + 30 * 864e5).toISOString();

async function setBalance(userId: string, credits: number) {
  const db = await getDb();
  await db.repo('subscriptions').update((await getSubscription(userId)).id, { credits } as never);
  bus.publish({ type: 'credits:update', credits });
}

export async function spendCredits(userId: string, amount: number, ref: { type: string; id: string; description: string }): Promise<{ balance: number }> {
  if (amount <= 0) {
    const sub = await getSubscription(userId);
    return { balance: sub.credits };
  }
  const db = await getDb();
  const sub = await getSubscription(userId);
  if (sub.credits + 1e-9 < amount) throw new InsufficientCredits(amount, sub.credits);
  const balance = Math.max(0, Math.round((sub.credits - amount) * 100) / 100);
  await db.repo('creditTxs').create({
    id: uid('ctx'), userId, amount: -amount, balanceAfter: balance, kind: 'spend',
    refType: ref.type, refId: ref.id, description: ref.description, createdAt: nowIso()
  } as never);
  await setBalance(userId, balance);
  return { balance };
}

export async function refundCredits(userId: string, amount: number, ref: { type: string; id: string; description: string }): Promise<{ balance: number }> {
  if (amount <= 0) return { balance: (await getSubscription(userId)).credits };
  const db = await getDb();
  const sub = await getSubscription(userId);
  const balance = Math.round((sub.credits + amount) * 100) / 100;
  await db.repo('creditTxs').create({
    id: uid('ctx'), userId, amount, balanceAfter: balance, kind: 'refund',
    refType: ref.type, refId: ref.id, description: ref.description, createdAt: nowIso()
  } as never);
  await setBalance(userId, balance);
  return { balance };
}

export async function grantCredits(userId: string, amount: number, kind: 'purchase' | 'grant' | 'plan', description: string): Promise<{ balance: number }> {
  const db = await getDb();
  const sub = await getSubscription(userId);
  const balance = Math.round((sub.credits + amount) * 100) / 100;
  await db.repo('creditTxs').create({
    id: uid('ctx'), userId, amount, balanceAfter: balance, kind,
    refType: 'subscription', refId: sub.id, description, createdAt: nowIso()
  } as never);
  await db.repo('subscriptions').update(sub.id, { credits: balance, creditsLifetime: Math.round(((sub.creditsLifetime ?? 0) + Math.max(0, amount)) * 100) / 100 } as never);
  bus.publish({ type: 'credits:update', credits: balance });
  return { balance };
}

export async function setPlan(userId: string, planId: PlanId, paymentProvider = 'internal', providerRef?: string): Promise<Subscription> {
  const db = await getDb();
  const sub = await getSubscription(userId);
  const plan = planById(planId);
  const credits = planId === 'free' ? sub.credits : Math.round((sub.credits + plan.creditsMonthly) * 100) / 100;
  await db.repo('creditTxs').create({
    id: uid('ctx'), userId, amount: plan.creditsMonthly, balanceAfter: credits, kind: 'plan',
    refType: 'subscription', refId: sub.id, description: `${plan.name} plan — ${plan.creditsMonthly} monthly credits`, createdAt: nowIso()
  } as never);
  const updated = await db.repo('subscriptions').update(sub.id, {
    planId, status: 'active', credits, renewsAt: in30(), cancelAtPeriodEnd: false,
    providerRef: providerRef ?? null, paymentProvider
  } as never);
  bus.publish({ type: 'credits:update', credits });
  return updated as unknown as Subscription;
}

export async function cancelPlan(userId: string): Promise<Subscription> {
  const db = await getDb();
  const sub = await getSubscription(userId);
  return await db.repo('subscriptions').update(sub.id, { cancelAtPeriodEnd: true, status: 'cancelled' } as never) as unknown as Subscription;
}

export async function creditHistory(userId: string, take = 50) {
  const db = await getDb();
  return db.repo('creditTxs').findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take });
}

export async function usageSummary(userId: string) {
  const db = await getDb();
  const txs = await db.repo('creditTxs').findMany({ where: { userId } }) as unknown as { amount: number; kind: string; refType: string; createdAt: string }[];
  const now = Date.now();
  const d30 = txs.filter(t => now - new Date(t.createdAt).getTime() < 30 * 864e5);
  const byKind: Record<string, number> = {};
  for (const t of d30) if (t.amount < 0) byKind[t.refType] = (byKind[t.refType] ?? 0) + -t.amount;
  return {
    spent30d: Math.round(d30.filter(t => t.amount < 0).reduce((a, t) => a - t.amount, 0) * 100) / 100,
    byKind,
    totalTx: txs.length
  };
}
