'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Images, Upload, Search, Grid3x3, List, Download, Copy, Trash2, Pencil, Layers, Check } from 'lucide-react';
import { Button, Badge, Card, EmptyState, Skeleton, cx, PrevisBadge, Segmented, Stat } from '@/components/ui/primitives';
import { TextInput, Select } from '@/components/ui/inputs';
import { Popover, MenuItem, Modal, useConfirm } from '@/components/ui/overlays';
import { AssetThumb } from '@/components/stages/AssetThumb';
import { Waveform } from '@/components/stages/VoiceStage';
import { get, del, patch as apiPatch, upload, describeError } from '@/lib/client/api';
import { formatBytes, formatSeconds } from '@/lib/client/ids';
import { useApp } from '@/store/app';
import { useProject } from '@/store/project';
import type { Asset, AssetKind } from '@/types';

const CATEGORIES: { id: string; label: string; kinds: AssetKind[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'images', label: 'Images', kinds: ['image'] },
  { id: 'videos', label: 'Videos', kinds: ['video'] },
  { id: 'audio', label: 'Audio', kinds: ['audio'] },
  { id: 'voice', label: 'Voice', kinds: ['voice'] },
  { id: 'music', label: 'Music', kinds: ['music', 'sfx'] },
  { id: 'characters', label: 'Characters', kinds: ['character'] },
  { id: 'locations', label: 'Locations', kinds: ['location'] },
  { id: 'storyboards', label: 'Storyboards', kinds: ['storyboard'] },
  { id: 'exports', label: 'Exports', kinds: ['export'] },
  { id: 'other', label: 'Other', kinds: ['document', 'lut', 'project'] }
];

export function AssetsScreen() {
  const router = useRouter();
  const toast = useApp(s => s.toast);
  const { confirm, node } = useConfirm();
  const [cat, setCat] = React.useState('all');
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [q, setQ] = React.useState('');
  const [scope, setScope] = React.useState<'all' | 'project'>('all');
  const [detail, setDetail] = React.useState<Asset | null>(null);
  const [renaming, setRenaming] = React.useState<Asset | null>(null);
  const [newName, setNewName] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const projectId = useProject(s => s.project?.id);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const kinds = CATEGORIES.find(c => c.id === cat)?.kinds ?? [];
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['assets', cat, q, scope, projectId],
    queryFn: () => get<{ assets: Asset[]; usage: { count: number; bytes: number; byKind: Record<string, { count: number; bytes: number }> } }>(
      `/api/assets?scope=${scope}${scope === 'project' && projectId ? `&projectId=${projectId}` : ''}${kinds.length ? `&kinds=${kinds.join(',')}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`)
  });
  const assets = data?.assets ?? [];

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      if (projectId && scope === 'project') fd.append('projectId', projectId);
      const r = await upload<{ assets: Asset[] }>('/api/uploads', fd);
      toast({ level: 'success', title: `${r.assets.length} asset(s) imported` });
      await refetch();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const act = async (a: Asset, action: 'rename' | 'duplicate' | 'delete' | 'download') => {
    try {
      if (action === 'delete') {
        const ok = await confirm({ title: `Delete "${a.name}"?`, tone: 'danger', confirmLabel: 'Delete asset', body: 'The file is removed from object storage. Clips referencing it will show as offline.' });
        if (!ok) return;
        await del(`/api/assets/${a.id}`);
        toast({ level: 'success', title: 'Asset deleted' });
      } else if (action === 'duplicate') {
        await apiPatch(`/api/assets/${a.id}`, { action: 'duplicate' });
        toast({ level: 'success', title: 'Duplicated' });
      } else if (action === 'rename') {
        setRenaming(a); setNewName(a.name); return;
      } else {
        const el = document.createElement('a'); el.href = a.url; el.download = a.name; el.target = '_blank'; el.rel = 'noreferrer'; el.click();
      }
      await refetch();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  const saveRename = async () => {
    if (!renaming) return;
    await apiPatch(`/api/assets/${renaming.id}`, { name: newName });
    setRenaming(null); await refetch();
    toast({ level: 'success', title: 'Renamed' });
  };

  const byKind = data?.usage?.byKind ?? {};

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="mx-auto w-full max-w-[1360px] px-6 py-7 lg:px-10">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink"><Images size={18} className="text-accent" />Asset library</h1>
            <p className="mt-1 text-[12.5px] text-ink2">{data?.usage?.count ?? 0} assets · {formatBytes(data?.usage?.bytes ?? 0)} in object storage · metadata in the database, media in storage.</p>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,video/*,audio/*,.json,.csv,.cube,.zip" onChange={e => void onUpload(e.target.files)} />
            <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={12} />Import</Button>
            <Segmented size="sm" value={view} onChange={v => setView(v as never)} options={[{ value: 'grid', label: <Grid3x3 size={12} /> }, { value: 'list', label: <List size={12} /> }]} />
          </div>
        </header>

        <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {Object.entries(byKind).slice(0, 5).map(([k, v]) => (
            <Stat key={k} label={k} value={v.count} sub={formatBytes(v.bytes)} />
          ))}
          {!Object.keys(byKind).length && <Stat label="Assets" value={0} sub="nothing stored yet" />}
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            {CATEGORIES.map(c => (
              <button key={c.id} type="button" onClick={() => setCat(c.id)}
                className={cx('rounded-md border px-2.5 py-1 text-[11px] font-medium transition-colors',
                  cat === c.id ? 'border-accent/45 bg-accent/12 text-accent-bright' : 'border-line bg-well text-ink3 hover:text-ink2')}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex-1" />
          <div className="relative w-[220px]">
            <Search size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <TextInput className="h-[30px] pl-7 text-[11.5px]" value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, prompt, tag…" />
          </div>
          <Select className="w-[160px]" value={scope} onChange={v => setScope(v as never)}
            options={[{ value: 'all', label: 'All projects' }, { value: 'project', label: projectId ? 'Current project' : 'Current project (none)' }]} />
        </div>

        {selected.size > 0 && (
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/[0.07] px-3 py-2">
            <Badge tone="accent">{selected.size} selected</Badge>
            <div className="flex-1" />
            <Button size="xs" variant="ghost" onClick={() => { for (const id of selected) { const a = assets.find(x => x.id === id); if (a) void act(a, 'download'); } }}><Download size={11} />Download</Button>
            <Button size="xs" variant="danger" onClick={async () => {
              const ok = await confirm({ title: `Delete ${selected.size} assets?`, tone: 'danger', confirmLabel: 'Delete all', requireText: 'DELETE' });
              if (!ok) return;
              for (const id of selected) await del(`/api/assets/${id}`).catch(() => {});
              setSelected(new Set()); await refetch(); toast({ level: 'success', title: 'Assets deleted' });
            }}><Trash2 size={11} />Delete</Button>
            <Button size="xs" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}

        {isLoading && <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">{Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-[132px]" />)}</div>}

        {!isLoading && !assets.length && (
          <EmptyState icon={<Images size={17} />} title={q ? `Nothing matches “${q}”` : 'No assets in this category'}
            body={<>Everything you generate lands here automatically, tagged with its prompt, seed, model and provider. You can also import your own footage.</>}
            action={<Button size="sm" variant="primary" onClick={() => fileRef.current?.click()}><Upload size={12} />Import media</Button>}
            secondary={<Button size="sm" onClick={() => router.push('/generate')}>Open AI Generator</Button>} />
        )}

        {view === 'grid' && assets.length > 0 && (
          <div className="grid gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {assets.map(a => (
              <Card key={a.id} hover className={cx('group relative overflow-hidden', selected.has(a.id) && 'border-accent/50 shadow-glow')}>
                <button type="button" onClick={() => setDetail(a)} className="block w-full text-left">
                  <AssetThumb asset={a} ratio="4/3" className="rounded-none border-0" />
                  <div className="p-2">
                    <p className="truncate text-[10.5px] font-medium text-ink2 group-hover:text-ink">{a.name}</p>
                    <p className="mt-0.5 truncate text-[9px] text-ink3">{a.kind}{a.durationSec ? ` · ${formatSeconds(a.durationSec)}` : a.width ? ` · ${a.width}×${a.height}` : ''}</p>
                  </div>
                </button>
                <span className="absolute left-1.5 top-1.5 flex items-center gap-1">
                  <button type="button" aria-label="Select"
                    onClick={e => { e.stopPropagation(); setSelected(s => { const n = new Set(s); n.has(a.id) ? n.delete(a.id) : n.add(a.id); return n; }); }}
                    className={cx('flex h-4 w-4 items-center justify-center rounded border backdrop-blur transition-colors',
                      selected.has(a.id) ? 'border-accent bg-accent text-accent-on' : 'border-white/25 bg-black/50 text-transparent hover:text-ink/60')}>
                    <Check size={9} />
                  </button>
                  {a.demo && <PrevisBadge />}
                </span>
                <span className="absolute right-1.5 top-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <AssetMenu a={a} onAct={act} />
                </span>
              </Card>
            ))}
          </div>
        )}

        {view === 'list' && assets.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full border-collapse text-[11.5px]">
              <thead><tr className="border-b border-line bg-well2 text-left">
                {['', 'Name', 'Type', 'Model', 'Resolution', 'Duration', 'Size', 'Created', ''].map(h => <th key={h} className="label px-2.5 py-2 font-semibold">{h}</th>)}
              </tr></thead>
              <tbody>
                {assets.map(a => (
                  <tr key={a.id} className="cursor-pointer border-b border-line-soft/60 transition-colors last:border-0 hover:bg-white/[0.02]" onClick={() => setDetail(a)}>
                    <td className="w-[54px] px-2 py-1.5"><AssetThumb asset={a} ratio="16/9" className="w-[46px]" animate="none" /></td>
                    <td className="max-w-[240px] px-2.5 py-1.5">
                      <span className="flex items-center gap-1.5"><span className="truncate font-medium text-ink">{a.name}</span>{a.demo && <PrevisBadge />}</span>
                      <span className="block truncate text-[10px] text-ink3">{a.prompt?.slice(0, 90)}</span>
                    </td>
                    <td className="px-2.5 py-1.5"><Badge tone="mut">{a.kind}</Badge></td>
                    <td className="px-2.5 py-1.5 font-mono text-[10px] text-ink3">{a.modelId ?? '—'}</td>
                    <td className="px-2.5 py-1.5 text-ink3 tnum">{a.width ? `${a.width}×${a.height}` : '—'}</td>
                    <td className="px-2.5 py-1.5 text-ink3 tnum">{a.durationSec ? formatSeconds(a.durationSec) : '—'}</td>
                    <td className="px-2.5 py-1.5 text-ink3 tnum">{formatBytes(a.bytes)}</td>
                    <td className="px-2.5 py-1.5 text-ink3">{new Date(a.createdAt).toLocaleDateString()}</td>
                    <td className="px-2 py-1.5 text-right" onClick={e => e.stopPropagation()}><AssetMenu a={a} onAct={act} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* detail */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} width={860} title={detail?.name} sub={detail?.prompt}>
        {detail && (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div>
              {detail.mimeType.startsWith('audio/')
                ? <div className="rounded-lg border border-line-soft bg-well p-3"><Waveform peaks={(detail.meta as any)?.peaks ?? []} height={70} /><audio src={detail.url} controls className="mt-2 w-full" /></div>
                : <AssetThumb asset={detail} ratio={detail.kind === 'video' ? '16/9' : '16/9'} animate="always" className="w-full" />}
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button size="xs" onClick={() => void act(detail, 'download')}><Download size={11} />Download</Button>
                <Button size="xs" variant="ghost" onClick={() => void act(detail, 'duplicate')}><Copy size={11} />Duplicate</Button>
                <Button size="xs" variant="ghost" onClick={() => void act(detail, 'rename')}><Pencil size={11} />Rename</Button>
                {detail.projectId && <Button size="xs" variant="ghost" onClick={() => { setDetail(null); router.push(`/project/${detail.projectId}?stage=editor`); }}><Layers size={11} />Open in project</Button>}
                <Button size="xs" variant="danger" onClick={() => void act(detail, 'delete')}><Trash2 size={11} />Delete</Button>
              </div>
            </div>
            <div className="space-y-1">
              <Row k="Type" v={<Badge tone="mut">{detail.kind}</Badge>} />
              <Row k="MIME" v={detail.mimeType} mono />
              <Row k="Model" v={detail.modelId ?? '—'} mono />
              <Row k="Provider" v={detail.providerId ?? '—'} />
              <Row k="Seed" v={String(detail.seed || '—')} mono />
              <Row k="Version" v={`v${detail.version}`} />
              <Row k="Size" v={formatBytes(detail.bytes)} />
              {detail.width ? <Row k="Dimensions" v={`${detail.width}×${detail.height}`} /> : null}
              {detail.durationSec ? <Row k="Duration" v={formatSeconds(detail.durationSec)} /> : null}
              <Row k="Created" v={new Date(detail.createdAt).toLocaleString()} />
              <Row k="Storage key" v={detail.storageKey.split('/').slice(-2).join('/')} mono />
              {detail.demo && <div className="pt-1"><PrevisBadge label="STUDIO ENGINE ASSET" /></div>}
              {detail.tags?.length > 0 && <div className="flex flex-wrap gap-1 pt-2">{detail.tags.map(t => <Badge key={t} tone="mut">{t}</Badge>)}</div>}
              {detail.negativePrompt && <div className="pt-2"><p className="label mb-1">Negative prompt</p><p className="text-[10.5px] leading-relaxed text-ink3">{detail.negativePrompt}</p></div>}
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(renaming)} onClose={() => setRenaming(null)} width={420} title="Rename asset"
        footer={<><Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button><Button variant="primary" onClick={saveRename}>Save</Button></>}>
        <TextInput autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void saveRename(); }} />
      </Modal>
      {node}
    </div>
  );
}

function AssetMenu({ a, onAct }: { a: Asset; onAct: (a: Asset, action: 'rename' | 'duplicate' | 'delete' | 'download') => void }) {
  return (
    <Popover width={180} trigger={({ toggle }) => <button type="button" onClick={e => { e.stopPropagation(); toggle(); }} className="icon-btn h-6 w-6 bg-black/50 backdrop-blur"><List size={12} /></button>}>
      {close => (
        <div onClick={e => e.stopPropagation()}>
          <MenuItem icon={<Download size={13} />} label="Download" onClick={() => { close(); onAct(a, 'download'); }} />
          <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { close(); onAct(a, 'duplicate'); }} />
          <MenuItem icon={<Pencil size={13} />} label="Rename" onClick={() => { close(); onAct(a, 'rename'); }} />
          <div className="my-1 h-px bg-line-soft" />
          <MenuItem tone="danger" icon={<Trash2 size={13} />} label="Delete" onClick={() => { close(); onAct(a, 'delete'); }} />
        </div>
      )}
    </Popover>
  );
}
function Row({ k, v, mono }: { k: string; v: React.ReactNode; mono?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3 border-b border-line-soft/60 py-1.5"><span className="shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-ink3">{k}</span><span className={cx('min-w-0 truncate text-right text-[11px] text-ink2', mono && 'mono text-[10px]')}>{v}</span></div>;
}
