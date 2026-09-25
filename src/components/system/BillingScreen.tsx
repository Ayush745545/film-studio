'use client';
import * as React from 'react';
import { CreditCard, Receipt, Download, Zap, TrendingUp, AlertTriangle, Check, X } from 'lucide-react';
import { Button, Badge, Card, Stat, cx, EmptyState } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/overlays';
import { useApp } from '@/store/app';
import { get, post, describeError } from '@/lib/client/api';
import type { CreditTx, Plan, PlanId, Subscription } from '@/types';

interface Invoice { id: string; number: string; amount: number; currency: string; status: string; planName: string; periodStart: string; periodEnd: string; issuedAt: string }

export function BillingScreen() {
  const toast = useApp(s => s.toast);
  const reload = useApp(s => s.reload);
  const setUi = useApp(s => s.setUi);
  const { confirm, node } = useConfirm();
  const [data, setData] = React.useState<{ subscription: Subscription; plan: Plan; plans: Plan[]; invoices: Invoice[]; history: CreditTx[]; usage: { spent30d: number; byKind: Record<string, number>; totalTx: number } } | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [yearly, setYearly] = React.useState(false);

  const load = React.useCallback(async () => {
    try { setData(await get('/api/billing')); } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  }, [toast]);
  React.useEffect(() => { void load(); }, [load]);

  const changePlan = async (planId: PlanId) => {
    setBusy(planId);
    try { await post('/api/billing', { action: 'change-plan', planId }); await load(); await reload('subscription'); toast({ level: 'success', title: 'Plan updated' }); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(null); }
  };
  const cancel = async () => {
    const ok = await confirm({ title: 'Cancel plan?', tone: 'danger', confirmLabel: 'Cancel at period end', body: <>Your plan stays active until {data?.subscription.renewsAt ? new Date(data.subscription.renewsAt).toLocaleDateString() : 'the end of the period'}, then reverts to Free. Generated assets and projects are never deleted.</> });
    if (!ok) return;
    try { await post('/api/billing', { action: 'cancel' }); await load(); toast({ level: 'success', title: 'Cancellation scheduled' }); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  const buy = async (amount: number) => {
    setBusy(`c${amount}`);
    try { const r = await post<{ credits: number; note?: string }>('/api/credits/purchase', { credits: amount }); await load(); await reload('subscription'); toast({ level: 'success', title: `${amount.toLocaleString()} credits added`, body: r.note }); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(null); }
  };

  const sub = data?.subscription;
  const price = (p: Plan) => p.priceMonthly < 0 ? 'Custom' : yearly ? Math.round(p.priceYearly / 12) : p.priceMonthly;

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="mx-auto w-full max-w-[1080px] px-6 py-7 lg:px-10">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink"><CreditCard size={18} className="text-accent" />Billing</h1>
            <p className="mt-1 text-[12.5px] text-ink2">Plan, credits, usage ledger and invoices. Pricing is served from the backend.</p>
          </div>
          <Segmented value={yearly ? 'yearly' : 'monthly'} onChange={v => setYearly(v === 'yearly')}
            options={[{ value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly −17%' }]} />
        </header>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Current plan" value={data?.plan.name ?? '—'} tone="accent" sub={sub?.cancelAtPeriodEnd ? 'cancels at period end' : sub?.status ?? ''} />
          <Stat label="Credits remaining" value={Math.round(sub?.credits ?? 0).toLocaleString()} sub={`${sub?.creditsLifetime ?? 0} lifetime granted`} />
          <Stat label="Spent (30 days)" value={data?.usage.spent30d ?? 0} sub={`${data?.usage.totalTx ?? 0} ledger entries`} />
          <Stat label="Renews" value={sub?.renewsAt ? new Date(sub.renewsAt).toLocaleDateString() : '—'} sub={sub?.status === 'active' ? 'active' : sub?.status ?? ''} />
        </div>

        <Card hover={false} className="mb-4 overflow-hidden">
          <div className="border-b border-line-soft px-4 py-2.5"><div className="label">Plans</div></div>
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {(data?.plans ?? []).filter(p => p.id !== 'enterprise').map(p => {
              const current = sub?.planId === p.id;
              return (
                <div key={p.id} className={cx('card flex flex-col p-3.5', p.highlight && 'border-accent/35 shadow-glow')}>
                  <div className="flex items-baseline justify-between">
                    <h3 className="text-[13.5px] font-semibold text-ink">{p.name}</h3>
                    {current && <Badge tone="ok">current</Badge>}
                  </div>
                  <p className="mt-1.5 flex items-baseline gap-1">
                    <span className="text-[24px] font-semibold tracking-tight text-ink tnum">{p.priceMonthly < 0 ? 'Talk to us' : `$${price(p)}`}</span>
                    {p.priceMonthly >= 0 && <span className="text-[10.5px] text-ink3">/{yearly ? 'mo yearly' : 'month'}</span>}
                  </p>
                  <p className="mt-0.5 text-[10.5px] text-accent-bright tnum">{p.creditsMonthly.toLocaleString()} credits / month</p>
                  <ul className="mt-2.5 flex-1 space-y-1">
                    {p.features.slice(0, 6).map(f => <li key={f} className="flex items-start gap-1.5 text-[10.5px] leading-snug text-ink2"><Check size={10} className="mt-[3px] shrink-0 text-ok" />{f}</li>)}
                  </ul>
                  <Button size="sm" className="mt-3 w-full" variant={p.highlight ? 'primary' : 'default'} disabled={current} loading={busy === p.id}
                    onClick={() => void changePlan(p.id)}>{current ? 'Current plan' : p.priceMonthly === 0 ? 'Downgrade' : `Switch to ${p.name}`}</Button>
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-line-soft bg-well2 px-4 py-2.5">
            <Button size="sm" variant="ghost" onClick={() => setUi('upgrade', true)}>Compare all plans</Button>
            {sub && !sub.cancelAtPeriodEnd && sub.planId !== 'free' && <Button size="sm" variant="danger" onClick={() => void cancel()}><X size={12} />Cancel plan</Button>}
            {sub?.cancelAtPeriodEnd && <Button size="sm" onClick={async () => { await post('/api/billing', { action: 'resume' }); await load(); }}><Check size={12} />Resume plan</Button>}
            <span className="ml-auto text-[10.5px] text-ink3">Payment provider is modular — see Settings → Advanced.</span>
          </div>
        </Card>

        <Card hover={false} className="mb-4 overflow-hidden">
          <div className="border-b border-line-soft px-4 py-2.5"><div className="label">Buy credits</div></div>
          <div className="grid gap-2.5 p-4 sm:grid-cols-4">
            {[500, 1500, 5000, 20000].map(a => (
              <div key={a} className="rounded-lg border border-line bg-well p-3">
                <p className="text-[17px] font-semibold text-ink tnum">{a.toLocaleString()}</p>
                <p className="text-[10px] text-ink3">credits · ${(a / 100).toFixed(a % 100 ? 2 : 0)}</p>
                <Button size="xs" variant="primary" className="mt-2 w-full" loading={busy === `c${a}`} onClick={() => void buy(a)}><Zap size={10} />Add</Button>
              </div>
            ))}
          </div>
          <p className="flex items-start gap-1.5 border-t border-line-soft px-4 py-2.5 text-[10.5px] leading-relaxed text-ink3">
            <AlertTriangle size={11} className="mt-[1px] shrink-0 text-accent" />
            This instance uses the built-in <code className="mono text-ink2">internal</code> test gateway, which grants credits
            without charging. Wire a real gateway in <code className="mono text-ink2">src/app/api/credits/purchase</code> and grant
            credits from its webhook — plans, invoices and the ledger already work against it.
          </p>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card hover={false} className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
              <div className="label">Usage by type (30 days)</div>
              <Badge tone="mut" className="ml-auto"><TrendingUp size={9} />{data?.usage.spent30d ?? 0} cr</Badge>
            </div>
            <div className="space-y-1.5 p-4">
              {data?.usage.byKind && Object.keys(data.usage.byKind).length ? Object.entries(data.usage.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 truncate text-[11px] text-ink3">{k}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
                    <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright" style={{ width: `${(v / Math.max(1, data.usage.spent30d)) * 100}%` }} />
                  </span>
                  <span className="w-14 shrink-0 text-right text-[11px] text-ink2 tnum">{v}</span>
                </div>
              )) : <p className="py-3 text-center text-[11.5px] text-ink3">No spend yet — built-in engine generations are free.</p>}
            </div>
          </Card>

          <Card hover={false} className="overflow-hidden">
            <div className="border-b border-line-soft px-4 py-2.5"><div className="label">Invoices</div></div>
            {!data?.invoices?.length ? (
              <div className="p-4"><EmptyState compact icon={<Receipt size={15} />} title="No invoices" body="Invoices appear here once a paid plan or top-up is processed through a real payment provider." /></div>
            ) : (
              <table className="w-full border-collapse text-[11px]">
                <tbody>
                  {data.invoices.map(i => (
                    <tr key={i.id} className="border-b border-line-soft/60 last:border-0">
                      <td className="px-4 py-2 font-mono text-ink3">{i.number}</td>
                      <td className="px-2 py-2 text-ink2">{i.planName}</td>
                      <td className="px-2 py-2 text-ink2 tnum">{i.currency} {i.amount.toFixed(2)}</td>
                      <td className="px-2 py-2"><Badge tone={i.status === 'paid' ? 'ok' : 'mut'}>{i.status}</Badge></td>
                      <td className="px-4 py-2 text-right"><button type="button" className="icon-btn h-6 w-6" aria-label="Download"><Download size={11} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <Card hover={false} className="mt-4 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
            <div className="label">Credit ledger</div>
            <Badge tone="mut" className="ml-auto">{data?.history.length ?? 0} entries</Badge>
          </div>
          {!data?.history?.length ? (
            <p className="px-4 py-6 text-center text-[11.5px] text-ink3">Every credit movement is recorded here with the job or plan that caused it.</p>
          ) : (
            <div className="scroll-thin max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-[11px]">
                <thead className="sticky top-0 bg-well2">
                  <tr className="border-b border-line text-left">{['When', 'Description', 'Kind', 'Amount', 'Balance'].map(h => <th key={h} className="label px-4 py-2 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {data.history.map(t => (
                    <tr key={t.id} className="border-b border-line-soft/50 last:border-0">
                      <td className="whitespace-nowrap px-4 py-1.5 text-ink3">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className="max-w-[320px] truncate px-2 py-1.5 text-ink2">{t.description || t.refType}</td>
                      <td className="px-2 py-1.5"><Badge tone={t.kind === 'spend' ? 'mut' : t.kind === 'refund' ? 'info' : 'ok'}>{t.kind}</Badge></td>
                      <td className={cx('px-2 py-1.5 text-right font-mono tnum', t.amount < 0 ? 'text-bad' : 'text-ok')}>{t.amount > 0 ? '+' : ''}{t.amount}</td>
                      <td className="px-4 py-1.5 text-right font-mono text-ink3 tnum">{Math.round(t.balanceAfter)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card hover={false} className="mt-4 p-4">
          <div className="label mb-2">Payment method</div>
          <p className="text-[11.5px] leading-relaxed text-ink2">
            No card is attached. The billing surface (plans, credit ledger, invoices, cancellation) is fully implemented
            against a <code className="mono text-ink2">paymentProvider</code> field on the subscription, so a gateway can be
            attached without touching the UI: create a checkout session, then grant credits from the webhook.
          </p>
        </Card>
      </div>
      {node}
    </div>
  );
}
