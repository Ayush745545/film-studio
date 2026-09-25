'use client';
import * as React from 'react';
import { Sparkles, Loader2, Zap, AlertTriangle, ChevronDown, Info } from 'lucide-react';
import { cx, Button, Badge, Tip, PrevisBadge } from '@/components/ui/primitives';
import { Dropdown } from '@/components/ui/inputs';
import { ConfirmDialog, type ConfirmSpec } from '@/components/ui/overlays';
import { useApp, useBoot } from '@/store/app';
import { useProject } from '@/store/project';
import { post, describeError } from '@/lib/client/api';
import type { ModelDescriptor } from '@/types';

export interface GenerateConfig {
  action: string;
  label: string;
  params?: Record<string, unknown>;
  kind?: 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'text' | 'upscale';
}

/**
 * The generation control bar shared by every stage.
 *
 * It answers the four questions a user has before spending credits: which model
 * will run, what will it produce, what does it cost, and can I undo it. The
 * estimate comes from the server (the same router that will execute the job),
 * and anything above the free/demo threshold requires an explicit confirm.
 */
export function GenerateBar({ config, modelKind, children, variant = 'primary', size = 'md', disabled, confirmThreshold = 0.01, onDone, label }: {
  config: GenerateConfig; modelKind?: 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'text' | 'upscale';
  children?: React.ReactNode; variant?: 'primary' | 'default' | 'ghost'; size?: 'xs' | 'sm' | 'md';
  disabled?: boolean; confirmThreshold?: number; onDone?: (res: unknown) => void; label?: string;
}) {
  const project = useProject(s => s.project);
  const generate = useProject(s => s.generate);
  const toast = useApp(s => s.toast);
  const setUi = useApp(s => s.setUi);
  const boot = useBoot();
  const credits = useApp(s => s.credits);
  const [busy, setBusy] = React.useState(false);
  const [est, setEst] = React.useState<Record<string, any> | null>(null);
  const [confirmSpec, setConfirmSpec] = React.useState<ConfirmSpec | null>(null);
  const [modelId, setModelId] = React.useState<string>('');
  const [presetId, setPresetId] = React.useState<string>('');

  const providerById = React.useMemo(
    () => new Map((boot?.providers ?? []).map(provider => [provider.id, provider])),
    [boot?.providers]
  );
  const models = React.useMemo(
    () => (boot?.models ?? []).filter(model => {
      const provider = providerById.get(model.providerId);
      const connected = Boolean(provider?.enabled && (provider.credentialStatus === 'connected' || provider.credentialStatus === 'env'));
      return model.enabled && connected && (!modelKind || model.kind === modelKind || model.capabilities.includes(modelKind as never));
    }),
    [boot?.models, providerById, modelKind]
  );

  React.useEffect(() => {
    if (modelId && !models.some(model => model.id === modelId)) setModelId('');
  }, [modelId, models]);

  // keep preset in sync with the project
  React.useEffect(() => { setPresetId(project?.settings.presetId ?? ''); }, [project?.settings.presetId]);

  const doEstimate = React.useCallback(async () => {
    if (!project || disabled) return;
    try {
      const res = await post<Record<string, any>>(`/api/projects/${project.id}/estimate`, {
        action: config.action, params: config.params ?? {}, modelId: modelId || null, presetId: presetId || null
      });
      setEst(res);
    } catch { setEst(null); }
  }, [project, config.action, JSON.stringify(config.params ?? {}), modelId, presetId, disabled]);

  React.useEffect(() => {
    if (!project) return;
    const t = setTimeout(doEstimate, 260);
    return () => clearTimeout(t);
  }, [doEstimate, project?.id]);

  const run = async () => {
    if (!project) { toast({ level: 'warn', title: 'No project loaded' }); return; }
    setBusy(true);
    try {
      const res = await generate(config.action, config.params ?? {}, { modelId: modelId || null, presetId: presetId || null });
      const n = (res as { jobs?: unknown[] }).jobs?.length ?? 0;
      toast({
        level: 'success',
        title: n > 1 ? `${n} jobs queued` : `${config.label} queued`,
        body: est?.demo ? 'Built-in Studio Engine — previsualisation media, 0 credits.' : est?.credits ? `≈${est.credits} credits reserved.` : undefined,
        action: { label: 'Open queue', run: () => setUi('queue', true) }
      });
      setUi('queue', true);
      onDone?.(res);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body, ttl: 12000 });
    } finally { setBusy(false); setConfirmSpec(null); }
  };

  const start = () => {
    const cost = Number(est?.credits ?? 0);
    if (cost > confirmThreshold || (est && est.units > 1)) {
      setConfirmSpec({
        title: `Generate ${config.label.toLowerCase()}?`,
        confirmLabel: cost > 0 ? `Generate · ${cost} credits` : 'Generate',
        body: cost > credits
          ? <span className="text-bad">You have {Math.round(credits)} credits — this needs {cost}. Top up or choose a cheaper model.</span>
          : <>Credits are reserved when the job starts and refunded automatically if the provider fails.</>,
        credits: cost,
        details: [
          ...(modelId && boot?.models.find(model => model.id === modelId)?.name !== est?.model
            ? [{ label: 'You selected', value: boot?.models.find(model => model.id === modelId)?.name ?? modelId }]
            : []),
          { label: 'Resolved model', value: est?.model ?? 'router decides' },
          { label: 'Provider', value: <span className="flex items-center gap-1.5">{est?.provider ?? '—'}{est?.demo && <PrevisBadge />}</span> },
          { label: 'API key', value: est?.credentialSource === 'user' ? 'Your encrypted key' : est?.credentialSource === 'env' ? 'Platform key' : 'No key required' },
          { label: 'Route', value: est?.strategy ?? '—' },
          { label: 'Route reason', value: est?.reason ?? '—' },
          { label: 'Fallbacks', value: est?.fallbacks?.length ? est.fallbacks.map((fallback: { model: string; provider: string }) => `${fallback.model} (${fallback.provider})`).join(' → ') : 'None' },
          ...(est?.images ? [{ label: 'Images', value: String(est.images) }] : []),
          ...(est?.videos ? [{ label: 'Videos', value: String(est.videos) }] : []),
          ...(est?.audio ? [{ label: 'Audio clips', value: String(est.audio) }] : []),
          ...(est?.units ? [{ label: 'Units', value: String(est.units) }] : []),
          ...(est?.estSeconds ? [{ label: 'Estimated time', value: humanTime(est.estSeconds) }] : []),
          { label: 'Your balance', value: `${Math.round(credits).toLocaleString()} credits` }
        ]
      });
      return;
    }
    void run();
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {children}
      {models.length > 1 && (
        <Dropdown value={modelId} onChange={setModelId} placeholder="Model: router decides" width={300}
          className="w-[210px]"
          items={models.map(m => ({
            value: m.id, label: m.name,
            sub: `${providerName(boot?.providers ?? [], m.providerId)} · ${m.costPerUnit} cr/${m.unit}`,
            badge: m.demo ? <PrevisBadge /> : m.isDefault ? <Badge tone="accent">default</Badge> : undefined,
            group: m.demo ? 'Built-in engine' : providerName(boot?.providers ?? [], m.providerId)
          }))} />
      )}
      <div className="flex items-center gap-1.5">
        {est && (
          <Tip label={<div className="max-w-64 space-y-1"><p>{est.breakdown || 'Router estimate'}</p><p>Route: {est.model} via {est.provider} · {est.strategy}</p><p>{est.reason}</p><p>Fallbacks: {est.fallbacks?.length ? est.fallbacks.map((fallback: { model: string; provider: string }) => `${fallback.model} (${fallback.provider})`).join(' → ') : 'none'}</p></div>}>
            <span className={cx('flex h-[28px] items-center gap-1.5 rounded-md border px-2 text-[11px] tnum',
              est.credits > credits ? 'border-bad/40 bg-bad/[0.08] text-bad' : 'border-line bg-well text-ink2')}>
              <Zap size={11} className={est.credits > 0 ? 'text-accent' : 'text-ok'} />
              {est.credits > 0 ? `${est.credits} cr` : 'free'}
              {est.units > 1 && <span className="text-ink3">· {est.units}×</span>}
              {est.estSeconds > 0 && <span className="hidden text-ink3 sm:inline">· ~{humanTime(est.estSeconds)}</span>}
            </span>
          </Tip>
        )}
        {est?.demo && <PrevisBadge label="PREVIS" />}
        {!est && !disabled && <span className="flex h-[28px] items-center gap-1.5 px-2 text-[11px] text-ink3"><Loader2 size={11} className="animate-spin" />pricing…</span>}
      </div>
      <Button variant={variant} size={size} loading={busy} disabled={disabled || (est ? est.credits > credits && est.credits > 0 : false)}
        onClick={start} icon={busy ? undefined : <Sparkles size={size === 'xs' ? 11 : 13} />}>
        {label ?? config.label}
      </Button>
      {est && est.credits > credits && est.credits > 0 && (
        <Tip label="Not enough credits — top up or pick a cheaper model">
          <span className="text-bad"><AlertTriangle size={14} /></span>
        </Tip>
      )}
      <ConfirmDialog spec={confirmSpec} open={Boolean(confirmSpec)} onCancel={() => setConfirmSpec(null)} onConfirm={() => void run()} />
    </div>
  );
}

export function providerName(providers: { id: string; name: string }[], id: string) {
  return providers.find(p => p.id === id)?.name ?? id;
}
export function humanTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60); const s = Math.round(sec % 60);
  return s ? `${m}m ${s}s` : `${m}m`;
}
export function modelOptions(models: ModelDescriptor[], providers: { id: string; name: string }[]) {
  return models.map(m => ({ value: m.id, label: m.name, sub: providerName(providers, m.providerId), group: providerName(providers, m.providerId) }));
}

export function InlineHint({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink3"><Info size={11} className="mt-[1px] shrink-0" />{children}</p>;
}
export { ChevronDown };
