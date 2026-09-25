'use client';
import * as React from 'react';
import { Users, Lock, Unlock, Check, Upload, Sparkles, Plus, Pencil, X } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { AssetThumb } from './AssetThumb';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge } from '@/components/ui/primitives';
import { Field, TextInput, TextArea } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { upload, describeError } from '@/lib/client/api';
import type { Asset, Character } from '@/types';

const FIELDS: { key: keyof Character; label: string; rows?: number; hint?: string }[] = [
  { key: 'name', label: 'Name' }, { key: 'role', label: 'Role' }, { key: 'age', label: 'Age' },
  { key: 'description', label: 'Description', rows: 3 }, { key: 'personality', label: 'Personality', rows: 2 },
  { key: 'wardrobe', label: 'Wardrobe', rows: 2 }, { key: 'physical', label: 'Physical appearance', rows: 3 },
  { key: 'voiceProfile', label: 'Voice', rows: 2, hint: 'Pitch, pace, accent, texture — used as TTS direction.' },
  { key: 'arc', label: 'Character arc', rows: 2 },
  { key: 'identityPrompt', label: 'Identity token prompt', rows: 4, hint: 'Injected verbatim into every image and video prompt that features this character.' }
];

export function CharactersStage() {
  const project = useProject(s => s.project);
  const characters = useProject(s => s.characters);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const remove = useProject(s => s.deleteEntity);
  const generate = useProject(s => s.generate);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const refresh = useProject(s => s.refresh);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const { confirm, node } = useConfirm();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [approved, setApproved] = React.useState(false);

  const selected = characters.find(c => c.id === selectedId) ?? characters[0] ?? null;
  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const generating = jobs.some(j => j.stage === 'characters' && (j.status === 'queued' || j.status === 'running'));

  React.useEffect(() => { if (!selectedId && characters[0]) setSelectedId(characters[0].id); }, [characters, selectedId]);

  const looks = (c: Character | null): Asset[] => {
    if (!c) return [];
    const ids = [c.lookAssetId, ...(c.looks ?? []).map(l => l.assetId)].filter(Boolean) as string[];
    const found = [...new Set(ids)].map(id => assetById.get(id)).filter(Boolean) as Asset[];
    const byToken = assets.filter(a => a.refIds?.characters?.includes(c.id));
    return [...found, ...byToken.filter(a => !found.some(f => f.id === a.id))];
  };

  const toggleLock = async (c: Character) => {
    const next = !c.locked;
    if (next) {
      const ok = await confirm({
        title: `Lock ${c.name}?`, confirmLabel: 'Lock character',
        body: <>Locking prevents accidental identity changes. Regenerating this character's look will be blocked until you unlock it, and extraction will preserve the locked fields.</>
      });
      if (!ok) return;
    }
    await update<Character>('characters', c.id, { locked: next } as Partial<Character>);
    toast({ level: 'info', title: next ? `${c.name} locked` : `${c.name} unlocked` });
  };

  const approveChar = async (c: Character) => {
    await update<Character>('characters', c.id, { approved: !c.approved } as Partial<Character>);
    toast({ level: 'success', title: c.approved ? `${c.name} unapproved` : `${c.name} approved` });
  };

  const uploadRef = async (c: Character, file: File) => {
    try {
      const fd = new FormData();
      fd.append('files', file); fd.append('projectId', project!.id); fd.append('kind', 'character');
      const r = await upload<{ assets: Asset[] }>('/api/uploads', fd);
      const a = r.assets[0];
      if (!a) throw new Error('Upload produced no asset');
      await update<Character>('characters', c.id, { referenceAssetId: a.id } as Partial<Character>);
      await refresh();
      toast({ level: 'success', title: 'Reference uploaded', body: 'It will be sent with every generation for this character.' });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  const addCharacter = async () => {
    try {
      await useProject.getState().createEntity('characters', {
        name: `Character ${characters.length + 1}`, role: 'supporting', age: '', description: '', personality: '',
        wardrobe: '', physical: '', voiceProfile: '', arc: '', locked: false, approved: false,
        identityPrompt: '', color: '#D99A32', looks: [], scenes: [], referenceAssetId: null, lookAssetId: null,
        token: `character_new_${String(characters.length + 1).padStart(2, '0')}`, projectId: project!.id
      });
      toast({ level: 'success', title: 'Character added' });
    } catch (err) { toast({ level: 'error', title: (err as Error).message }); }
  };

  return (
    <StageFrame
      icon={<Users size={15} />}
      title="Characters"
      subtitle={characters.length ? `${characters.length} character${characters.length === 1 ? '' : 's'} · each with a persistent identity token` : 'Extracted automatically from the screenplay'}
      headerRight={
        <>
          <Button size="sm" variant="ghost" onClick={addCharacter}><Plus size={12} />Add</Button>
          <GenerateBar config={{ action: 'cast', label: 'Extract characters' }} modelKind="text" label="Extract from script" size="sm" />
          <GenerateBar config={{ action: 'character-look', label: 'All character looks', params: { all: true, variations: 3 } }} modelKind="image" label="Generate all looks" size="sm" />
        </>
      }
      asideTitle={selected ? selected.name : 'Inspector'}
      aside={selected ? <CharacterInspector c={selected} editing={editing} setEditing={setEditing} update={update} looks={looks(selected)} /> : undefined}
      footer={characters.length ? (
        <ReviewBar approved={approved} next="world"
          onApprove={async () => {
            setApproved(true);
            for (const c of characters) if (!c.approved) await update<Character>('characters', c.id, { approved: true } as Partial<Character>);
            useProject.getState().markStage('characters', 'approved');
            await takeSnapshot('Characters approved');
            toast({ level: 'success', title: 'Cast approved', body: 'Identities are locked in for every downstream generation.' });
          }}
          onRegenerate={() => void generate('cast', {})}
          note={<>{characters.filter(c => c.approved).length}/{characters.length} approved · {characters.filter(c => c.locked).length} locked</>} />
      ) : undefined}>
      {node}
      <div className="p-4 xl:p-6">
        {!characters.length && generating && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="tile-skeleton h-[300px]" />)}</div>
        )}
        {!characters.length && !generating && (
          <EmptyState icon={<Users size={17} />} title="No characters yet"
            body={<>Extract the cast from your screenplay. Every character gets a persistent identity — name, wardrobe, physical description, voice profile and an <strong className="text-ink2">identity token</strong> that is injected into every image and video prompt, so faces stay consistent across the whole film.</>}
            action={<GenerateBar config={{ action: 'cast', label: 'Extract characters' }} modelKind="text" label="Extract characters" />}
            secondary={<Button size="sm" onClick={addCharacter}><Plus size={12} />Add manually</Button>} />
        )}

        {characters.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {characters.map((c, i) => {
              const cLooks = looks(c);
              const busy = jobs.some(j => j.status === 'running' && j.input && (j.input as any)?.target?.id === c.id);
              return (
                <CharacterCard key={c.id} c={c} looks={cLooks} index={i} busy={busy}
                  selected={selected?.id === c.id} onSelect={() => setSelectedId(c.id)}
                  onLock={() => void toggleLock(c)} onApprove={() => void approveChar(c)}
                  onGenerate={async () => {
                    if (c.locked) {
                      const ok = await confirm({ title: `${c.name} is locked`, tone: 'danger', confirmLabel: 'Unlock and regenerate', body: <>Locking exists to prevent identity drift. Regenerating will produce a new look; the previous one stays in the gallery.</> });
                      if (!ok) return;
                      await update<Character>('characters', c.id, { locked: false } as Partial<Character>);
                    }
                    await generate('character-look', { characterId: c.id, variations: 3 });
                  }}
                  onUpload={f => void uploadRef(c, f)} />
              );
            })}
          </div>
        )}

        {characters.length > 0 && (
          <div className="mt-5"><StageNote tone="info" title="Identity consistency">
            <code className="mono text-ink2">{selected?.token ?? 'character_…'}</code> is this character's identity token. The
            storyboard, shot and video prompts all include the identity prompt automatically — you never have to re-describe
            the character, and locking prevents a regeneration from silently changing who they are.
          </StageNote></div>
        )}
      </div>
    </StageFrame>
  );
}

function CharacterCard({ c, looks, index, selected, onSelect, onLock, onApprove, onGenerate, onUpload, busy }: {
  c: Character; looks: Asset[]; index: number; selected: boolean; busy: boolean;
  onSelect: () => void; onLock: () => void; onApprove: () => void; onGenerate: () => void; onUpload: (f: File) => void;
}) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const hero = looks[0] ?? (c.referenceAssetId ? looks[0] : null);
  return (
    <Card hover className={cx('group relative overflow-hidden', selected && 'border-accent/45 shadow-glow')}>
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="relative">
          <AssetThumb asset={hero} ratio="4/3" className="rounded-none border-0" fallbackLabel="No look generated" />
          {busy && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 backdrop-blur-[2px]">
              <Skeleton className="h-1 w-24" />
              <span className="text-[10px] text-accent-bright">Generating look…</span>
            </div>
          )}
          <span className="absolute left-2 top-2 flex items-center gap-1">
            {c.approved && <Badge tone="ok"><Check size={9} />approved</Badge>}
            {c.locked && <Badge tone="accent"><Lock size={9} />locked</Badge>}
          </span>
          <span className="absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-ink2 backdrop-blur">{c.token}</span>
        </div>
        <div className="p-3">
          <div className="flex items-start gap-2">
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: c.color, boxShadow: `0 0 8px ${c.color}88` }} />
            <div className="min-w-0 flex-1">
              <h3 className="truncate text-[13px] font-semibold text-ink">{c.name || `Character ${index + 1}`}</h3>
              <p className="truncate text-[10.5px] text-ink3">{[c.role, c.age].filter(Boolean).join(' · ') || 'role unspecified'}</p>
            </div>
          </div>
          {c.personality && <p className="mt-2 line-clamp-2 text-[11px] leading-snug text-ink2">{c.personality}</p>}
          <div className="mt-2.5 flex items-center gap-1.5 text-[10px] text-ink3">
            <span>{looks.length} look{looks.length === 1 ? '' : 's'}</span>
            {c.referenceAssetId && <Badge tone="mut">reference</Badge>}
            {looks.some(a => a.demo) && <PrevisBadge />}
          </div>
        </div>
      </button>
      <div className="flex items-center gap-1 border-t border-line-soft px-2 py-1.5">
        <Button size="xs" variant="ghost" onClick={onGenerate} loading={busy}><Sparkles size={11} />Generate look</Button>
        <div className="flex-1" />
        <Tip label={c.approved ? 'Unapprove' : 'Approve'}>
          <button type="button" className={cx('icon-btn h-6 w-6', c.approved && 'text-ok')} onClick={onApprove}><Check size={12} /></button>
        </Tip>
        <Tip label={c.locked ? 'Unlock identity' : 'Lock identity'}>
          <button type="button" className={cx('icon-btn h-6 w-6', c.locked && 'text-accent-bright')} onClick={onLock}>{c.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
        </Tip>
        <Tip label="Upload reference image">
          <button type="button" className="icon-btn h-6 w-6" onClick={() => fileRef.current?.click()}><Upload size={12} /></button>
        </Tip>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
      </div>
    </Card>
  );
}

function CharacterInspector({ c, editing, setEditing, update, looks }: {
  c: Character; editing: boolean; setEditing: (v: boolean) => void;
  update: ReturnType<typeof useProject.getState>['updateEntity']; looks: Asset[];
}) {
  const [local, setLocal] = React.useState<Character>(c);
  React.useEffect(() => setLocal(c), [c.id]);
  const save = async () => {
    const patch: Partial<Character> = {};
    for (const f of FIELDS) if (String(local[f.key] ?? '') !== String(c[f.key] ?? '')) (patch as Record<string, unknown>)[f.key as string] = local[f.key];
    if (Object.keys(patch).length) await update<Character>('characters', c.id, patch);
    setEditing(false);
  };

  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Badge tone={c.approved ? 'ok' : 'mut'}>{c.approved ? 'approved' : 'draft'}</Badge>
        {c.locked && <Badge tone="accent"><Lock size={9} />locked</Badge>}
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={() => setEditing(!editing)}>
          {editing ? <><X size={11} />Cancel</> : <><Pencil size={11} />Edit</>}
        </Button>
      </div>

      <AssetThumb asset={looks[0]} ratio="4/3" />
      {looks.length > 1 && (
        <div className="grid grid-cols-4 gap-1">
          {looks.slice(0, 8).map(a => <AssetThumb key={a.id} asset={a} ratio="1/1" className="cursor-pointer" />)}
        </div>
      )}

      <div className="rounded-md border border-line-soft bg-well px-2.5 py-2">
        <div className="label mb-1">Identity token</div>
        <code className="mono block truncate text-[10.5px] text-accent-bright">{c.token}</code>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">Automatically appended to every prompt that features this character.</p>
      </div>

      {editing ? (
        <div className="space-y-2.5">
          {FIELDS.map(f => (
            <Field key={String(f.key)} label={f.label} hint={f.hint}>
              {f.rows ? (
                <TextArea rows={f.rows} value={String(local[f.key] ?? '')} onChange={e => setLocal({ ...local, [f.key]: e.target.value } as Character)} />
              ) : (
                <TextInput value={String(local[f.key] ?? '')} onChange={e => setLocal({ ...local, [f.key]: e.target.value } as Character)} />
              )}
            </Field>
          ))}
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" className="flex-1" onClick={() => void save()}><Check size={12} />Save</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {FIELDS.filter(f => String(c[f.key] ?? '')).map(f => (
            <div key={String(f.key)}>
              <div className="label mt-2">{f.label}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink2">{String(c[f.key])}</p>
            </div>
          ))}
          <div className="mt-3 border-t border-line-soft pt-2">
            <MetaRow label="Scenes">{c.scenes?.length ?? 0}</MetaRow>
            <MetaRow label="Looks">{looks.length}</MetaRow>
            <MetaRow label="Reference">{c.referenceAssetId ? 'attached' : 'none'}</MetaRow>
          </div>
        </div>
      )}
    </div>
  );
}
