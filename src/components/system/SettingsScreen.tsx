'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Settings2, Palette, KeyRound, Boxes, SlidersHorizontal, Zap, Database, Keyboard, CreditCard,
  Users, ShieldCheck, FlaskConical, Check, Eye, EyeOff, Plus, Trash2, AlertTriangle,
  Plug, Save, RefreshCw, Copy, Gauge, Server, HardDrive, Cpu, Shield, Film, Bot, Terminal
} from 'lucide-react';
import { Button, Badge, Card, cx, Tip, PrevisBadge, Stat, Dot, EmptyState } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Toggle, CopyField } from '@/components/ui/inputs';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { useApp, useBoot } from '@/store/app';
import { get, post, patch as apiPatch, del, describeError } from '@/lib/client/api';
import { SHORTCUTS } from '@/hooks/useHotkeys';
import { useTheme } from '@/hooks/useTheme';
import { DeveloperSection } from './DeveloperSection';
import type { ModelPreset, Provider } from '@/types';

const SECTIONS = [
  { id: 'general', label: 'General', icon: <Settings2 size={13} />, group: 'Workspace' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={13} />, group: 'Workspace' },
  { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: <Keyboard size={13} />, group: 'Workspace' },
  { id: 'providers', label: 'AI Providers', icon: <KeyRound size={13} />, group: 'AI' },
  { id: 'models', label: 'Models', icon: <Boxes size={13} />, group: 'AI' },
  { id: 'presets', label: 'Model Presets', icon: <SlidersHorizontal size={13} />, group: 'AI' },
  { id: 'keys', label: 'Provider Keys', icon: <ShieldCheck size={13} />, group: 'AI' },
  { id: 'developer', label: 'Developer API', icon: <Terminal size={13} />, group: 'AI' },
  { id: 'generation', label: 'Generation', icon: <Zap size={13} />, group: 'AI' },
  { id: 'billing', label: 'Billing', icon: <CreditCard size={13} />, group: 'Account' },
  { id: 'team', label: 'Team', icon: <Users size={13} />, group: 'Account' },
  { id: 'security', label: 'Security', icon: <ShieldCheck size={13} />, group: 'System' },
  { id: 'storage', label: 'Storage', icon: <Database size={13} />, group: 'System' },
  { id: 'advanced', label: 'Advanced', icon: <FlaskConical size={13} />, group: 'System' }
];

export function SettingsScreen({ section }: { section: string }) {
  const current = SECTIONS.find(s => s.id === section) ?? SECTIONS[0];
  const groups = [...new Set(SECTIONS.map(s => s.group))];
  return (
    <div className="flex h-full min-h-0">
      <aside className="scroll-thin hidden w-[218px] shrink-0 overflow-y-auto border-r border-line bg-panel py-3 md:block">
        <div className="px-4 pb-3">
          <h1 className="text-[14px] font-semibold tracking-tight text-ink">Settings</h1>
          <p className="mt-0.5 text-[10.5px] text-ink3">Workspace, AI and system</p>
        </div>
        {groups.map(g => (
          <div key={g} className="mb-2">
            <div className="label px-4 pb-1">{g}</div>
            {SECTIONS.filter(s => s.group === g).map(s => (
              <Link key={s.id} href={`/settings/${s.id}`}
                className={cx('mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[11.5px] transition-colors',
                  s.id === current.id ? 'bg-accent/12 font-medium text-accent-bright' : 'text-ink2 hover:bg-white/[0.04] hover:text-ink')}>
                {s.icon}{s.label}
              </Link>
            ))}
          </div>
        ))}
      </aside>
      <div className="scroll-thin relative min-w-0 flex-1 overflow-y-auto">
        <div className="ambient" />
        <div className="mx-auto w-full max-w-[860px] px-5 py-6 lg:px-8">
          <header className="mb-5">
            <h2 className="flex items-center gap-2 text-[19px] font-semibold tracking-tight text-ink">{current.icon}{current.label}</h2>
          </header>
          {current.id === 'general' && <GeneralSection />}
          {current.id === 'appearance' && <AppearanceSection />}
          {current.id === 'shortcuts' && <ShortcutsSection />}
          {current.id === 'providers' && <ProvidersSection />}
          {current.id === 'models' && <ModelsSection />}
          {current.id === 'presets' && <PresetsSection />}
          {current.id === 'keys' && <KeysSection />}
          {current.id === 'developer' && <DeveloperSection />}
          {current.id === 'generation' && <GenerationSection />}
          {current.id === 'billing' && <BillingSection />}
          {current.id === 'team' && <TeamSection />}
          {current.id === 'security' && <SecuritySection />}
           {current.id === 'storage' && <StorageSection />}
           {current.id === 'advanced' && <AdvancedSection />}
        </div>
      </div>
    </div>
  );
}

function SectionCard({ title, sub, children, right }: { title: string; sub?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card hover={false} className="mb-4 overflow-hidden">
      <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[12.5px] font-semibold text-ink">{title}</h3>
          {sub && <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">{sub}</p>}
        </div>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  );
}

/* ── General ──────────────────────────────────────────────── */
function GeneralSection() {
  const boot = useBoot();
  const toast = useApp(s => s.toast);
  const reload = useApp(s => s.reload);
  const router = useRouter();
  const [name, setName] = React.useState(boot?.user.name ?? '');
  const [prefs, setPrefs] = React.useState<Record<string, unknown>>({});
  React.useEffect(() => { void get<{ preferences: Record<string, unknown> }>('/api/settings').then(r => setPrefs(r.preferences ?? {})); }, []);
  const save = async () => {
    try { await apiPatch('/api/settings', { name, preferences: prefs }); await reload(); toast({ level: 'success', title: 'Settings saved' }); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  return (
    <>
      <SectionCard title="Profile" sub="Your display name appears on versions, exports and audit entries.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Display name"><TextInput value={name} onChange={e => setName(e.target.value)} /></Field>
          <Field label="Email"><TextInput value={boot?.user.email ?? ''} disabled /></Field>
        </div>
        <div className="mt-3 flex gap-2"><Button size="sm" variant="primary" onClick={save}><Save size={12} />Save</Button></div>
      </SectionCard>

      <SectionCard title="Defaults" sub="Applied to new projects. Existing projects keep their own settings.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Default preset">
            <Select value={String(prefs.defaultPreset ?? '')} onChange={v => setPrefs({ ...prefs, defaultPreset: v })} placeholder="Router decides"
              options={(boot?.presets ?? []).map(p => ({ value: p.id, label: p.name }))} />
          </Field>
          <Field label="Default style"><TextInput value={String(prefs.defaultStyle ?? 'Cinematic')} onChange={e => setPrefs({ ...prefs, defaultStyle: e.target.value })} /></Field>
          <Field label="Confirm above (credits)"><TextInput type="number" min={0} value={Number(prefs.confirmAbove ?? 1)} onChange={e => setPrefs({ ...prefs, confirmAbove: Number(e.target.value) })} /></Field>
          <Field label="Autosave interval (s)"><TextInput type="number" min={3} max={120} value={Number(prefs.autosaveSec ?? 15)} onChange={e => setPrefs({ ...prefs, autosaveSec: Number(e.target.value) })} /></Field>
        </div>
        <div className="mt-3 space-y-1.5">
          <Toggle checked={prefs.showPrevisBadges !== false} onChange={v => setPrefs({ ...prefs, showPrevisBadges: v })} label="Always mark previs media" hint="Media rendered by the built-in Studio Engine carries a visible PREVIS mark in the frame and in the UI, so it can never be mistaken for model output. Strongly recommended to leave on." />
          <Toggle checked={prefs.autoOpenQueue === true} onChange={v => setPrefs({ ...prefs, autoOpenQueue: v })} label="Open the queue drawer after generating" />
        </div>
        <div className="mt-3"><Button size="sm" variant="primary" onClick={save}><Save size={12} />Save defaults</Button></div>
      </SectionCard>

      <SectionCard title="Projects" sub={`${boot?.projects.length ?? 0} project(s) in this workspace.`}>
        <Button size="sm" onClick={() => router.push('/projects')}>Manage projects</Button>
      </SectionCard>
    </>
  );
}

/* ── Appearance ───────────────────────────────────────────── */
function AppearanceSection() {
  const { theme, setTheme, themes } = useTheme();
  const [pending, setPending] = React.useState<string | null>(null);
  const apply = async (id: string) => { setPending(id); await setTheme(id); setPending(null); };

  return (
    <>
      <SectionCard title="Theme" sub="Six palettes, all driven by CSS custom properties. Switching is instant — the whole product re-skins, including the timeline, editor, node canvas and storyboard grid. Your choice is saved to your profile and applied server-side, so the next load is already themed.">
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {themes.map(t => {
            const active = t.id === theme;
            return (
              <button key={t.id} type="button" onClick={() => void apply(t.id)} disabled={pending !== null}
                className={cx('group relative overflow-hidden rounded-lg border p-3 text-left transition-all duration-200 disabled:opacity-60',
                  active ? 'border-accent/55 shadow-glow' : 'border-line hover:border-ink3/45 hover:-translate-y-px')}>
                {/* live preview of the palette */}
                <span className="mb-2.5 flex h-[62px] w-full overflow-hidden rounded-md border border-line-soft"
                  style={{ background: t.swatch[0] }}>
                  <span className="flex w-[26%] flex-col gap-1 border-r p-1.5" style={{ background: t.swatch[1], borderColor: 'rgba(255,255,255,.07)' }}>
                    <span className="h-1 w-3/4 rounded-full" style={{ background: t.swatch[3], opacity: .55 }} />
                    <span className="h-1 w-1/2 rounded-full" style={{ background: t.swatch[3], opacity: .28 }} />
                    <span className="h-1 w-2/3 rounded-full" style={{ background: t.swatch[3], opacity: .18 }} />
                  </span>
                  <span className="flex flex-1 flex-col gap-1 p-1.5">
                    <span className="h-3 w-2/3 rounded-sm" style={{ background: t.swatch[2], opacity: .9 }} />
                    <span className="h-1 w-full rounded-full" style={{ background: t.swatch[3], opacity: .3 }} />
                    <span className="h-1 w-4/5 rounded-full" style={{ background: t.swatch[3], opacity: .2 }} />
                    <span className="mt-auto flex gap-1">
                      <span className="h-2.5 w-8 rounded-sm" style={{ background: t.swatch[2] }} />
                      <span className="h-2.5 flex-1 rounded-sm" style={{ background: t.swatch[3], opacity: .16 }} />
                    </span>
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  <span className={cx('min-w-0 flex-1 truncate text-[12.5px] font-semibold', active ? 'text-accent-bright' : 'text-ink')}>{t.name}</span>
                  {active && <Check size={13} className="shrink-0 text-accent-bright" />}
                  {pending === t.id && <RefreshCw size={12} className="shrink-0 animate-spin text-accent" />}
                </span>
                <span className="mt-1 block text-[10.5px] leading-relaxed text-ink3">{t.description}</span>
                <span className="mt-2 flex items-center gap-1.5">
                  <span className="badge badge-mut">{t.contrast} contrast</span>
                  <span className="flex gap-0.5">
                    {t.swatch.map((c, i) => <span key={i} className="h-2.5 w-2.5 rounded-full border border-line-soft" style={{ background: c }} />)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Density & motion" sub="Motion is deliberately restrained — panel transitions, hover glow and generation progress only. No bounce, no parallax.">
        <div className="space-y-1.5">
          <Toggle checked label="Subtle animations" hint="Panel transitions, hover states, generation shimmer." onChange={() => {}} />
          <Toggle checked label="Film grain overlay" hint="A low-opacity grain over the whole UI. Heavier in Sepia Film and Noir." onChange={() => {}} />
          <Toggle checked label="Reduce preview quality while scrubbing" hint="Drops the monitor to ¼ resolution during fast scrubbing, restores on pause." onChange={() => {}} />
        </div>
        <p className="mt-3 rounded-md border border-line-soft bg-well px-3 py-2 text-[10.5px] leading-relaxed text-ink3">
          Honouring <code className="mono text-ink2">prefers-reduced-motion</code>: when your OS asks for reduced motion,
          every animation and transition in the app collapses to near-zero duration automatically.
        </p>
      </SectionCard>

      <SectionCard title="Design tokens" sub="Every colour in the product resolves through these variables. A theme is one block of overrides — add yours in globals.css plus one entry in src/lib/themes.ts.">
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {[
            ['Background', '--bg-rgb'], ['Stage', '--stage-rgb'], ['Well', '--well-rgb'], ['Panel', '--panel-rgb'],
            ['Elevated', '--elevated-rgb'], ['Card', '--card-rgb'], ['Border', '--line-rgb'], ['Text', '--ink-rgb'],
            ['Secondary', '--ink2-rgb'], ['Muted', '--ink3-rgb'], ['Accent', '--accent-rgb'], ['Accent bright', '--accent-bright-rgb'],
            ['Success', '--ok-rgb'], ['Danger', '--bad-rgb'], ['Info', '--info-rgb'], ['Warn', '--warn-rgb']
          ].map(([label, tok]) => (
            <div key={tok} className="flex items-center gap-2 rounded-md border border-line-soft bg-well px-2 py-1.5">
              <span className="h-5 w-5 shrink-0 rounded border border-line" style={{ background: `rgb(var(${tok}))` }} />
              <span className="min-w-0">
                <span className="block truncate text-[10px] text-ink2">{label}</span>
                <code className="mono block truncate text-[8.5px] text-ink3">{tok}</code>
              </span>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function ShortcutsSection() {
  const groups = [...new Set(SHORTCUTS.map(s => s.group))];
  return (
    <SectionCard title="Keyboard shortcuts" sub="Transport on the left hand, editing on the right. Shortcuts are disabled while a text field has focus so prompts stay safe.">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map(g => (
          <div key={g}>
            <div className="label mb-2">{g}</div>
            <ul className="space-y-1.5">
              {SHORTCUTS.filter(s => s.group === g).map(s => (
                <li key={s.keys + s.label} className="flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-ink2">{s.label}</span>
                  <span className="mono shrink-0 rounded border border-line bg-well px-1.5 py-0.5 text-[10px] text-ink3">{s.keys}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ── Providers ────────────────────────────────────────────── */
function ProvidersSection() {
  const boot = useBoot();
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [adding, setAdding] = React.useState(false);
  const [testing, setTesting] = React.useState<string | null>(null);
  const [keyFor, setKeyFor] = React.useState<Provider | null>(null);
  const providers = boot?.providers ?? [];

  const test = async (p: Provider) => {
    setTesting(p.id);
    try {
      const r = await post<{ ok: boolean; message: string; detail?: string; latencyMs: number; source: string }>(`/api/providers/${p.id}/test`, {});
      toast({ level: r.ok ? 'success' : 'error', title: r.ok ? `${p.name}: ${r.message}` : `${p.name}: ${r.message}`, body: r.detail, ttl: 8000 });
      await reload('providers');
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setTesting(null); }
  };
  const toggle = async (p: Provider) => { await apiPatch(`/api/providers/${p.id}`, { enabled: !p.enabled }); await reload('providers'); };

  return (
    <>
      <SectionCard title="AI providers" right={<Button size="xs" onClick={() => setAdding(true)}><Plus size={11} />Add provider</Button>}
        sub="A provider is a driver plus a base URL. Keys are encrypted server-side with AES-256-GCM before they touch storage, and never returned to the browser — only a mask and a fingerprint.">
        <div className="space-y-2">
          {providers.map(p => (
            <div key={p.id} className={cx('rounded-lg border p-3', p.credentialStatus === 'connected' || p.credentialStatus === 'env' ? 'border-ok/25 bg-ok/[0.04]' : p.enabled ? 'border-line bg-well' : 'border-line-soft bg-well opacity-60')}>
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h4 className="text-[12.5px] font-semibold text-ink">{p.name}</h4>
                    <Badge tone="mut">{p.driver}</Badge>
                    {p.builtIn ? <Badge tone="mut">built-in</Badge> : <Badge tone="info">custom</Badge>}
                    {p.id === 'demo' && <PrevisBadge label="BUILT-IN" />}
                  </div>
                  <p className="mt-1 text-[10.5px] leading-relaxed text-ink3">{p.notes}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {p.capabilities.map(c => <Badge key={c} tone="mut">{c}</Badge>)}
                  </div>
                  {p.baseUrl && <p className="mono mt-1.5 text-[10px] text-ink3">{p.baseUrl}</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="flex items-center gap-1.5 text-[10.5px]">
                    <Dot tone={p.credentialStatus === 'connected' || p.credentialStatus === 'env' || ['demo', 'ollama', 'lmstudio', 'comfyui', 'local-ffmpeg'].includes(p.driver) ? 'ok' : p.credentialStatus === 'failed' || p.credentialStatus === 'invalid' ? 'bad' : 'mut'} />
                    <span className={cx(p.credentialStatus === 'connected' || p.credentialStatus === 'env' || ['demo', 'ollama', 'lmstudio', 'comfyui', 'local-ffmpeg'].includes(p.driver) ? 'text-ok' : p.credentialStatus === 'failed' ? 'text-bad' : 'text-ink3')}>
                      {p.credentialStatus === 'env' ? 'Platform key (env)' : p.credentialStatus === 'connected' ? 'Connected' : p.credentialStatus === 'failed' ? 'Test failed' : p.credentialStatus === 'untested' ? 'Key saved, untested' : ['demo', 'ollama', 'lmstudio', 'comfyui', 'local-ffmpeg'].includes(p.driver) ? 'No key needed (local)' : 'No key'}
                    </span>
                  </span>
                  <div className="flex gap-1">
                    <Button size="xs" variant="ghost" loading={testing === p.id} onClick={() => void test(p)}><Plug size={11} />Test</Button>
                    {p.id !== 'demo' && <Button size="xs" variant="ghost" onClick={() => setKeyFor(p)}><KeyRound size={11} />Key</Button>}
                    <Tip label={p.enabled ? 'Disable' : 'Enable'}><button type="button" className="icon-btn h-6 w-6" data-on={p.enabled} onClick={() => void toggle(p)}><span className={cx('h-2 w-2 rounded-full', p.enabled ? 'bg-ok' : 'bg-white/20')} /></button></Tip>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Local & self-hosted" sub="Ollama, LM Studio, ComfyUI and any OpenAI-compatible endpoint. No key required — just a reachable base URL.">
        <div className="space-y-2">
          {[
            { name: 'Ollama', url: 'http://127.0.0.1:11434/v1', note: 'Run `ollama serve`, then pull a model. Uses the OpenAI-compatible endpoint.' },
            { name: 'LM Studio', url: 'http://127.0.0.1:1234/v1', note: 'Enable the local server in LM Studio, then load any GGUF model.' },
            { name: 'ComfyUI', url: 'http://127.0.0.1:8188', note: 'Start with --listen if the server runs elsewhere. Paste your workflow (API format) into the model config.' },
            { name: 'vLLM / TGI / OpenRouter', url: 'https://openrouter.ai/api/v1', note: 'Anything speaking chat/completions works through the OpenAI-compatible driver.' }
          ].map(x => (
            <div key={x.name} className="rounded-md border border-line-soft bg-well p-2.5">
              <div className="flex items-center gap-2">
                <span className="text-[11.5px] font-medium text-ink">{x.name}</span>
                <code className="mono text-[10px] text-accent-bright">{x.url}</code>
                <div className="flex-1" />
                <Button size="xs" variant="ghost" onClick={() => { void navigator.clipboard?.writeText(x.url); toast({ level: 'success', title: 'Copied' }); }}><Copy size={10} />Copy</Button>
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink3">{x.note}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      <AddProviderModal open={adding} onClose={() => setAdding(false)} />
      <KeyModal provider={keyFor} onClose={() => setKeyFor(null)} />
    </>
  );
}

function AddProviderModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);

  // Grouped so local inference is the first thing you see — the app is
  // provider-agnostic, and a local model is just a driver + a base URL.
  const driverOptions: { value: string; label: string; group: string }[] = [
    { value: 'ollama', label: 'Ollama (local)', group: 'Local / self-hosted' },
    { value: 'lmstudio', label: 'LM Studio (local)', group: 'Local / self-hosted' },
    { value: 'comfyui', label: 'ComfyUI (local image/video)', group: 'Local / self-hosted' },
    { value: 'openai-compatible', label: 'OpenAI-compatible (vLLM, TGI, OpenRouter, llama.cpp)', group: 'Local / self-hosted' },
    { value: 'custom-http', label: 'Custom HTTP (any REST shape)', group: 'Local / self-hosted' },
    { value: 'openai', label: 'OpenAI', group: 'Hosted APIs' },
    { value: 'openai-compatible', label: 'OpenRouter (hosted text models)', group: 'Hosted APIs' },
    { value: 'anthropic', label: 'Anthropic (Claude)', group: 'Hosted APIs' },
    { value: 'replicate', label: 'Replicate', group: 'Hosted APIs' },
    { value: 'fal', label: 'fal.ai', group: 'Hosted APIs' },
    { value: 'elevenlabs', label: 'ElevenLabs (voice)', group: 'Hosted APIs' },
    { value: 'demo', label: 'Studio Engine (built-in previs)', group: 'Utility' }
  ];

  // One-click presets fill the whole form for the common local stacks.
  const presets: { id: string; label: string; name: string; driver: string; baseUrl: string; capabilities: string; note: string }[] = [
    { id: 'ollama', label: 'Ollama', name: 'Ollama (local)', driver: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', capabilities: 'text', note: 'Local LLMs via Ollama. Serves /v1/chat/completions.' },
    { id: 'lmstudio', label: 'LM Studio', name: 'LM Studio (local)', driver: 'lmstudio', baseUrl: 'http://127.0.0.1:1234/v1', capabilities: 'text', note: 'Local server in LM Studio. Enable "Serve on Local Network".' },
    { id: 'comfyui', label: 'ComfyUI', name: 'ComfyUI (local)', driver: 'comfyui', baseUrl: 'http://127.0.0.1:8188', capabilities: 'image,video', note: 'Local ComfyUI for image/video. Point at its HTTP port.' },
    { id: 'vllm', label: 'vLLM / TGI', name: 'vLLM (local)', driver: 'openai-compatible', baseUrl: 'http://127.0.0.1:8000/v1', capabilities: 'text', note: 'Any OpenAI-compatible inference server (vLLM, TGI, llama.cpp).' }
  ];

  const [f, setF] = React.useState({ name: '', driver: 'openai-compatible', baseUrl: '', capabilities: 'text', notes: '' });
  const applyPreset = (p: typeof presets[number]) => setF({ name: p.name, driver: p.driver, baseUrl: p.baseUrl, capabilities: p.capabilities, notes: p.note });
  const isLocal = ['ollama', 'lmstudio', 'comfyui', 'openai-compatible', 'custom-http'].includes(f.driver);
  const submit = async () => {
    try {
      await post('/api/providers', { ...f, capabilities: f.capabilities.split(',').map(s => s.trim()).filter(Boolean) });
      await reload('providers'); toast({ level: 'success', title: 'Provider added', body: isLocal ? 'Now add a model that points at your local model id.' : undefined }); onClose();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  return (
    <Modal open={open} onClose={onClose} width={560} title="Add provider" icon={<Plus size={14} />}
      sub="A provider is a driver plus a base URL. Running models locally? Pick a preset — no API key required."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!f.name || !f.driver}>Add provider</Button></>}>
      <div className="space-y-3">
        <Field label="Quick start (local)" hint="Fills the form for the usual local inference stacks.">
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <button key={p.id} type="button" onClick={() => applyPreset(p)}
                className="rounded-md border border-line-soft bg-well px-2.5 py-1 text-[11.5px] text-ink2 transition-colors hover:border-accent/40 hover:bg-accent/10 hover:text-accent-bright">
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Name" required><TextInput value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="My local model server" /></Field>
        <Field label="Driver"><Select value={f.driver} onChange={v => setF({ ...f, driver: v })} options={driverOptions} /></Field>
        <Field label="Base URL" hint={isLocal ? 'Local servers usually need no key — leave the API key blank and just set this URL.' : 'The root of the provider API.'}>
          <TextInput className="mono text-[11px]" value={f.baseUrl} onChange={e => setF({ ...f, baseUrl: e.target.value })}
            placeholder={isLocal ? 'http://127.0.0.1:11434/v1' : 'https://api.example.com/v1'} />
        </Field>
        <Field label="Capabilities" hint="Comma separated: text, image, video, voice, music, sound, upscale, lipsync, 3d, vision, editing">
          <TextInput value={f.capabilities} onChange={e => setF({ ...f, capabilities: e.target.value })} />
        </Field>
        <Field label="Notes"><TextArea rows={2} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function KeyModal({ provider, onClose }: { provider: Provider | null; onClose: () => void }) {
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [key, setKey] = React.useState('');
  const [baseUrl, setBaseUrl] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [existing, setExisting] = React.useState<{ id: string; maskedKey: string; baseUrl: string | null; status: string; lastTestedAt: string | null; keyFingerprint: string }[]>([]);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!provider) return;
    setKey(''); setBaseUrl(provider.baseUrl ?? ''); setShow(false);
    void get<typeof existing>(`/api/providers/${provider.id}/credentials`).then(setExisting).catch(() => setExisting([]));
  }, [provider]);

  const save = async () => {
    if (!provider) return;
    setBusy(true);
    try {
      await post(`/api/providers/${provider.id}/credentials`, { apiKey: key.trim(), baseUrl: baseUrl.trim() || null });
      let connection: { ok: boolean; message: string; detail?: string } | null = null;
      try { connection = await post<{ ok: boolean; message: string; detail?: string }>(`/api/providers/${provider.id}/test`, {}); } catch { connection = null; }
      toast({ level: connection?.ok ? 'success' : 'warn', title: connection?.ok ? 'Key connected' : 'Key stored — test it when ready', body: connection?.detail ?? connection?.message });
      setKey('');
      setExisting(await get(`/api/providers/${provider.id}/credentials`));
      await reload('providers');
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!provider) return;
    try {
      const r = await post<{ ok: boolean; message: string; detail?: string }>(`/api/providers/${provider.id}/test`, {});
      toast({ level: r.ok ? 'success' : 'error', title: r.message, body: r.detail });
      await reload('providers');
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  const remove = async () => {
    if (!provider) return;
    await del(`/api/providers/${provider.id}/credentials`);
    setExisting([]); await reload('providers');
    toast({ level: 'success', title: 'Key removed' });
  };

  return (
    <Modal open={Boolean(provider)} onClose={onClose} width={540} title={provider ? `${provider.name} API key` : ''} icon={<KeyRound size={14} />}
      sub="Stored encrypted (AES-256-GCM) on the server. Never returned to the browser, never logged, decrypted only for the duration of a request."
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {existing.length > 0 && <Button variant="danger" onClick={remove}><Trash2 size={12} />Remove key</Button>}
        <Button variant="default" onClick={test} disabled={!existing.length}>Test connection</Button>
        <Button variant="primary" loading={busy} onClick={save} disabled={!key.trim()}><Save size={12} />{existing.length ? 'Rotate key' : 'Store key'}</Button>
      </>}>
      {provider && (
        <div className="space-y-3">
          {existing.length > 0 && (
            <div className="rounded-md border border-ok/25 bg-ok/[0.05] p-2.5">
              <div className="flex items-center gap-2">
                <Check size={12} className="text-ok" />
                <span className="text-[11.5px] font-medium text-ink">Key stored</span>
                <Badge tone={existing[0].status === 'connected' ? 'ok' : existing[0].status === 'failed' ? 'bad' : 'mut'}>{existing[0].status}</Badge>
              </div>
              <p className="mono mt-1.5 text-[11px] text-ink2">{existing[0].maskedKey}</p>
              <p className="mt-1 text-[10px] text-ink3">fingerprint {existing[0].keyFingerprint}{existing[0].lastTestedAt ? ` · tested ${new Date(existing[0].lastTestedAt).toLocaleString()}` : ' · not tested yet'}</p>
            </div>
          )}
          <Field label="API key" hint={provider.envKeyVar ? <>Or set <code className="mono text-ink2">{provider.envKeyVar}</code> in the environment for a platform-owned key.</> : undefined}>
            <div className="flex gap-1.5">
              <TextInput type={show ? 'text' : 'password'} value={key} onChange={e => setKey(e.target.value)} placeholder={existing.length ? 'Paste a new key to rotate' : 'sk-…'} className="mono" autoComplete="off" spellCheck={false} />
              <Tip label={show ? 'Hide' : 'Show'}><button type="button" className="icon-btn shrink-0" onClick={() => setShow(s => !s)}>{show ? <EyeOff size={13} /> : <Eye size={13} />}</button></Tip>
            </div>
          </Field>
          <Field label="Base URL" hint="Optional. Overrides the provider default — use it for gateways, proxies and local servers.">
            <TextInput className="mono text-[11px]" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder={provider.baseUrl ?? 'https://…'} />
          </Field>
          <p className="flex items-start gap-1.5 rounded-md border border-line-soft bg-well px-2.5 py-2 text-[10px] leading-relaxed text-ink3">
            <AlertTriangle size={11} className="mt-[1px] shrink-0 text-accent" />
            Your key is encrypted with <code className="mono">AFS_ENCRYPTION_KEY</code>. If that value changes, stored keys
            become unreadable and must be re-entered — the router then falls back to other providers rather than failing.
          </p>
        </div>
      )}
    </Modal>
  );
}

/* ── Models / Presets / Keys ──────────────────────────────── */
function ModelsSection() {
  const boot = useBoot();
  const models = boot?.models ?? [];
  const byKind = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const x of models) m.set(x.kind, (m.get(x.kind) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [models]);
  return (
    <>
      <SectionCard title="Model registry" sub="Models are data. Disable, re-price or extend them here — the router reads this table on every request."
        right={<Link href="/models" className="btn btn-xs">Open Model Hub</Link>}>
        <div className="grid gap-2 sm:grid-cols-3">
          {byKind.map(([k, n]) => <Stat key={k} label={k} value={n} sub={`${models.filter(m => m.kind === k && m.isDefault).length ? 'default set' : 'no default'}`} />)}
        </div>
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {(boot?.providers ?? []).filter(p => p.id !== 'demo').map(p => {
            const count = models.filter(m => m.providerId === p.id).length;
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-md border border-line-soft bg-well px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[11.5px] font-medium text-ink">{p.name}</span>
                    <Badge tone={p.credentialStatus === 'connected' || p.credentialStatus === 'env' ? 'ok' : p.credentialStatus === 'failed' ? 'bad' : 'mut'}>
                      {p.credentialStatus === 'connected' ? 'ready' : p.credentialStatus === 'env' ? 'platform key' : p.credentialStatus === 'failed' ? 'key failed' : 'key needed'}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink3">{count} model{count === 1 ? '' : 's'} · {p.driver}</p>
                </div>
                <Link href="/models" className="btn btn-xs">Models</Link>
              </div>
            );
          })}
        </div>
        <div className="mt-3 space-y-1">
          {models.filter(m => m.isDefault).map(m => (
            <div key={m.id} className="flex items-center gap-2 rounded-md border border-accent/25 bg-accent/[0.06] px-2.5 py-1.5">
              <Badge tone="accent">{m.kind}</Badge>
              <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{m.name}</span>
              {m.demo && <PrevisBadge />}
              <span className="text-[10px] text-ink3 tnum">{m.costPerUnit} cr/{m.unit}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  );
}

function PresetsSection() {
  const boot = useBoot();
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const [editing, setEditing] = React.useState<ModelPreset | null>(null);
  const presets = boot?.presets ?? [];
  const models = boot?.models ?? [];
  const pick = (kind: string) => models.filter(m => m.kind === kind || m.capabilities.includes(kind as never)).map(m => ({ value: m.id, label: m.name, group: m.demo ? 'Built-in' : m.providerId }));

  const save = async () => {
    if (!editing) return;
    try {
      await apiPatch(`/api/presets/${editing.id}`, editing);
      await reload(); toast({ level: 'success', title: 'Preset saved' }); setEditing(null);
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };
  const create = async () => {
    try { const p = await post<ModelPreset>('/api/presets', { name: 'My preset', strategy: 'quality' }); await reload(); setEditing(p); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <>
      <SectionCard title="Model presets" right={<Button size="xs" onClick={create}><Plus size={11} />New preset</Button>}
        sub="A preset binds one model per capability plus generation defaults. Editing a built-in clones it into your own space, so shared presets stay predictable.">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {presets.map(p => (
            <button key={p.id} type="button" onClick={() => setEditing(p)}
              className={cx('rounded-lg border p-3 text-left transition-colors hover:border-accent/40', p.builtIn ? 'border-line bg-well' : 'border-info/25 bg-info/[0.04]')}>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-ink">{p.name}</span>
                {p.builtIn ? <Badge tone="mut">built-in</Badge> : <Badge tone="info">yours</Badge>}
                <Badge tone="accent">{p.strategy}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-[10.5px] leading-relaxed text-ink3">{p.description}</p>
              <div className="mt-2 space-y-0.5">
                {([['Text', p.textModel], ['Image', p.imageModel], ['Video', p.videoModel], ['Voice', p.voiceModel], ['Upscaler', p.upscaleModel]] as const).map(([label, id]) => (
                  <div key={label} className="flex items-center gap-2 text-[10px]">
                    <span className="w-[52px] shrink-0 text-ink3">{label}</span>
                    <span className={cx('min-w-0 flex-1 truncate', id ? 'text-ink2' : 'text-ink3')}>{id ? models.find(m => m.id === id)?.name ?? id : 'router decides'}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </SectionCard>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} width={620} title={editing?.builtIn ? `Clone "${editing?.name}"` : 'Edit preset'} icon={<SlidersHorizontal size={14} />}
        sub={editing?.builtIn ? 'Built-in presets are shared; saving creates your own copy.' : undefined}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button variant="primary" onClick={save}><Save size={12} />Save preset</Button></>}>
        {editing && (
          <div className="space-y-3">
            <Field label="Name"><TextInput value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
            <Field label="Description"><TextArea rows={2} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></Field>
            <Field label="Strategy" hint="Used when a capability has no explicit model, or when the explicit one is unavailable.">
              <Select value={editing.strategy} onChange={v => setEditing({ ...editing, strategy: v as never })}
                options={[{ value: 'quality', label: 'Best quality' }, { value: 'speed', label: 'Fastest' }, { value: 'cost', label: 'Cheapest' }, { value: 'explicit', label: 'Explicit only' }]} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['textModel', 'Text'], ['imageModel', 'Image'], ['videoModel', 'Video'], ['voiceModel', 'Voice'], ['musicModel', 'Music'], ['soundModel', 'Sound'], ['upscaleModel', 'Upscaler'], ['editingModel', 'Editing']] as const).map(([k, label]) => (
                <Field key={k} label={label}>
                  <Select value={(editing[k] as string) ?? ''} onChange={v => setEditing({ ...editing, [k]: v || null })} placeholder="Router decides" options={pick(label.toLowerCase() === 'sound' ? 'sound' : label.toLowerCase())} />
                </Field>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Resolution"><Select value={String(editing.defaults?.resolution ?? '1080p')} onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, resolution: v as never } })} options={['720p', '1080p', '1440p', '4k']} /></Field>
              <Field label="Aspect ratio"><Select value={String(editing.defaults?.aspectRatio ?? '16:9')} onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, aspectRatio: v as never } })} options={['16:9', '9:16', '1:1', '4:5', '2.39:1']} /></Field>
              <Field label="Frame rate"><Select value={String(editing.defaults?.fps ?? 24)} onChange={v => setEditing({ ...editing, defaults: { ...editing.defaults, fps: Number(v) as never } })} options={['24', '25', '30', '50', '60']} /></Field>
            </div>
            <Field label="Fallbacks" hint="Comma separated model ids per capability, e.g. image: fal-flux-pro, demo-image">
              <TextArea rows={3} className="mono text-[11px]"
                value={Object.entries(editing.fallbacks ?? {}).map(([k, v]) => `${k}: ${(v as string[]).join(', ')}`).join('\n')}
                onChange={e => {
                  const out: Record<string, string[]> = {};
                  for (const line of e.target.value.split('\n')) {
                    const [k, ...rest] = line.split(':');
                    if (k && rest.length) out[k.trim()] = rest.join(':').split(',').map(s => s.trim()).filter(Boolean);
                  }
                  setEditing({ ...editing, fallbacks: out });
                }} />
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}

function KeysSection() {
  const boot = useBoot();
  const providers = (boot?.providers ?? []).filter(p => p.id !== 'demo');
  return (
    <SectionCard title="Provider keys" sub="One screen for every credential. Keys are write-only from the browser's perspective: once stored you see a mask and a fingerprint, never the value again.">
      <div className="space-y-1.5">
        {providers.map(p => (
          <div key={p.id} className="flex items-center gap-2.5 rounded-md border border-line-soft bg-well px-3 py-2">
            <Dot tone={p.credentialStatus === 'connected' || p.credentialStatus === 'env' ? 'ok' : p.credentialStatus === 'failed' ? 'bad' : 'mut'} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[11.5px] text-ink">{p.name}</span>
              <span className="block truncate text-[10px] text-ink3">
                {p.credentialStatus === 'env' ? `platform key via ${p.envKeyVar}` : p.credentialStatus === 'connected' ? 'your key, verified' : p.credentialStatus === 'failed' ? 'test failed — check the key or base URL' : p.envKeyVar ? `no key (env: ${p.envKeyVar})` : 'no key required'}
              </span>
            </span>
            <Link href="/settings/providers" className="btn btn-xs">Manage</Link>
          </div>
        ))}
      </div>
      <p className="mt-3 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink3">
        <ShieldCheck size={11} className="mt-[1px] shrink-0 text-ok" />
        Platform-owned keys come from the environment and are never exposed to the browser. User-owned keys are encrypted
        with <code className="mono text-ink2">AFS_ENCRYPTION_KEY</code> before storage. Neither path is ever written to logs.
      </p>
    </SectionCard>
  );
}

function GenerationSection() {
  const boot = useBoot();
  return (
    <>
      <SectionCard title="Queue & workers" sub="Long generations never run inside an HTTP request: routes enqueue, workers execute, and progress reaches the UI over SSE.">
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Queue driver" value={boot ? 'memory' : '—'} sub="swap to BullMQ via REDIS_URL" />
          <Stat label="Concurrency" value={3} sub="AFS_WORKER_CONCURRENCY" />
          <Stat label="Active jobs" value={boot?.queue.active.length ?? 0} sub={`${boot?.queue.counts.queued ?? 0} queued`} tone="accent" />
        </div>
        <p className="mt-3 text-[10.5px] leading-relaxed text-ink3">
          Jobs are durable records. A server restart requeues anything interrupted and respects the attempt budget, so a
          crash never silently loses work — and never double-charges, because credits are refunded on failure.
        </p>
      </SectionCard>
      <SectionCard title="Safety" sub="Guards that stop the product spending your money by accident.">
        <div className="space-y-1.5">
          <Toggle checked label="Confirm before any paid generation" hint="Shows model, provider, unit count and credits before the job is created." onChange={() => {}} />
          <Toggle checked label="Refund failed generations automatically" hint="Credits are reserved at start and returned if the provider errors or the job is cancelled." onChange={() => {}} />
          <Toggle checked label="Require approval for automation batches" hint="A batch node pauses the run and shows the count and cost first." onChange={() => {}} />
          <Toggle checked label="Snapshot before destructive operations" hint="Story/script rewrites, assemblies and AI edits create a restorable revision." onChange={() => {}} />
        </div>
      </SectionCard>
    </>
  );
}

function BillingSection() {
  const boot = useBoot();
  const sub = boot?.subscription;
  const plan = boot?.plans.find(p => p.id === sub?.planId);
  return (
    <>
      <SectionCard title="Plan" right={<Link href="/billing" className="btn btn-xs">Open billing</Link>}>
        <div className="grid gap-2 sm:grid-cols-3">
          <Stat label="Current plan" value={plan?.name ?? 'Free'} tone="accent" />
          <Stat label="Credits remaining" value={Math.round(sub?.credits ?? 0).toLocaleString()} sub={`${sub?.creditsLifetime ?? 0} lifetime`} />
          <Stat label="Renews" value={sub?.renewsAt ? new Date(sub.renewsAt).toLocaleDateString() : '—'} sub={sub?.cancelAtPeriodEnd ? 'cancels at period end' : 'active'} />
        </div>
      </SectionCard>
      <SectionCard title="Spending this month" sub={boot?.usage ? `${boot.usage.spent30d} credits across ${boot.usage.totalTx} ledger entries` : undefined}>
        {boot?.usage && Object.keys(boot.usage.byKind).length ? (
          <div className="space-y-1.5">
            {Object.entries(boot.usage.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-28 shrink-0 truncate text-[11px] text-ink3">{k}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
                  <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright" style={{ width: `${(v / Math.max(1, boot.usage.spent30d)) * 100}%` }} />
                </span>
                <span className="w-14 shrink-0 text-right text-[11px] text-ink2 tnum">{v}</span>
              </div>
            ))}
          </div>
        ) : <p className="text-[11.5px] text-ink3">No credit spend yet — built-in engine generations are free.</p>}
      </SectionCard>
    </>
  );
}

function TeamSection() {
  const boot = useBoot();
  return (
    <SectionCard title="Team" sub={`Plan seats: ${boot?.plans.find(p => p.id === boot?.subscription?.planId)?.seats ?? 1}. Team features need the Studio plan or above.`}>
      <EmptyState compact icon={<Users size={15} />} title="Single-seat workspace"
        body="This instance runs one profile. Team seats, shared asset libraries and per-role permissions are wired to the same data model — upgrade the plan and invite members through the Team API." />
    </SectionCard>
  );
}

function SecuritySection() {
  const [audit, setAudit] = React.useState<{ id: string; action: string; entity: string; createdAt: string; meta?: Record<string, unknown> }[]>([]);
  const boot = useBoot();
  React.useEffect(() => { void get<{ audit: typeof audit }>('/api/settings').then(r => setAudit(r.audit ?? [])); }, []);
  return (
    <>
      <SectionCard title="Authentication" sub={`Mode: ${boot?.limits.authMode === 'open' ? 'open (single local profile)' : 'credentials (email + password, bcrypt, JWT in an httpOnly cookie)'}`}>
        <p className="text-[11.5px] leading-relaxed text-ink2">
          {boot?.limits.authMode === 'open'
            ? 'Open mode provisions one local profile so the app is usable immediately after install. Set AFS_AUTH_MODE=credentials to require sign-up and sign-in.'
            : 'Sessions are signed with AFS_SESSION_SECRET and stored in an httpOnly, SameSite=Lax cookie. State-changing requests are checked against the Origin header.'}
        </p>
      </SectionCard>
      <SectionCard title="Controls in force">
        <ul className="space-y-1.5 text-[11.5px] text-ink2">
          {[
            ['Credential encryption', 'AES-256-GCM envelope with a key derived from AFS_ENCRYPTION_KEY. Plaintext exists only inside the request that stores it.'],
            ['No key exfiltration', 'API responses return a mask and SHA-256 fingerprint only. Keys are stripped from job payloads before they are published to SSE.'],
            ['Signed storage URLs', 'Object keys are served through /api/files with an expiring HMAC signature, or an authenticated session.'],
            ['Rate limiting', 'Sliding-window per user and IP, with a stricter bucket for generation, export and credential tests.'],
            ['Upload validation', 'MIME allow-list plus a size cap (AFS_MAX_UPLOAD_MB). Metadata is extracted server-side, never trusted from the client.'],
            ['CSRF', 'Origin checked on every mutating request when cookie auth is enabled.'],
            ['Audit log', 'Append-only trail of credential, billing, project and automation actions with secrets redacted.'],
            ['Error shaping', 'Users see an actionable message and a suggestion. Stack traces only appear with Developer Mode on.']
          ].map(([k, v]) => (
            <li key={k} className="flex gap-2"><Check size={12} className="mt-[3px] shrink-0 text-ok" /><span><span className="font-medium text-ink">{k}</span> — <span className="text-ink3">{v}</span></span></li>
          ))}
        </ul>
      </SectionCard>
      <SectionCard title="Audit log" sub="Most recent 30 entries.">
        {audit.length ? (
          <div className="scroll-thin max-h-72 overflow-y-auto rounded-md border border-line-soft">
            <table className="w-full border-collapse text-[10.5px]">
              <tbody>
                {audit.map(a => (
                  <tr key={a.id} className="border-b border-line-soft/60 last:border-0">
                    <td className="px-2.5 py-1.5 font-mono text-ink3">{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="px-2.5 py-1.5 text-ink2">{a.action}</td>
                    <td className="px-2.5 py-1.5 text-ink3">{a.entity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-[11.5px] text-ink3">No audited actions yet.</p>}
      </SectionCard>
    </>
  );
}

function StorageSection() {
  const [sys, setSys] = React.useState<{ storage: { driver: string; bytesUsed: number }; database: { driver: string; detail: string } } | null>(null);
  React.useEffect(() => { void get<typeof sys>('/api/system').then(setSys).catch(() => {}); }, []);
  return (
    <>
      <SectionCard title="Object storage" sub="Media never lives in the database. Postgres holds metadata and storage keys; blobs live in object storage behind one interface.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Driver" value={sys?.storage.driver ?? '—'} sub={sys?.storage.driver === 's3' ? 'S3-compatible (S3, R2, MinIO)' : 'Local filesystem under AFS_STORAGE_DIR'} />
          <Stat label="Bytes stored" value={sys ? `${(sys.storage.bytesUsed / 1048576).toFixed(1)} MB` : '—'} sub="images, video, audio, exports, thumbnails" />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink3">
          Switch to S3 by setting <code className="mono text-ink2">AFS_STORAGE_DRIVER=s3</code> plus
          <code className="mono text-ink2"> AWS_S3_BUCKET</code>, <code className="mono text-ink2">AWS_REGION</code> and credentials.
          Nothing else changes — the same <code className="mono text-ink2">StorageDriver</code> interface serves reads and writes,
          and media is still proxied through <code className="mono text-ink2">/api/files</code> so access stays authorised.
        </p>
      </SectionCard>
      <SectionCard title="Database" sub="PostgreSQL + Prisma in production; an embedded file database so the app runs with zero setup.">
        <div className="grid gap-2 sm:grid-cols-2">
          <Stat label="Driver" value={sys?.database.driver ?? '—'} sub={sys?.database.driver === 'prisma' ? 'PostgreSQL via Prisma' : 'Embedded JSON store, atomic writes'} tone={sys?.database.driver === 'prisma' ? 'ok' : 'accent'} />
          <Stat label="Detail" value={sys?.database.detail?.includes('/') ? 'postgresql' : (sys?.database.detail ?? '—')} sub="same repository surface either way" />
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink3">
          Set <code className="mono text-ink2">DATABASE_URL</code> and run <code className="mono text-ink2">npx prisma db push</code> to
          move to PostgreSQL. The driver is probed at boot: if the host answers, Prisma is used; if not, the file driver
          takes over so the app never refuses to start.
        </p>
      </SectionCard>
    </>
  );
}

/* ── Deployment ─────────────────────────────────────────── */
interface DeployItem { id: string; label: string; status: 'ok' | 'warn' | 'todo'; detail: string; fix?: string }
interface DeployReport {
  posture: 'offline' | 'hybrid' | 'cloud'; postureLabel: string; postureDetail: string; isProd: boolean;
  components: {
    database: { driver: string; detail: string; managed: boolean };
    storage: { driver: string; managed: boolean };
    queue: { driver: string; workerMode: string; separated: boolean };
    media: { ffmpeg: boolean };
    auth: { mode: string; multiUser: boolean };
    ai: { engine: 'built-in' | 'providers'; readyProviders: number; totalProviders: number };
  };
  checklist: DeployItem[]; warnings: string[];
}

function CopyLine({ cmd }: { cmd: string }) {
  const toast = useApp(s => s.toast);
  return (
    <div className="group flex items-center gap-2 rounded-md border border-line-soft bg-elevated px-2.5 py-1.5">
      <code className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-accent-bright">{cmd}</code>
      <button type="button" className="icon-btn opacity-0 transition-opacity group-hover:opacity-100" aria-label="Copy"
        onClick={() => { void navigator.clipboard?.writeText(cmd).then(() => toast({ level: 'info', title: 'Copied' })); }}>
        <Copy size={11} />
      </button>
    </div>
  );
}

function DeploymentSection() {
  const [report, setReport] = React.useState<DeployReport | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [tab, setTab] = React.useState<'offline' | 'cloud'>('offline');

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/system');
        const j = await res.json();
        if (!cancelled && j?.deployment) setReport(j.deployment as DeployReport);
      } catch { /* rendered as empty state below */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const postureTone = report?.posture === 'cloud' ? 'ok' : report?.posture === 'hybrid' ? 'accent' : 'mut';
  const outstanding = report?.checklist.filter(i => i.status !== 'ok').length ?? 0;

  const cards = report ? [
    { icon: <Database size={13} />, label: 'Database', value: report.components.database.managed ? 'PostgreSQL' : 'Embedded file', detail: report.components.database.detail, ok: report.components.database.managed },
    { icon: <HardDrive size={13} />, label: 'Storage', value: report.components.storage.managed ? 'S3-compatible' : 'Local filesystem', detail: report.components.storage.managed ? 'Shared across instances and durable across restarts.' : 'Written to local disk; not shared between instances.', ok: report.components.storage.managed },
    { icon: <Cpu size={13} />, label: 'Queue / worker', value: report.components.queue.separated ? 'Separate worker' : 'In-process', detail: `Queue driver ${report.components.queue.driver}; worker mode ${report.components.queue.workerMode}.`, ok: report.components.queue.separated },
    { icon: <Film size={13} />, label: 'Media', value: report.components.media.ffmpeg ? 'FFmpeg available' : 'Browser renderer', detail: report.components.media.ffmpeg ? 'Server-side H.264 / H.265 / ProRes renders enabled.' : 'In-browser export, stem mixdowns and project bundles only.', ok: report.components.media.ffmpeg },
    { icon: <Shield size={13} />, label: 'Auth', value: report.components.auth.multiUser ? 'Credentials' : 'Open (single profile)', detail: report.components.auth.multiUser ? 'bcrypt password hashing, JWT in an httpOnly SameSite cookie.' : 'No sign-in and one local profile — right for a single operator.', ok: true },
    { icon: <Bot size={13} />, label: 'AI engine', value: report.components.ai.engine === 'providers' ? `${report.components.ai.readyProviders} provider(s) ready` : 'Built-in Studio Engine', detail: report.components.ai.engine === 'providers' ? 'The router selects by capability, quality and cost, with automatic fallback.' : 'Renders previsualisation media at zero cost, fully offline.', ok: true }
  ] : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[19px] font-semibold tracking-tight text-ink">Deployment</h1>
        <p className="mt-0.5 max-w-3xl text-[12px] leading-relaxed text-ink3">
          Where your projects, media and AI credentials actually live — and what to change before you ship.
        </p>
      </div>

      {loading ? (
        <Card className="p-5 text-[12px] text-ink3">Reading runtime configuration…</Card>
      ) : !report ? (
        <Card className="p-4">
          <EmptyState icon={<AlertTriangle size={22} />} title="Could not read runtime configuration"
            body="The system endpoint did not respond. Check that the server is running, then reload this page." />
        </Card>
      ) : (
        <>
          <SectionCard title="Current posture"
            right={<Badge tone={postureTone as 'ok'}>{report.postureLabel}</Badge>}
            sub={report.postureDetail}>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={report.isProd ? 'ok' : 'accent'}>{report.isProd ? 'production' : 'development'}</Badge>
              {outstanding > 0
                ? <Badge tone="mut">{outstanding} item{outstanding === 1 ? '' : 's'} outstanding</Badge>
                : <Badge tone="ok"><Check size={9} />All checks pass</Badge>}
            </div>
          </SectionCard>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map(c => (
              <Card key={c.label} className="p-3">
                <div className="flex items-start gap-2.5">
                  <span className={cx('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                    c.ok ? 'border-accent/30 bg-accent/10 text-accent-bright' : 'border-line bg-well text-ink3')}>{c.icon}</span>
                  <div className="min-w-0 flex-1">
                    <p className="label">{c.label}</p>
                    <p className="text-[12px] font-medium text-ink">{c.value}</p>
                    <p className="mt-1 text-[10.5px] leading-snug text-ink3">{c.detail}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          <SectionCard title="Production readiness"
            right={outstanding === 0
              ? <Badge tone="ok"><Check size={9} />All clear</Badge>
              : <Badge tone="accent">{outstanding} to review</Badge>}>
            <ul className="-mx-4 divide-y divide-line-soft/60">
              {report.checklist.map(item => (
                <li key={item.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span className={cx('mt-[3px] shrink-0',
                    item.status === 'ok' ? 'text-ok' : item.status === 'warn' ? 'text-amber-bright' : 'text-err')}>
                    {item.status === 'ok' ? <Check size={13} /> : <AlertTriangle size={13} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-ink">{item.label}</p>
                    <p className="mt-0.5 text-[10.5px] leading-snug text-ink3">{item.detail}</p>
                    {item.fix && <p className="mt-1 break-words font-mono text-[10px] text-accent">{item.fix}</p>}
                  </div>
                </li>
              ))}
            </ul>
            {report.warnings.length > 0 && (
              <div className="mt-3 rounded-md border border-err/25 bg-err/[0.07] px-3 py-2.5">
                <p className="label mb-1.5 text-err">Security warnings</p>
                <ul className="space-y-1">
                  {report.warnings.map((w, i) => <li key={i} className="text-[11px] leading-snug text-ink2">• {w}</li>)}
                </ul>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Run it in production"
            right={
              <div className="flex rounded-md border border-line bg-well p-0.5">
                {(['offline', 'cloud'] as const).map(id => (
                  <button key={id} type="button" onClick={() => setTab(id)}
                    className={cx('rounded px-2 py-0.5 text-[10.5px] font-medium transition-colors',
                      tab === id ? 'bg-elevated text-ink shadow-sm' : 'text-ink3 hover:text-ink2')}>
                    {id === 'offline' ? 'Offline / single host' : 'Cloud-native stack'}
                  </button>
                ))}
              </div>
            }>
            {tab === 'offline' ? (
              <div className="space-y-2.5">
                <p className="text-[11.5px] leading-relaxed text-ink2">
                  No database server, no object store, no external AI. Projects, media, versions and jobs all live under
                  <code className="mx-1 rounded bg-well px-1 py-0.5 font-mono text-[10.5px] text-accent">AFS_DATA_DIR</code>.
                  This is the default and needs no configuration at all.
                </p>
                <div className="space-y-1.5">
                  <CopyLine cmd="npm ci && npx prisma generate" />
                  <CopyLine cmd="npm run build" />
                  <CopyLine cmd="npm start" />
                  <CopyLine cmd="npm run worker" />
                </div>
                <p className="text-[10.5px] leading-relaxed text-ink3">
                  Multi-user on the same host: set <code className="font-mono text-accent">AFS_AUTH_MODE=credentials</code>.
                  Add real AI later by dropping provider keys into Settings → AI Providers — no restart required.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                <p className="text-[11.5px] leading-relaxed text-ink2">
                  PostgreSQL, Redis, MinIO (or S3), the web app and a separated media worker. The image already ships
                  FFmpeg, so server-side renders work out of the box.
                </p>
                <div className="space-y-1.5">
                  <CopyLine cmd="cp .env.production.example .env" />
                  <CopyLine cmd={'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'} />
                  <CopyLine cmd="docker compose up -d --build" />
                  <CopyLine cmd="docker compose exec app npx prisma db push" />
                  <CopyLine cmd="docker compose logs -f app worker" />
                </div>
                <p className="text-[10.5px] leading-relaxed text-ink3">
                  Behind a load balancer set <code className="font-mono text-accent">AFS_TRUST_PROXY=1</code> so
                  <code className="mx-1 font-mono text-accent">x-forwarded-for</code>is honoured for rate limiting, and terminate
                  TLS at the proxy. Sessions are JWTs in httpOnly SameSite cookies, so sticky sessions are not required.
                </p>
              </div>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}

function AdvancedSection() {
  const [sys, setSys] = React.useState<any>(null);
  const reload = useApp(s => s.reload);
  const toast = useApp(s => s.toast);
  const boot = useBoot();
  React.useEffect(() => { void get('/api/system').then(setSys).catch(() => {}); }, [boot]);
  const [devMode, setDevMode] = React.useState(Boolean(boot?.user.developerMode));
  return (
    <>
      <SectionCard title="System status" right={<Button size="xs" variant="ghost" onClick={() => void get('/api/system').then(setSys)}><RefreshCw size={11} />Refresh</Button>}>
        {sys ? (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <Stat label="Version" value={sys.version} sub={sys.env} />
            <Stat label="Database" value={sys.database.driver} sub={sys.database.detail.includes('/') ? 'postgresql' : sys.database.detail} tone={sys.database.driver === 'prisma' ? 'ok' : 'accent'} />
            <Stat label="Storage" value={sys.storage.driver} sub={`${(sys.storage.bytesUsed / 1048576).toFixed(1)} MB used`} />
            <Stat label="FFmpeg" value={sys.ffmpeg.available ? 'available' : 'not found'} sub={sys.ffmpeg.available ? sys.ffmpeg.path : 'browser renders + stems still work'} tone={sys.ffmpeg.available ? 'ok' : 'bad'} />
            <Stat label="Queue" value={sys.queue.driver} sub={`${sys.queue.concurrency} workers · ${sys.queue.live} live`} />
            <Stat label="Generation engine" value={sys.ai.demoMode ? 'built-in' : 'providers'} sub={sys.ai.demoMode ? 'no provider keys configured — rendering previs' : 'external models configured'} tone={sys.ai.demoMode ? 'accent' : 'ok'} />
          </div>
        ) : <p className="text-[11.5px] text-ink3">Loading system status…</p>}
        {sys?.warnings?.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {sys.warnings.map((w: string) => (
              <p key={w} className="flex items-start gap-2 rounded-md border border-accent/30 bg-accent/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-ink2">
                <AlertTriangle size={12} className="mt-[2px] shrink-0 text-accent-bright" />{w}
              </p>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Developer mode" sub="Shows raw provider error messages and stack traces in API responses. Leave off unless you are debugging.">
        <Toggle checked={devMode} onChange={async v => { setDevMode(v); await apiPatch('/api/settings', { developerMode: v }); await reload(); toast({ level: 'success', title: v ? 'Developer mode on' : 'Developer mode off' }); }}
          label="Developer mode" hint="Errors will include provider messages and short stack traces." />
      </SectionCard>

      <SectionCard title="Provider adapters" sub={`${sys?.ai?.drivers?.length ?? 0} drivers registered. Adding a vendor means one adapter plus catalogue rows — no UI, queue or storage changes.`}>
        <div className="flex flex-wrap gap-1.5">
          {(sys?.ai?.drivers ?? []).map((d: string) => <Badge key={d} tone="mut" className="mono">{d}</Badge>)}
        </div>
        <pre className="mono mt-3 overflow-x-auto rounded-md border border-line-soft bg-deep p-3 text-[10px] leading-relaxed text-ink3">{`interface ProviderAdapter {
  driver: string
  capabilities(): Capability[]
  estimateCost(req, model): { credits, breakdown }
  generate(req, ctx): AsyncGenerator<ProviderEvent, GenerationResult>
  testConnection?(ctx): Promise<{ ok, message, detail? }>
  getStatus?(id, ctx)   cancel?(id, ctx)
}`}</pre>
      </SectionCard>

      <SectionCard title="Environment" sub="Everything is optional — the app boots and generates with no configuration at all, using the built-in Studio Engine.">
        <CopyField label="" value="AFS_ENCRYPTION_KEY · AFS_SESSION_SECRET · DATABASE_URL · AFS_STORAGE_DRIVER · AWS_S3_BUCKET · AFS_QUEUE_DRIVER · REDIS_URL · AFS_WORKER_CONCURRENCY · FFMPEG_PATH · AFS_DEMO_MODE · AFS_AUTH_MODE" />
        <p className="mt-2 text-[10.5px] leading-relaxed text-ink3">See <code className="mono text-ink2">.env.example</code> for the full annotated list.</p>
      </SectionCard>
    </>
  );
}
