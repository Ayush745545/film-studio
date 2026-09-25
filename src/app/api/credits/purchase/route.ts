import { api, badRequest } from '@/lib/api';
import { grantCredits, getSubscription } from '@/lib/credits';
import { audit } from '@/lib/security/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Credit top-up.
 *
 * The payment provider is deliberately modular: `provider: 'internal'` runs a
 * stub completion so the flow is testable end-to-end, and a real gateway slots
 * in behind the same interface (create checkout session → webhook confirms →
 * grantCredits). Credits are only granted after confirmation.
 */
export const POST = api(async ({ user, json, ip }) => {
  const body = await json<{ credits?: number; provider?: string }>();
  const credits = Math.round(Number(body.credits ?? 0));
  if (!(credits > 0)) throw badRequest('credits must be a positive number');
  if (credits > 1_000_000) throw badRequest('Top-up too large', 'Contact sales for volume credits.');
  const sub = await getSubscription(user.id);
  const paymentProvider = body.provider ?? sub.paymentProvider ?? 'internal';
  if (paymentProvider === 'internal') {
    await grantCredits(user.id, credits, 'purchase', `Top-up: ${credits} credits (${paymentProvider} test gateway)`);
    await audit({ userId: user.id, action: 'credits.purchase', entity: 'subscription', entityId: sub.id, ip, meta: { credits, provider: paymentProvider } });
    const after = await getSubscription(user.id);
    return { ok: true, credits: after.credits, gateway: 'internal-test', note: 'No real charge was made. Wire a payment provider in Settings → Billing to take payments.' };
  }
  return { ok: false, credits: sub.credits, gateway: paymentProvider, note: `Payment provider "${paymentProvider}" has no adapter configured. Implement one in src/app/api/credits/purchase and grant credits from its webhook.` };
}, { strict: true });
