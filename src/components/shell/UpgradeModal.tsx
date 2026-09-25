'use client';
import * as React from 'react';
import { Check, Sparkles, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import { Modal } from '@/components/ui/overlays';
import { cx, Button, Badge } from '@/components/ui/primitives';
import { useApp, useBoot, usePlans } from '@/store/app';
import { post, describeError } from '@/lib/client/api';
import type { Plan, Subscription } from '@/types';

/** Plans and prices come from the backend so they can change without a deploy. */
export function UpgradeModal() {
  const open = useApp(s => s.ui.upgrade);
  const setUi = useApp(s => s.setUi);
  const plans = usePlans();
  const boot = useBoot();
  const sub = boot?.subscription;
  const toast = useApp(s => s.toast);
  const reload = useApp(s => s.reload);
  const [yearly, setYearly] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<'plans' | 'compare' | 'credits'>('plans');

  const choose = async (plan: Plan) => {
    setBusy(plan.id);
    try {
      await post('/api/billing', { action: 'change-plan', planId: plan.id });
      await reload('subscription');
      toast({ level: 'success', title: `Switched to ${plan.name}`, body: plan.creditsMonthly ? `${plan.creditsMonthly.toLocaleString()} credits added to your balance.` : 'Free plan active.' });
      setUi('upgrade', false);
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(null); }
  };

  const buyCredits = async (amount: number) => {
    setBusy(`credits-${amount}`);
    try {
      const r = await post<{ credits: number; note?: string; gateway?: string }>('/api/credits/purchase', { credits: amount });
      await reload('subscription');
      toast({ level: 'success', title: `${amount.toLocaleString()} credits added`, body: r.note });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(null); }
  };

  const price = (p: Plan) => p.priceMonthly < 0 ? 'Custom' : yearly ? Math.round(p.priceYearly / 12) : p.priceMonthly;

  return (
    <Modal open={open} onClose={() => setUi('upgrade', false)} width={860} icon={<Sparkles size={14} />}
      title="Upgrade AI Film Studio"
      sub={<>Current plan <Badge tone="accent" className="ml-1 align-middle">{sub?.planId ?? 'free'}</Badge> · <span className="tnum">{Math.round(sub?.credits ?? 0).toLocaleString()}</span> credits remaining. Pricing is served from the backend and can be changed without a deploy.</>}>
      <div className="mb-4 flex items-center gap-2">
        {(['plans', 'compare', 'credits'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cx('rounded-md px-2.5 py-1 text-[11.5px] font-medium capitalize transition-colors',
              tab === t ? 'bg-accent/12 text-accent-bright' : 'text-ink3 hover:bg-white/[0.04] hover:text-ink2')}>{t === 'credits' ? 'Buy credits' : t}</button>
        ))}
        <div className="flex-1" />
        {tab === 'plans' && (
          <div className="flex items-center gap-1.5 rounded-md border border-line bg-well p-0.5">
            {([['Monthly', false], ['Yearly −17%', true]] as const).map(([l, v]) => (
              <button key={l} type="button" onClick={() => setYearly(v)}
                className={cx('rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors', yearly === v ? 'bg-accent/15 text-accent-bright' : 'text-ink3 hover:text-ink2')}>{l}</button>
            ))}
          </div>
        )}
      </div>

      {tab === 'plans' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {plans.filter(p => p.id !== 'enterprise').map(p => {
            const current = sub?.planId === p.id;
            return (
              <motion.div key={p.id} whileHover={{ y: -2 }} className={cx('card relative flex flex-col p-4', p.highlight && 'shadow-glow border-accent/35')}>
                {p.highlight && <span className="absolute -top-2 left-4 rounded bg-gloss-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-on shadow">Most popular</span>}
                <div className="flex items-baseline justify-between">
                  <h3 className="text-[14px] font-semibold text-ink">{p.name}</h3>
                  {current && <Badge tone="ok">current</Badge>}
                </div>
                <p className="mt-2 flex items-baseline gap-1">
                  <span className="text-[26px] font-semibold tracking-tight text-ink tnum">{p.priceMonthly < 0 ? 'Talk to us' : `$${price(p)}`}</span>
                  {p.priceMonthly >= 0 && <span className="text-[11px] text-ink3">/{yearly ? 'mo billed yearly' : 'month'}</span>}
                </p>
                <p className="mt-1 text-[11px] text-accent-bright tnum">{p.creditsMonthly.toLocaleString()} credits / month</p>
                <ul className="mt-3 flex-1 space-y-1.5">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px] leading-snug text-ink2">
                      <Check size={11} className="mt-[3px] shrink-0 text-ok" />{f}
                    </li>
                  ))}
                </ul>
                <Button className="mt-4 w-full" variant={p.highlight ? 'primary' : 'default'} loading={busy === p.id} disabled={current}
                  onClick={() => choose(p)}>
                  {current ? 'Current plan' : p.priceMonthly === 0 ? 'Downgrade to Free' : `Choose ${p.name}`}
                </Button>
              </motion.div>
            );
          })}
        </div>
      )}

      {tab === 'compare' && (
        <div className="overflow-x-auto rounded-lg border border-line-soft">
          <table className="w-full min-w-[640px] border-collapse text-[11.5px]">
            <thead>
              <tr className="border-b border-line-soft bg-well2">
                <th className="px-3 py-2 text-left font-semibold text-ink2">Capability</th>
                {plans.map(p => <th key={p.id} className={cx('px-3 py-2 text-left font-semibold', p.highlight ? 'text-accent-bright' : 'text-ink2')}>{p.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {([
                ['Monthly credits', (p: Plan) => p.creditsMonthly.toLocaleString()],
                ['Seats', (p: Plan) => String(p.seats)],
                ['Concurrent generations', (p: Plan) => String(p.concurrentJobs)],
                ['Max export resolution', (p: Plan) => p.maxResolution.toUpperCase()],
                ['Watermark on export', (p: Plan) => p.watermark ? 'Yes' : 'No'],
                ['Queue priority', (p: Plan) => ['Standard', 'Normal', 'High', 'Dedicated', 'Dedicated + SLA'][p.priority] ?? 'Standard'],
                ['Automation engine', (p: Plan) => p.priority >= 2 ? 'Full, with review gates' : p.priority >= 1 ? 'Basic' : '—'],
                ['Bring your own API keys', (p: Plan) => p.priority >= 2 ? 'Yes' : p.priority >= 1 ? 'Yes' : 'Yes'],
                ['Self-hosted / VPC', (p: Plan) => p.id === 'enterprise' ? 'Yes' : '—']
              ] as [string, (p: Plan) => string][]).map(([label, fn], i) => (
                <tr key={label} className={cx('border-b border-line-soft/60 last:border-0', i % 2 === 1 && 'bg-white/[0.012]')}>
                  <td className="px-3 py-2 text-ink3">{label}</td>
                  {plans.map(p => <td key={p.id} className="px-3 py-2 text-ink2">{fn(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'credits' && (
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-ink2">
            Credits are consumed by image, video, voice, music and upscaling generations. They are reserved when a job
            starts and refunded automatically if the provider fails. The built-in Studio Engine costs nothing.
          </p>
          <div className="grid gap-2.5 sm:grid-cols-4">
            {[500, 1500, 5000, 20000].map(amount => (
              <div key={amount} className="card p-3.5">
                <p className="text-[19px] font-semibold text-ink tnum">{amount.toLocaleString()}</p>
                <p className="text-[10.5px] text-ink3">credits</p>
                <p className="mt-2 text-[12px] font-medium text-accent-bright tnum">${(amount / 100).toFixed(amount % 100 ? 2 : 0)}</p>
                <Button size="sm" className="mt-3 w-full" loading={busy === `credits-${amount}`} onClick={() => buyCredits(amount)}>
                  <Zap size={11} />Add
                </Button>
              </div>
            ))}
          </div>
          <div className="rounded-md border border-line-soft bg-well p-3 text-[11px] leading-relaxed text-ink3">
            <p className="mb-1 font-semibold text-ink2">Payment provider</p>
            This instance uses the built-in <code className="mono text-ink2">internal</code> test gateway, which grants
            credits without charging. To take real payments, implement an adapter in
            <code className="mono mx-1 text-ink2">src/app/api/credits/purchase</code> and grant credits from its
            webhook — the rest of the billing surface (plans, invoices, ledger) already works against it.
          </div>
        </div>
      )}
    </Modal>
  );
}
