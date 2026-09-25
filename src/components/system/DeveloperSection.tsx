'use client';
import * as React from 'react';
import { Plus, Terminal, Trash2, AlertTriangle, KeyRound, Check } from 'lucide-react';
import { Button, Badge, Card, EmptyState, cx } from '@/components/ui/primitives';
import { Field, TextInput, Select, CopyField } from '@/components/ui/inputs';
import { Modal, useConfirm } from '@/components/ui/overlays';
import { get, post, del, describeError } from '@/lib/client/api';
import { useApp } from '@/store/app';

/** Mirror of the server's `ApiKeyView`. The hash never reaches the client. */
interface KeyView {
  id: string; name: string; prefix: string; scopes: string[];
  enabled: boolean; expiresAt: string | null;
  lastUsedAt: string | null; lastUsedIp: string | null; createdAt: string;
}

const SCOPE_BLURB: Record<string, string> = {
  projects: 'Read and write projects',
  generate: 'Enqueue generations and read jobs',
  models: 'Read the model registry',
  assets: 'Read the asset library',
  system: 'Probe status and capabilities'
};

const EXPIRY_OPTIONS = [
  { value: '', label: 'Never expires' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' }
];

const ENDPOINTS = ['/api/open/system', '/api/open/projects', '/api/open/projects/{id}',
  '/api/open/generate', '/api/open/jobs', '/api/open/jobs/{id}', '/api/open/models', '/api/open/assets'];

function relative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) {
    const days = Math.ceil(-ms / 86_400_000);
    return days > 1 ? `in ${days} days` : 'in under a day';
  }
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toLocaleDateString();
}

const isExpired = (k: KeyView) => Boolean(k.expiresAt && new Date(k.expiresAt).getTime() <= Date.now());

/** The whole second line of a key row, built as plain text. */
function describeKey(k: KeyView): string {
  const parts = [k.scopes.length ? `scopes: ${k.scopes.join(', ')}` : 'unrestricted'];
  parts.push(`used ${relative(k.lastUsedAt)}`);
  if (k.lastUsedIp) parts.push(`from ${k.lastUsedIp}`);
  if (k.expiresAt && !isExpired(k)) parts.push(`expires ${relative(k.expiresAt)}`);
  return parts.join(' · ');
}

export function DeveloperSection() {
  const toast = useApp(s => s.toast);
  const { confirm, node } = useConfirm();
  const [keys, setKeys] = React.useState<KeyView[]>([]);
  const [scopes, setScopes] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [issued, setIssued] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await get<{ keys: KeyView[]; availableScopes: string[] }>('/api/keys');
      setKeys(r.keys ?? []);
      setScopes(r.availableScopes ?? []);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  const revoke = async (k: KeyView) => {
    const ok = await confirm({
      title: `Revoke "${k.name}"?`, tone: 'danger', confirmLabel: 'Revoke key',
      body: 'Anything using this key stops working on its next request. This cannot be undone — issue a new key instead.'
    });
    if (!ok) return;
    try {
      await del(`/api/keys/${k.id}`);
      await load();
      toast({ level: 'success', title: 'Key revoked' });
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    }
  };

  const active = keys.filter(k => k.enabled && !isExpired(k)).length;
  const curl = `curl ${typeof window === 'undefined' ? 'https://your-studio' : window.location.origin}/api/open/system \\\n  -H "Authorization: Bearer afs_YOUR_KEY"`;

  const body = loading
    ? <p className="py-6 text-center text-[11px] text-ink3">Loading keys…</p>
    : keys.length === 0
      ? <EmptyState icon={<KeyRound size={17} />} title="No API keys yet"
          body="Create one to call the studio from a script. You will see the key exactly once."
          action={<Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={12} />Create a key</Button>} />
      : (
        <div className="space-y-1.5">
          {keys.map(k => <KeyRow key={k.id} k={k} onRevoke={() => void revoke(k)} />)}
        </div>
      );

  return (
    <>
      <Card hover={false} className="mb-4 overflow-hidden">
        <div className="flex items-start gap-3 border-b border-line-soft px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-[12.5px] font-semibold text-ink">Public API</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink3">
              Keys for driving this studio from your own scripts and services over <code className="mono">/api/open/*</code>.
              Unrelated to provider keys — those are credentials this app holds, these are credentials it issues.
            </p>
          </div>
          <Button size="sm" variant="primary" onClick={() => setCreating(true)}><Plus size={12} />New key</Button>
        </div>

        <div className="p-4">
          {body}

          <div className="mt-4 space-y-2 border-t border-line-soft pt-3">
            <p className="label">Calling the API</p>
            <CopyField value={curl} />
            <p className="text-[10.5px] leading-relaxed text-ink3">
              Send the key as <code className="mono text-ink2">Authorization: Bearer afs_…</code> or{' '}
              <code className="mono text-ink2">x-api-key: afs_…</code>. Responses use the same{' '}
              <code className="mono text-ink2">{'{ ok, data }'}</code> envelope as the rest of the API, and errors carry a{' '}
              <code className="mono text-ink2">message</code>, <code className="mono text-ink2">code</code> and{' '}
              <code className="mono text-ink2">hint</code>.
            </p>
            <div className="flex flex-wrap gap-1">
              {ENDPOINTS.map(e => (
                <code key={e} className="mono rounded border border-line-soft bg-well px-1.5 py-0.5 text-[9.5px] text-ink3">{e}</code>
              ))}
            </div>
            <p className="flex items-start gap-1.5 text-[10.5px] leading-relaxed text-ink3">
              <AlertTriangle size={11} className="mt-px shrink-0 text-warn" />
              <span>
                Only the hash is stored, so a lost key cannot be recovered — revoke it and issue a new one.
                {active > 0 ? ` ${active} active key${active > 1 ? 's' : ''}.` : ''}
              </span>
            </p>
          </div>
        </div>
      </Card>

      {creating && (
        <CreateKeyModal
          availableScopes={scopes}
          onClose={() => setCreating(false)}
          onCreated={async plaintext => { setIssued(plaintext); await load(); }}
        />
      )}

      {issued && (
        <Modal open onClose={() => setIssued(null)} width={560} title="Copy your key now"
          icon={<KeyRound size={14} />}
          sub="This is the only time it will be shown. Only its hash is stored, so it cannot be recovered later."
          footer={<Button variant="primary" onClick={() => setIssued(null)}><Check size={12} />I have saved it</Button>}>
          <div className="space-y-3">
            <div className="rounded-md border border-accent/40 bg-accent/8 p-3">
              <code className="mono block break-all text-[12px] leading-relaxed text-accent-bright">{issued}</code>
            </div>
            <CopyField value={issued} label="Key" />
            <p className="text-[10.5px] leading-relaxed text-ink3">
              Store it in a secret manager or an environment variable — not in source control. If it leaks, revoke it
              here; revocation takes effect on the next request.
            </p>
          </div>
        </Modal>
      )}
      {node}
    </>
  );
}

function KeyRow({ k, onRevoke }: { k: KeyView; onRevoke: () => void }) {
  const expired = isExpired(k);
  const dead = !k.enabled || expired;
  const dot = dead ? 'var(--bad)' : 'var(--ok)';
  const badge = expired
    ? <Badge tone="bad">expired</Badge>
    : k.enabled ? <Badge tone="ok">active</Badge> : <Badge tone="mut">revoked</Badge>;

  return (
    <div className={cx('rounded-md border border-line-soft bg-well px-3 py-2', dead && 'opacity-60')}>
      <div className="flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: dot }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[11.5px] font-medium text-ink">{k.name}</span>
            <code className="mono shrink-0 text-[10px] text-ink3">{k.prefix}</code>
            {badge}
          </div>
          <p className="mt-0.5 truncate text-[10px] text-ink3">{describeKey(k)}</p>
        </div>
        {!dead && <Button size="xs" variant="ghost" onClick={onRevoke}><Trash2 size={11} />Revoke</Button>}
      </div>
    </div>
  );
}

function CreateKeyModal({ availableScopes, onClose, onCreated }: {
  availableScopes: string[]; onClose: () => void; onCreated: (plaintext: string) => Promise<void>;
}) {
  const toast = useApp(s => s.toast);
  const [name, setName] = React.useState('');
  const [expiry, setExpiry] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [saving, setSaving] = React.useState(false);

  const toggle = (s: string) => setSelected(prev => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s); else next.add(s);
    return next;
  });

  const submit = async () => {
    if (!name.trim()) { toast({ level: 'error', title: 'Give the key a name' }); return; }
    setSaving(true);
    try {
      const created = await post<{ plaintext: string }>('/api/keys', {
        name: name.trim(),
        // An empty list means unrestricted; the server treats it that way too.
        scopes: [...selected],
        expiresInDays: expiry ? Number(expiry) : null
      });
      onClose();
      await onCreated(created.plaintext);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} width={520} title="New API key" icon={<Terminal size={14} />}
      sub="Name it after whatever will hold it, so you know what to revoke later."
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="primary" onClick={() => void submit()} disabled={saving || !name.trim()}>
          {saving ? 'Creating…' : 'Create key'}
        </Button>
      </>}>
      <div className="space-y-4">
        <Field label="Name" required>
          <TextInput value={name} onChange={e => setName(e.target.value)} placeholder="Render farm" maxLength={60} autoFocus />
        </Field>

        <Field label="Expires" hint="A key that expires on its own is one you never have to remember to revoke.">
          <Select value={expiry} onChange={setExpiry} options={EXPIRY_OPTIONS} />
        </Field>

        <div>
          <p className="field-label mb-1.5">Scopes</p>
          <div className="space-y-1">
            {availableScopes.map(s => (
              <button key={s} type="button" onClick={() => toggle(s)}
                className={cx('flex w-full items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-left transition-colors',
                  selected.has(s) ? 'border-accent/45 bg-accent/10' : 'border-line-soft bg-well hover:border-line')}>
                <span className={cx('flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                  selected.has(s) ? 'border-accent bg-accent text-white' : 'border-line')}>
                  {selected.has(s) ? <Check size={9} /> : null}
                </span>
                <span className="min-w-0">
                  <code className="mono block text-[11px] text-ink">{s}</code>
                  <span className="block text-[10px] text-ink3">{SCOPE_BLURB[s] ?? ''}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10.5px] leading-snug text-ink3">
            {selected.size === 0
              ? 'Nothing selected — the key will reach every endpoint. Pick scopes to narrow it.'
              : `${selected.size} scope${selected.size > 1 ? 's' : ''} selected.`}
          </p>
        </div>
      </div>
    </Modal>
  );
}
