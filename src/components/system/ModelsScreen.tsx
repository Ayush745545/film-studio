'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Boxes, Search, Star, Settings2, Plus, Check, Zap, Coins, KeyRound, AlertTriangle, Plug, Download, RefreshCw, Wifi, Server, Cpu, FolderOpen, FileJson, CheckCircle, ChevronDown, ChevronUp, Save, Brain, Trash2 } from 'lucide-react';
import { Button, Badge, Card, EmptyState, cx, Tip, PrevisBadge, Stat } from '@/components/ui/primitives';
import { Modal } from '@/components/ui/overlays';
import { Field, TextInput, Select, TextArea } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useApp, useBoot } from '@/store/app';
import { post, patch as apiPatch, del, get, describeError } from '@/lib/client/api';
import { detectFormat, inferKind, inferWorkflowConfig, workflowDriverModel, workflowLabel } from '@/lib/ai/comfy';
import type { Capability, ModelDescriptor, Provider } from '@/types';

const CATEGORIES: { id: Capability | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'text', label: 'Text' }, { id: 'image', label: 'Image' }, { id: 'video', label: 'Video' },
  { id: 'voice', label: 'Voice' }, { id: 'music', label: 'Music' }, { id: 'sound', label: 'Sound' },
  { id: 'upscale', label: 'Upscaling' }, { id: 'lipsync', label: 'Lip Sync' }, { id: '3d', label: '3D' },
  { id: 'vision', label: 'Vision' }, { id: 'editing', label: 'Editing' }
];

interface DiscoveredModel {
  id: string;
  name: string;
  capabilities: string[];
  owned_by?: string;
}

function ProviderModelsModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [models, setModels] = React.useState<DiscoveredModel[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [adding, setAdding] = React.useState<Set<string>>(new Set());

  const fetchModels = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<{ models: DiscoveredModel[]; error?: string }>(`/api/providers/${provider.id}/models`);
      setModels(res.models ?? []);
      setError(res.error ?? null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [provider.id]);

  React.useEffect(() => {
    void fetchModels();
  }, [fetchModels]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addModels = async () => {
    if (selected.size === 0) return;
    setAdding(new Set(selected));
    let success = 0;
    for (const id of selected) {
      const model = models.find(m => m.id === id);
      if (!model) continue;
      try {
        await post('/api/models', {
          providerId: provider.id,
          name: model.name,
          driverModel: model.id,
          kind: model.capabilities[0] ?? 'text',
          capabilities: model.capabilities,
          features: ['auto-discovered', provider.driver]
        });
        success++;
      } catch (err) {
        const d = describeError(err);
        toast({ level: 'error', title: `Failed to add ${model.name}`, body: d.body });
      }
    }
    if (success > 0) {
      toast({ level: 'success', title: `Added ${success} model${success > 1 ? 's' : ''}`, body: `Now available in the router immediately.` });
      await reload('models');
      onClose();
    }
    setAdding(new Set());
  };

  const selectAll = () => {
    setSelected(new Set(models.map(m => m.id)));
  };

  const clearSelection = () => {
    setSelected(new Set());
  };

  return (
    <Modal open={true} onClose={onClose} width={720} title={`Discover models: ${provider.name}`} icon={<Download size={14} />}
      sub={`Fetching available models from ${provider.name} (${provider.driver})`}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={loading || adding.size > 0}>Cancel</Button>
        {loading ? <Button variant="primary" disabled><RefreshCw size={12} className="animate-spin" />Loading…</Button> : (
          <>
            <Button variant="ghost" onClick={selectAll} disabled={selected.size === models.length}>Select all</Button>
            <Button variant="ghost" onClick={clearSelection} disabled={selected.size === 0}>Clear</Button>
            <Button variant="primary" onClick={addModels} disabled={selected.size === 0 || adding.size > 0}>
              {adding.size > 0 ? (
                <><RefreshCw size={12} className="animate-spin" />Adding…</>
              ) : (
                <span>+ Add <strong>{selected.size}</strong> model{selected.size > 1 ? 's' : ''}</span>
              )}
            </Button>
          </>
        )}
      </>}>
    {loading ? (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-accent" />
        <span className="ml-3 text-ink2">Querying {provider.name}…</span>
      </div>
    ) : models.length === 0 ? (
      <EmptyState icon={<Server size={17} />} title={error ? 'Connection failed' : 'No models found'}
        body={error ?? (provider.driver === 'comfyui' ? 'ComfyUI does not expose a standard model list. Add models manually using the workflow node names.' : 'The provider is connected but returned no models.')}
        action={<Button variant="ghost" onClick={() => void fetchModels()}>Retry</Button>} />
    ) : (
      <div className="space-y-3 max-h-96 overflow-y-auto">
        <div className="flex items-center gap-2 text-[11px] text-ink3 mb-2">
          <span className="flex-1">Model</span>
          <span className="w-32">Capabilities</span>
          <span className="w-28">Source</span>
        </div>
        {models.map(m => (
          <div key={m.id} className="flex items-center gap-2 rounded-md border border-line-soft bg-well px-3 py-2 transition-colors hover:bg-accent/5">
            <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggleSelect(m.id)} className="shrink-0 w-4 h-4 accent-accent" />
            <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink">{m.name}</span>
            <span className="w-32 shrink-0 flex flex-wrap gap-1">
              {m.capabilities.map(c => <Badge key={c} tone="mut" className="text-[9px]">{c}</Badge>)}
            </span>
            <span className="w-28 shrink-0 truncate text-[10px] text-ink3">{m.owned_by ?? provider.driver}</span>
            {adding.has(m.id) && <RefreshCw size={12} className="animate-spin text-accent" />}
          </div>
        ))}
      </div>
    )}
  </Modal>
);
}
export function ModelsScreen() {
  const boot = useBoot();
  const reload = useApp(state => state.reload);
  const toast = useApp(state => state.toast);
  const { confirm, node } = useConfirm();
  const providers = boot?.providers ?? [];
  const addedModels = (boot?.models ?? []).filter(model => model.custom);
  const [adding, setAdding] = React.useState(false);
  const [configuring, setConfiguring] = React.useState<ModelDescriptor | null>(null);
  const [scanningProviderId, setScanningProviderId] = React.useState('');
  const [scanningProvider, setScanningProvider] = React.useState<Provider | null>(null);

  const connectedProviders = providers.filter(provider => provider.credentialStatus === 'connected' || provider.credentialStatus === 'env');
  const scanProviders = connectedProviders.filter(provider => provider.id !== 'demo' && provider.driver !== 'comfyui');

  React.useEffect(() => {
    if (!scanProviders.some(provider => provider.id === scanningProviderId)) {
      setScanningProviderId(scanProviders[0]?.id ?? '');
    }
  }, [scanProviders, scanningProviderId]);

  const removeModel = async (model: ModelDescriptor) => {
    const confirmed = await confirm({
      title: `Remove ${model.name}?`,
      body: 'This model will no longer be available in generation.',
      confirmLabel: 'Remove model',
      tone: 'danger'
    });
    if (!confirmed) return;
    try {
      await del(`/api/models/${model.id}`);
      await reload('models');
      toast({ level: 'success', title: 'Model removed' });
    } catch (error) {
      const details = describeError(error);
      toast({ level: 'error', title: details.title, body: details.body });
    }
  };

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="mx-auto w-full max-w-[1240px] px-6 py-7 lg:px-10">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink"><Boxes size={18} className="text-accent" />Models</h1>
          <div className="flex items-center gap-2">
            <Select className="w-44" value={scanningProviderId} onChange={setScanningProviderId}
              options={scanProviders.map(provider => ({ value: provider.id, label: provider.name, sub: provider.credentialStatus ?? undefined, group: provider.driver }))}
              placeholder={scanProviders.length ? 'Choose provider' : 'No connected providers'} />
            <Button size="sm" variant="ghost" disabled={!scanningProviderId}
              onClick={() => setScanningProvider(providers.find(provider => provider.id === scanningProviderId) ?? null)}>
              <RefreshCw size={12} />Scan
            </Button>
            <Button size="sm" variant="primary" onClick={() => setAdding(true)}><Plus size={12} />Add model</Button>
          </div>
        </header>

        {addedModels.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-3 text-[13.5px] font-semibold text-ink">Added models</h2>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {addedModels.map(model => {
                const provider = providers.find(item => item.id === model.providerId);
                return (
                  <Card key={model.id} className="p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-semibold text-ink">{model.name}</p>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-ink3">{model.driverModel}</p>
                      </div>
                      <Badge tone="mut">{model.kind}</Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <p className="truncate text-[10.5px] text-ink2">{provider?.name ?? model.providerId}</p>
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="ghost" onClick={() => setConfiguring(model)}><Settings2 size={10} />Configure</Button>
                        <Button size="xs" variant="ghost" onClick={() => void removeModel(model)}><Trash2 size={10} />Remove</Button>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        )}

        <ComfyUISection providers={connectedProviders} ready={new Set(connectedProviders.map(provider => provider.id))} onReload={() => reload('models')} />
      </div>

      <AddModelModal open={adding} onClose={() => setAdding(false)} providers={connectedProviders} />
      <ConfigureModelModal model={configuring} onClose={() => setConfiguring(null)} />
      {scanningProvider && <ProviderModelsModal provider={scanningProvider} onClose={() => setScanningProvider(null)} />}
      {node}
    </div>
  );
}

function ComfyUISection({ providers, ready, onReload }: { providers: Provider[]; ready: Set<string>; onReload: () => void }) {
  const comfyProviders = providers.filter(p => p.driver === 'comfyui');
  if (comfyProviders.length === 0) return null;

  return (
    <section className="mt-10 pt-6 border-t border-line-soft">
      <header className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink"><Brain size={18} className="text-accent" />ComfyUI</h2>
        <Badge tone="mut">Local Workflow Engine</Badge>
        <p className="ml-auto text-[12px] text-ink2 max-w-[50ch]">
          Connect to a running ComfyUI instance to browse checkpoints, LoRAs, VAEs, embeddings, and nodes. Load workflows directly into the router.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {comfyProviders.map(provider => (
          <ComfyUIProviderCard key={provider.id} provider={provider}
            isReady={ready.has(provider.id)} onReload={onReload} />
        ))}
      </div>
    </section>
  );
}

/* Response shapes for GET /api/comfyui/[id]/proxy — see that route for the
   upstream ComfyUI endpoints each one maps to. */
interface Stats { connected: boolean; version?: string; device: string | null; vramTotal: number | null; vramFree: number | null; error?: string }
interface ModelsRes { folders: Record<string, string[]>; modelTypes: string[]; errors: string[] }
interface NodesRes { nodes: { type: string; category: string }[]; total: number }
interface WorkflowsRes { workflows: { path: string; name: string }[] }
interface WorkflowRes { path: string; name: string; json: unknown; format: 'api' | 'ui' | 'unknown' }

const FOLDER_LABELS: Record<string, string> = {
  checkpoints: 'Checkpoints', loras: 'LoRAs', vae: 'VAEs', clip: 'Text encoders',
  embeddings: 'Embeddings', controlnet: 'ControlNets', upscale_models: 'Upscalers'
};

/**
 * One connected ComfyUI instance.
 *
 * Every request goes through the app's own `/api/comfyui/[id]/proxy` route.
 * Talking to ComfyUI from the browser directly does not work — it sends no CORS
 * headers, and a plaintext `http://127.0.0.1` call from an HTTPS page is
 * blocked as mixed content before it is even sent.
 */
function ComfyUIProviderCard({ provider, isReady, onReload }: { provider: Provider; isReady: boolean; onReload: () => void }) {
  const router = useRouter();
  const toast = useApp(s => s.toast);
  const [status, setStatus] = React.useState<'checking' | 'connected' | 'disconnected'>('checking');
  const [info, setInfo] = React.useState<{ version: string; device: string | null } | null>(null);
  const [connectionError, setConnectionError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<'models' | 'nodes' | 'workflows'>('models');

  const [models, setModels] = React.useState<Record<string, string[]>>({});
  const [modelErrors, setModelErrors] = React.useState<string[]>([]);
  const [nodes, setNodes] = React.useState<{ type: string; category: string }[]>([]);
  const [nodeTotal, setNodeTotal] = React.useState(0);
  const [nodeFilter, setNodeFilter] = React.useState('');
  const [workflows, setWorkflows] = React.useState<{ path: string; name: string }[]>([]);
  const [wfFormats, setWfFormats] = React.useState<Record<string, 'api' | 'ui' | 'unknown'>>({});

  // Paste-a-workflow form. Both fields are controlled — previously they were
  // uncontrolled inputs wired to `onClick={() => {}}`, so nothing was reachable.
  const [pasteJson, setPasteJson] = React.useState('');
  const [pasteName, setPasteName] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'load' | 'save'>(null);

  const proxy = React.useCallback(
    (target: string, extra?: Record<string, string>) => {
      const qs = new URLSearchParams({ target, ...extra });
      return `/api/comfyui/${provider.id}/proxy?${qs.toString()}`;
    },
    [provider.id]
  );

  const fetchStats = React.useCallback(async (): Promise<boolean> => {
    setConnectionError(null);
    try {
      const s = await get<Stats>(proxy('stats'));
      if (!s.connected) {
        setStatus('disconnected');
        setInfo(null);
        setConnectionError(s.error ?? `ComfyUI is unavailable at ${provider.baseUrl ?? 'http://127.0.0.1:8188'}`);
        return false;
      }
      setInfo({ version: s.version ?? 'unknown', device: s.device });
      setStatus('connected');
      return true;
    } catch (err) {
      setStatus('disconnected');
      setInfo(null);
      setConnectionError((err as Error).message);
      return false;
    }
  }, [proxy, provider.baseUrl]);

  /** Real model *files*, from `/models/{folder}` — not node class names. */
  const fetchModels = React.useCallback(async () => {
    try {
      const r = await get<ModelsRes>(proxy('models'));
      setModels(r.folders ?? {});
      setModelErrors(r.errors ?? []);
    } catch {
      setModels({});
    }
  }, [proxy]);

  const fetchNodes = React.useCallback(async () => {
    try {
      const r = await get<NodesRes>(proxy('nodes'));
      setNodes(r.nodes ?? []);
      setNodeTotal(r.total ?? (r.nodes?.length ?? 0));
    } catch {
      // /object_info is several MB on installs with many custom nodes; a failure
      // here must not take the other tabs down with it.
      setNodes([]);
      setNodeTotal(0);
    }
  }, [proxy]);

  const fetchWorkflows = React.useCallback(async () => {
    try {
      const r = await get<WorkflowsRes>(proxy('workflows'));
      const list = r.workflows ?? [];
      setWorkflows(list);
      // Format is only knowable from the file contents, which the list endpoint
      // deliberately does not return. Probe the first few so the list can warn
      // about UI-format exports before the user tries to load one.
      setWfFormats({});
      await Promise.all(list.slice(0, 6).map(async wf => {
        try {
          const d = await get<WorkflowRes>(proxy('workflow', { path: wf.path }));
          setWfFormats(prev => ({ ...prev, [wf.path]: d.format }));
        } catch { /* not readable — leave unbadged */ }
      }));
    } catch {
      setWorkflows([]);
    }
  }, [proxy]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    const up = await fetchStats();
    if (up) await Promise.all([fetchModels(), fetchNodes(), fetchWorkflows()]);
    setLoading(false);
  }, [fetchStats, fetchModels, fetchNodes, fetchWorkflows]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  /** Register a workflow in the model registry so the router can pick it. */
  const createWorkflowModel = async (label: string, json: unknown) => {
    const kind = inferKind(json);
    try {
      const model = await post<ModelDescriptor>('/api/models', {
        providerId: provider.id,
        upsert: true,
        name: `ComfyUI · ${label}`.slice(0, 90),
        driverModel: workflowDriverModel(label),
        kind,
        capabilities: kind === 'video' ? ['video'] : ['image'],
        config: { workflowJson: json, ...inferWorkflowConfig(json) },
        features: ['comfyui', 'workflow', 'auto-mapped']
      });
      await apiPatch(`/api/models/${model.id}`, { setDefault: true });
      await onReload();
      toast({
        level: 'success', title: 'Workflow connected and ready',
        body: `${model.name} is now the default ${kind} model with detected node mappings.`,
        action: { label: 'Generate', run: () => router.push(`/generate?kind=${kind}&model=${encodeURIComponent(model.id)}`) }
      });
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    }
  };

  const loadWorkflow = async (wf: { path: string; name: string }) => {
    setBusy('load');
    try {
      const d = await get<WorkflowRes>(proxy('workflow', { path: wf.path }));
      setWfFormats(prev => ({ ...prev, [wf.path]: d.format }));
      if (d.format === 'ui') {
        toast({
          level: 'error', title: 'That is a ComfyUI editor file, not an API workflow',
          body: 'Open it in ComfyUI and re-export with "Save (API Format)". The generator patches node inputs by id, which only the API format exposes.'
        });
        return;
      }
      await createWorkflowModel(workflowLabel(d.path || wf.path), d.json);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    } finally {
      setBusy(null);
    }
  };

  const savePasted = async () => {
    const name = pasteName.trim();
    const text = pasteJson.trim();
    if (!name) { toast({ level: 'error', title: 'Give the workflow a name' }); return; }
    if (!text) { toast({ level: 'error', title: 'Paste the workflow JSON first' }); return; }
    let json: unknown;
    try { json = JSON.parse(text); } catch (err) {
      toast({ level: 'error', title: 'That is not valid JSON', body: (err as Error).message });
      return;
    }
    setBusy('save');
    try {
      const r = await post<{ path: string; format: 'api' | 'ui' | 'unknown' }>(
        proxy('save'), { name, workflow: json }
      );
      toast({ level: 'success', title: 'Saved to ComfyUI', body: `user/default/${r.path}` });
      setPasteJson(''); setPasteName('');
      await fetchWorkflows();
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    } finally {
      setBusy(null);
    }
  };

  const loadPasted = async () => {
    const text = pasteJson.trim();
    if (!text) { toast({ level: 'error', title: 'Paste the workflow JSON first' }); return; }
    let json: unknown;
    try { json = JSON.parse(text); } catch (err) {
      toast({ level: 'error', title: 'That is not valid JSON', body: (err as Error).message });
      return;
    }
    const format = detectFormat(json);
    if (format === 'ui') {
      toast({
        level: 'error', title: 'That is a ComfyUI editor file, not an API workflow',
        body: 'Re-export it with "Save (API Format)" — the flat node-id keyed graph is what the generator can patch.'
      });
      return;
    }
    setBusy('load');
    await createWorkflowModel(pasteName.trim() || 'Pasted workflow', json);
    setBusy(null);
  };

  const folders = Object.entries(models).filter(([, files]) => files.length > 0);
  const fileCount = folders.reduce((n, [, files]) => n + files.length, 0);
  const nf = nodeFilter.trim().toLowerCase();
  const shownNodes = nf ? nodes.filter(n => n.type.toLowerCase().includes(nf) || n.category.toLowerCase().includes(nf)) : nodes;

  const statusLine = status === 'connected'
    ? `Connected${info?.version && info.version !== 'unknown' ? ` · ComfyUI ${info.version}` : ''}${info?.device ? ` · ${info.device}` : ''}`
    : status === 'checking'
      ? 'Checking connection…'
      : 'Cannot reach ComfyUI from the server';

  return (
    <Card hover className="flex h-full flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Cpu size={18} className="shrink-0 text-accent" />
          <div className="min-w-0">
            <p className="truncate font-medium text-ink">{provider.name}</p>
            <p className="truncate mono text-[11px] text-ink3">{provider.baseUrl || 'http://127.0.0.1:8188'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={cx('h-2 w-2 rounded-full',
            status === 'connected' ? 'bg-ok' : status === 'disconnected' ? 'bg-bad' : 'animate-pulse bg-accent')} />
          <Button size="xs" variant="ghost" onClick={() => void refresh()} disabled={loading} title="Re-check connection">
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
          </Button>
        </div>
      </div>

      {status === 'disconnected' && (
        <p className="mt-3 flex items-start gap-1.5 rounded border border-bad/30 bg-bad/8 px-2 py-1.5 text-[10.5px] leading-snug text-ink2">
          <AlertTriangle size={11} className="mt-px shrink-0 text-bad" />
          <span>{connectionError ?? 'The Next.js server cannot reach this URL. ComfyUI must be listening on an address the server can resolve — start it with --listen if it is on another machine.'}</span>
        </p>
      )}

      {expanded && (
        <div className="mt-4 space-y-3">
          <div className="flex gap-1 border-b border-line-soft">
            {(['models', 'nodes', 'workflows'] as const).map(tab => (
              <button key={tab} type="button" onClick={() => setActiveTab(tab)}
                className={cx('-mb-px rounded-t-md border-b-2 px-3 py-1.5 text-[11px] font-medium transition-colors',
                  activeTab === tab ? 'border-accent text-accent' : 'border-transparent text-ink3 hover:text-ink')}>
                {tab === 'models' ? 'Model files' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'models' && fileCount > 0 && <span className="ml-1.5 opacity-60">{fileCount}</span>}
                {tab === 'nodes' && nodeTotal > 0 && <span className="ml-1.5 opacity-60">{nodeTotal}</span>}
                {tab === 'workflows' && workflows.length > 0 && <span className="ml-1.5 opacity-60">{workflows.length}</span>}
              </button>
            ))}
          </div>

          {activeTab === 'models' && (
            <div className="scroll-thin max-h-[400px] space-y-3 overflow-y-auto pr-1">
              {!folders.length && (
                <EmptyState icon={<FolderOpen size={17} />} title="No model files found"
                  body={modelErrors.length
                    ? modelErrors.join(' · ')
                    : 'ComfyUI reported no files in its checkpoints, loras, vae, clip, embeddings, controlnet or upscale_models folders.'} />
              )}
              {folders.map(([folder, files]) => (
                <div key={folder} className="space-y-1">
                  <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink3">
                    {FOLDER_LABELS[folder] ?? folder}
                    <span className="mono opacity-60">{files.length}</span>
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {files.slice(0, 24).map(f => (
                      <span key={f} title={f} className="mono max-w-[220px] truncate rounded border border-line-soft bg-well px-2 py-0.5 text-[10px] text-ink2">{f}</span>
                    ))}
                    {files.length > 24 && <span className="px-1 text-[10px] text-ink3">+{files.length - 24} more</span>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'nodes' && (
            <div className="space-y-2">
              <TextInput value={nodeFilter} onChange={e => setNodeFilter(e.target.value)}
                placeholder="Filter node classes…" className="h-[30px] text-[11.5px]" />
              <div className="scroll-thin max-h-[360px] overflow-y-auto pr-1">
                {!shownNodes.length ? (
                  <EmptyState icon={<Server size={17} />} title={nodeTotal ? 'No nodes match that filter' : 'No node list'}
                    body={nodeTotal ? 'Try a shorter or different search.' : 'ComfyUI did not return its node registry.'} />
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {shownNodes.slice(0, 300).map(n => (
                      <span key={n.type} title={`${n.type} — ${n.category}`}
                        className="mono max-w-[220px] truncate rounded border border-line-soft bg-well px-2 py-0.5 text-[10px] text-ink2">{n.type}</span>
                    ))}
                    {shownNodes.length > 300 && <span className="px-1 text-[10px] text-ink3">+{shownNodes.length - 300} more</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'workflows' && (
            <div className="space-y-3">
              <div className="scroll-thin max-h-[220px] space-y-1.5 overflow-y-auto pr-1">
                {!workflows.length ? (
                  <div className="py-6 text-center text-ink3">
                    <FileJson size={22} className="mx-auto mb-2 opacity-50" />
                    <p className="text-[11px]">No workflows saved in ComfyUI yet</p>
                    <p className="mt-0.5 text-[10px]">Save one in the ComfyUI editor, or paste JSON below.</p>
                  </div>
                ) : workflows.map(wf => {
                  const format = wfFormats[wf.path];
                  return (
                    <div key={wf.path} className="flex items-center justify-between gap-2 rounded border border-line-soft bg-well p-2">
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-ink" title={wf.path}>{workflowLabel(wf.path)}</p>
                        {format && (
                          <p className={cx('mt-0.5 flex items-center gap-1 text-[9.5px]', format === 'api' ? 'text-ok' : 'text-warn')}>
                            {format === 'api' ? <CheckCircle size={9} /> : <AlertTriangle size={9} />}
                            {format === 'api' ? 'API format — ready to run' : format === 'ui' ? 'Editor format — needs re-export' : 'Unrecognised format'}
                          </p>
                        )}
                      </div>
                      <Button size="xs" variant="ghost" onClick={() => void loadWorkflow(wf)} disabled={busy !== null}>
                        <Download size={10} />Load
                      </Button>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 border-t border-line-soft pt-3">
                <p className="label">Paste a workflow (ComfyUI → Save (API Format))</p>
                <TextArea rows={5} value={pasteJson} onChange={e => setPasteJson(e.target.value)}
                  placeholder='{"3": {"class_type": "KSampler", "inputs": {"seed": "{{seed}}", "steps": "{{steps}}"}}}'
                  className="mono text-[10px]" />
                <div className="flex flex-wrap gap-2">
                  <TextInput value={pasteName} onChange={e => setPasteName(e.target.value)}
                    placeholder="Workflow name" className="h-[30px] min-w-[140px] flex-1 text-[11.5px]" />
                  <Button size="sm" variant="ghost" onClick={() => void savePasted()} disabled={busy !== null}>
                    {busy === 'save' ? <RefreshCw size={11} className="animate-spin" /> : <Save size={11} />}Save to ComfyUI
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => void loadPasted()} disabled={busy !== null}>
                    <Download size={11} />Load to app
                  </Button>
                </div>
                <p className="text-[10px] leading-snug text-ink3">
                  “Save to ComfyUI” writes the file into ComfyUI’s own <code className="mono">user/default/workflows</code> folder.
                  “Load to app” registers it in the model registry so the router can select it — the workflow JSON is stored in the
                  model’s config and patched per generation.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        <span className={cx('truncate text-[11px]', status === 'disconnected' ? 'text-bad' : 'text-ink3')}>
          {statusLine}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {!isReady && <Badge tone="bad">needs key</Badge>}
          <Button size="sm" variant="ghost" onClick={() => setExpanded(v => !v)}>
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? 'Hide' : 'Browse'}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function ModelCard({ m, providerName, isReady, onDefault, onToggle, onDelete, onConfigure }: {
  m: ModelDescriptor; providerName: string; isReady: boolean;
  onDefault: () => void; onToggle: () => void; onDelete: () => void; onConfigure: () => void;
}) {
  return (
    <Card hover className={cx('flex flex-col p-3.5', m.isDefault && 'border-accent/40 shadow-glow', !m.enabled && 'opacity-55')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[12.5px] font-semibold text-ink">{m.name}</h3>
          <p className="truncate font-mono text-[10px] text-ink3">{m.driverModel}</p>
        </div>
        {m.isDefault && <Tip label={`Default for ${m.kind}`}><Star size={13} className="shrink-0 fill-accent text-accent" /></Tip>}
        {m.demo && <PrevisBadge />}
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        <Badge tone="accent">{m.kind}</Badge>
        {m.capabilities.filter(c => c !== m.kind).map(c => <Badge key={c} tone="mut">{c}</Badge>)}
        {m.custom && <Badge tone="info">custom</Badge>}
      </div>

      <dl className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
        <Metric icon={<Star size={9} />} label="Quality" value={m.quality} />
        <Metric icon={<Zap size={9} />} label="Speed" value={m.speed} />
        <Metric icon={<Coins size={9} />} label="Cost" value={m.costPerUnit} suffix={`/ ${m.unit}`} numeric />
      </dl>

      {m.features.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {m.features.slice(0, 5).map(f => <span key={f} className="rounded border border-line-soft bg-well px-1.5 py-px text-[9px] text-ink3">{f}</span>)}
        </div>
      )}

      <div className="mt-2 space-y-0.5 text-[10px] text-ink3">
        {m.supportedRatios?.length > 0 && <p>Ratios: {m.supportedRatios.join(', ')}</p>}
        {m.supportedResolutions?.length > 0 && <p>Up to {m.supportedResolutions[m.supportedResolutions.length - 1]?.toUpperCase()}</p>}
        {m.maxDurationSec ? <p>Max clip {m.maxDurationSec}s</p> : null}
        {m.contextWindow ? <p>{(m.contextWindow / 1000).toFixed(0)}k context</p> : null}
        {typeof m.config?.checkpoint === 'string' && m.config.checkpoint ? <p className="truncate">Checkpoint: {m.config.checkpoint}</p> : null}
        {typeof m.config?.lora === 'string' && m.config.lora ? <p className="truncate">LoRA: {m.config.lora}</p> : null}
      </div>

      {!isReady && !m.demo && (
        <p className="mt-2 flex items-start gap-1.5 rounded border border-bad/25 bg-bad/[0.06] px-2 py-1.5 text-[10px] leading-snug text-bad">
          <AlertTriangle size={10} className="mt-[1px] shrink-0" />{providerName} has no usable key — the router will fall back.
        </p>
      )}

      <div className="mt-auto flex items-center gap-1 pt-3">
        <Button size="xs" variant={m.isDefault ? 'default' : 'ghost'} onClick={onDefault} disabled={m.isDefault}>
          {m.isDefault ? <><Check size={10} />Default</> : <><Star size={10} />Use</>}
        </Button>
        <Button size="xs" variant="ghost" onClick={onConfigure}><Settings2 size={10} />Configure</Button>
        <div className="flex-1" />
        <Tip label={m.enabled ? 'Disable model' : 'Enable model'}>
          <button type="button" className="icon-btn h-6 w-6" data-on={m.enabled} onClick={onToggle} aria-label="Toggle model">
            <span className={cx('h-2 w-2 rounded-full', m.enabled ? 'bg-ok' : 'bg-white/20')} />
          </button>
        </Tip>
        {m.custom && <Tip label="Delete"><button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={onDelete}><Plus size={11} className="rotate-45" /></button></Tip>}
      </div>
    </Card>
  );
}

function Metric({ icon, label, value, suffix, numeric }: { icon: React.ReactNode; label: string; value: number; suffix?: string; numeric?: boolean }) {
  return (
    <div className="rounded border border-line-soft bg-well px-1 py-1.5">
      <span className="flex items-center justify-center gap-0.5 text-[9px] text-ink3">{icon}{label}</span>
      {numeric
        ? <span className="mt-0.5 block text-[11px] font-semibold text-ink tnum">{value}<span className="ml-0.5 text-[8px] font-normal text-ink3">{suffix}</span></span>
        : <span className="mt-1 flex items-center justify-center gap-[2px]">{[1, 2, 3, 4, 5].map(i => <span key={i} className={cx('h-1 w-1.5 rounded-sm', i <= value ? 'bg-accent' : 'bg-white/10')} />)}</span>}
    </div>
  );
}

function AddModelModal({ open, onClose, providers }: { open: boolean; onClose: () => void; providers: Provider[] }) {
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [f, setF] = React.useState({ providerId: '', name: '', driverModel: '', kind: 'text', capabilities: 'text', quality: 3, speed: 3, costPerUnit: 0, unit: 'request', features: '' });
  const submit = async () => {
    try {
      await post('/api/models', {
        providerId: f.providerId, name: f.name, driverModel: f.driverModel, kind: f.kind,
        capabilities: f.capabilities.split(',').map(s => s.trim()).filter(Boolean),
        quality: f.quality, speed: f.speed, costPerUnit: f.costPerUnit, unit: f.unit,
        features: f.features.split(',').map(s => s.trim()).filter(Boolean)
      });
      await reload('models');
      toast({ level: 'success', title: 'Model added', body: 'It is available to the router immediately — no restart needed.' });
      onClose();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  return (
    <Modal open={open} onClose={onClose} width={560} title="Add custom model" icon={<Plus size={14} />}
      sub="Register any model behind a provider driver. The router treats it exactly like a built-in one."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!f.providerId || !f.name || !f.driverModel}>Add model</Button></>}>
      <div className="space-y-3">
        <Field label="Provider" required>
          <Select value={f.providerId} onChange={v => setF({ ...f, providerId: v })} placeholder="Choose a provider"
            options={providers.map(p => ({ value: p.id, label: `${p.name} (${p.driver})`, group: p.builtIn ? 'Built-in' : 'Custom' }))} />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name" required><TextInput value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="My fine-tune" /></Field>
          <Field label="Driver model id" required hint="Exactly what the provider's API expects.">
            <TextInput value={f.driverModel} onChange={e => setF({ ...f, driverModel: e.target.value })} placeholder="owner/model-name" className="mono" />
          </Field>
          <Field label="Kind"><Select value={f.kind} onChange={v => setF({ ...f, kind: v })} options={['text', 'image', 'video', 'voice', 'music', 'sfx', 'upscale', 'lipsync']} /></Field>
          <Field label="Capabilities" hint="Comma separated"><TextInput value={f.capabilities} onChange={e => setF({ ...f, capabilities: e.target.value })} /></Field>
          <Field label="Quality (1–5)"><TextInput type="number" min={1} max={5} value={f.quality} onChange={e => setF({ ...f, quality: Number(e.target.value) })} /></Field>
          <Field label="Speed (1–5)"><TextInput type="number" min={1} max={5} value={f.speed} onChange={e => setF({ ...f, speed: Number(e.target.value) })} /></Field>
          <Field label="Cost per unit (credits)"><TextInput type="number" step={0.1} min={0} value={f.costPerUnit} onChange={e => setF({ ...f, costPerUnit: Number(e.target.value) })} /></Field>
          <Field label="Unit"><TextInput value={f.unit} onChange={e => setF({ ...f, unit: e.target.value })} placeholder="image / second / 1k tokens" /></Field>
        </div>
        <Field label="Features" hint="Comma separated tags shown on the card."><TextInput value={f.features} onChange={e => setF({ ...f, features: e.target.value })} placeholder="img2img, controlnet" /></Field>
      </div>
    </Modal>
  );
}

function ConfigureModelModal({ model, onClose }: { model: ModelDescriptor | null; onClose: () => void }) {
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [cfg, setCfg] = React.useState('{}');
  const [cost, setCost] = React.useState(0);
  React.useEffect(() => { if (model) { setCfg(JSON.stringify(model.config ?? {}, null, 2)); setCost(model.costPerUnit); } }, [model]);
  const save = async () => {
    if (!model) return;
    let parsed: unknown;
    try { parsed = JSON.parse(cfg); } catch { toast({ level: 'error', title: 'Config must be valid JSON' }); return; }
    try {
      await apiPatch(`/api/models/${model.id}`, { config: parsed, costPerUnit: cost });
      await reload('models');
      toast({ level: 'success', title: 'Model configuration saved' });
      onClose();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  return (
    <Modal open={Boolean(model)} onClose={onClose} width={600} title={model ? `Configure ${model.name}` : ''} icon={<Settings2 size={14} />}
      sub="Model config is passed to the provider adapter. For ComfyUI this holds the workflow JSON and node mapping; for custom HTTP it holds the request/response mapping."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      {model && (
        <div className="space-y-3">
          <div className="rounded-md border border-line-soft bg-well p-2.5 text-[11px] text-ink2">
            <p><span className="text-ink3">Driver:</span> <code className="mono">{model.driverModel}</code></p>
            <p className="mt-0.5"><span className="text-ink3">Kind:</span> {model.kind} · <span className="text-ink3">capabilities:</span> {model.capabilities.join(', ')}</p>
          </div>
          <Field label="Cost per unit (credits)" hint="Used by the router's cheapest-first strategy and by pre-flight estimates.">
            <TextInput type="number" step={0.1} min={0} value={cost} onChange={e => setCost(Number(e.target.value))} />
          </Field>
          <Field label="Adapter config (JSON)">
            <TextArea rows={12} value={cfg} onChange={e => setCfg(e.target.value)} className="mono text-[11px]" />
          </Field>
          <div className="rounded-md border border-line-soft bg-well p-2.5">
            <p className="label mb-1">ComfyUI example</p>
            <pre className="mono overflow-x-auto text-[10px] leading-relaxed text-ink3">{`{
  "workflowJson": { "6": { "inputs": { "text": "{{prompt}}" } } },
  "promptNode": "6", "seedNode": "3",
  "widthNode": "5", "heightNode": "5", "stepsNode": "3"
}`}</pre>
            <p className="label mb-1 mt-2">Custom HTTP example</p>
            <pre className="mono overflow-x-auto text-[10px] leading-relaxed text-ink3">{`{
  "method": "POST", "path": "/v1/generate",
  "headers": { "X-Api-Key": "{{apiKey}}" },
  "body": "{\\"prompt\\":\\"{{prompt}}\\",\\"seed\\":{{seed}}}",
  "result": { "imageUrlPath": "artifacts[0].url" }
}`}</pre>
          </div>
        </div>
      )}
    </Modal>
  );
}
