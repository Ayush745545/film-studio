'use client';
import * as React from 'react';
import { Map as MapIcon, Lock, Unlock, Check, Pencil, X, Palette, Cloud, Sun, Building2 } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { AssetThumb } from './AssetThumb';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge } from '@/components/ui/primitives';
import { Field, TextInput, TextArea } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import type { Asset, Location } from '@/types';

export function WorldStage() {
  const project = useProject(s => s.project);
  const locations = useProject(s => s.locations);
  const scenes = useProject(s => s.scenes);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const { confirm, node } = useConfirm();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [approved, setApproved] = React.useState(false);

  const selected = locations.find(l => l.id === selectedId) ?? locations[0] ?? null;
  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const generating = jobs.some(j => j.stage === 'world' && (j.status === 'queued' || j.status === 'running'));
  React.useEffect(() => { if (!selectedId && locations[0]) setSelectedId(locations[0].id); }, [locations, selectedId]);

  const scenesIn = (l: Location) => scenes.filter(s => s.locationId === l.id || s.locationName.toUpperCase() === l.name.toUpperCase());

  const toggleLock = async (l: Location) => {
    const next = !l.locked;
    if (next) {
      const ok = await confirm({ title: `Lock ${l.name}?`, confirmLabel: 'Lock environment', body: <>Locking keeps the environment consistent. Regeneration is blocked until you unlock it, so a later shot can't silently change the room.</> });
      if (!ok) return;
    }
    await update<Location>('locations', l.id, { locked: next } as Partial<Location>);
    toast({ level: 'info', title: next ? `${l.name} locked` : `${l.name} unlocked` });
  };

  return (
    <StageFrame
      icon={<MapIcon size={15} />}
      title="World & Locations"
      subtitle={locations.length ? `${locations.length} location${locations.length === 1 ? '' : 's'} designed for consistency` : 'Extracted from the screenplay slug lines'}
      headerRight={
        <>
          <GenerateBar config={{ action: 'world', label: 'Extract locations' }} modelKind="text" label="Extract from script" size="sm" />
          <GenerateBar config={{ action: 'location-image', label: 'All environment plates', params: { all: true, variations: 2 } }} modelKind="image" label="Generate all plates" size="sm" />
        </>
      }
      asideTitle={selected?.name ?? 'Inspector'}
      aside={selected ? <LocationInspector l={selected} editing={editing} setEditing={setEditing} update={update} asset={selected.assetId ? assetById.get(selected.assetId) ?? null : null} scenes={scenesIn(selected).length} /> : undefined}
      footer={locations.length ? (
        <ReviewBar approved={approved} next="scenes"
          onApprove={async () => { setApproved(true); for (const l of locations) if (!l.approved) await update<Location>('locations', l.id, { approved: true } as Partial<Location>); useProject.getState().markStage('world', 'approved'); await takeSnapshot('Locations approved'); }}
          onRegenerate={() => void generate('world', {})}
          note={<>{locations.filter(l => l.approved).length}/{locations.length} approved · {locations.filter(l => l.locked).length} locked</>} />
      ) : undefined}>
      {node}
      <div className="p-4 xl:p-6">
        {project?.worldBible && (
          <Card hover={false} className="mb-4 p-4">
            <div className="label mb-2">World bible</div>
            <div className="grid gap-3 text-[11.5px] leading-relaxed text-ink2 sm:grid-cols-2">
              {project.worldBible.era && <p><span className="text-ink3">Era · </span>{project.worldBible.era}</p>}
              {project.worldBible.geography && <p><span className="text-ink3">Geography · </span>{project.worldBible.geography}</p>}
              {project.worldBible.rules && <p className="sm:col-span-2"><span className="text-ink3">Rules · </span>{project.worldBible.rules}</p>}
              {project.worldBible.moodBoard && <p className="sm:col-span-2"><span className="text-ink3">Mood board · </span>{project.worldBible.moodBoard}</p>}
            </div>
          </Card>
        )}

        {!locations.length && generating && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="tile-skeleton h-[260px]" />)}</div>}
        {!locations.length && !generating && (
          <EmptyState icon={<MapIcon size={17} />} title="No locations yet"
            body={<>Extract locations from the screenplay. Each one gets architecture, time of day, lighting, weather, a colour palette, props and an identity prompt that keeps the environment consistent across every shot.</>}
            action={<GenerateBar config={{ action: 'world', label: 'Extract locations' }} modelKind="text" label="Extract locations" />} />
        )}

        {locations.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {locations.map(l => {
              const refs = [...(l.referenceAssetIds ?? []), l.assetId].filter(Boolean) as string[];
              const thumbs = [...new Set(refs)].map(id => assetById.get(id)).filter(Boolean) as Asset[];
              const busy = jobs.some(j => j.status === 'running' && (j.input as any)?.target?.id === l.id);
              return (
                <Card key={l.id} hover className={cx('group overflow-hidden', selected?.id === l.id && 'border-accent/45 shadow-glow')}>
                  <button type="button" onClick={() => setSelectedId(l.id)} className="block w-full text-left">
                    <div className="relative">
                      <AssetThumb asset={thumbs[0]} ratio="16/9" className="rounded-none border-0" fallbackLabel="No environment plate" />
                      {busy && <div className="absolute inset-0 flex items-center justify-center bg-black/70"><span className="text-[10px] text-accent-bright">Rendering plate…</span></div>}
                      <span className="absolute left-2 top-2 flex gap-1">
                        {l.approved && <Badge tone="ok"><Check size={9} />approved</Badge>}
                        {l.locked && <Badge tone="accent"><Lock size={9} />locked</Badge>}
                      </span>
                      <span className="absolute bottom-2 left-2 rounded bg-black/65 px-1.5 py-0.5 font-mono text-[9px] text-ink2 backdrop-blur">{l.token}</span>
                    </div>
                    <div className="p-3">
                      <h3 className="truncate text-[13px] font-semibold text-ink">{l.name}</h3>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-ink2">{l.description || 'No description yet.'}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-ink3">
                        {l.timeOfDay && <span className="flex items-center gap-1"><Sun size={9} />{l.timeOfDay}</span>}
                        {l.weather && <span className="flex items-center gap-1"><Cloud size={9} />{l.weather}</span>}
                        <span className="flex items-center gap-1"><Building2 size={9} />{scenesIn(l).length} scene{scenesIn(l).length === 1 ? '' : 's'}</span>
                        {thumbs.some(t => t.demo) && <PrevisBadge />}
                      </div>
                      {l.palette?.length > 0 && (
                        <div className="mt-2 flex gap-0.5 overflow-hidden rounded">
                          {l.palette.slice(0, 8).map((c, i) => <span key={i} className="h-3 flex-1" style={{ background: c }} title={c} />)}
                        </div>
                      )}
                    </div>
                  </button>
                  <div className="flex items-center gap-1 border-t border-line-soft px-2 py-1.5">
                    <GenerateBar config={{ action: 'location-image', label: `Plate · ${l.name}`, params: { locationId: l.id, variations: 2 } }} modelKind="image" label="Generate plate" size="xs" />
                    <div className="flex-1" />
                    <Tip label={l.locked ? 'Unlock' : 'Lock environment'}>
                      <button type="button" className={cx('icon-btn h-6 w-6', l.locked && 'text-accent-bright')} onClick={() => void toggleLock(l)}>{l.locked ? <Lock size={12} /> : <Unlock size={12} />}</button>
                    </Tip>
                    <Tip label={l.approved ? 'Unapprove' : 'Approve'}>
                      <button type="button" className={cx('icon-btn h-6 w-6', l.approved && 'text-ok')} onClick={() => void update<Location>('locations', l.id, { approved: !l.approved } as Partial<Location>)}><Check size={12} /></button>
                    </Tip>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {locations.length > 0 && (
          <div className="mt-5"><StageNote tone="info" title="Environment consistency">
            The location identity prompt is injected into every shot that takes place there, alongside the character
            identity prompts. Lock a location once you are happy with the plate and later shots cannot drift.
          </StageNote></div>
        )}
      </div>
    </StageFrame>
  );
}

function LocationInspector({ l, editing, setEditing, update, asset, scenes }: {
  l: Location; editing: boolean; setEditing: (v: boolean) => void;
  update: ReturnType<typeof useProject.getState>['updateEntity']; asset: Asset | null; scenes: number;
}) {
  const [local, setLocal] = React.useState(l);
  React.useEffect(() => setLocal(l), [l.id]);
  const save = async () => {
    const patch: Partial<Location> = {};
    for (const k of ['name', 'description', 'architecture', 'timeOfDay', 'lighting', 'weather', 'identityPrompt'] as const) {
      if (String(local[k] ?? '') !== String(l[k] ?? '')) (patch as Record<string, unknown>)[k] = local[k];
    }
    if (JSON.stringify(local.palette) !== JSON.stringify(l.palette)) patch.palette = local.palette;
    if (JSON.stringify(local.props) !== JSON.stringify(l.props)) patch.props = local.props;
    if (Object.keys(patch).length) await update<Location>('locations', l.id, patch);
    setEditing(false);
  };
  const rows: { key: keyof Location; label: string; rows?: number }[] = [
    { key: 'name', label: 'Name' }, { key: 'description', label: 'Description', rows: 3 },
    { key: 'architecture', label: 'Architecture', rows: 2 }, { key: 'timeOfDay', label: 'Time of day' },
    { key: 'lighting', label: 'Lighting', rows: 2 }, { key: 'weather', label: 'Weather' },
    { key: 'identityPrompt', label: 'Identity prompt', rows: 4 }
  ];
  return (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Badge tone={l.approved ? 'ok' : 'mut'}>{l.approved ? 'approved' : 'draft'}</Badge>
        {l.locked && <Badge tone="accent"><Lock size={9} />locked</Badge>}
        <div className="flex-1" />
        <Button size="xs" variant="ghost" onClick={() => (editing ? setEditing(false) : setEditing(true))}>
          {editing ? <><X size={11} />Cancel</> : <><Pencil size={11} />Edit</>}
        </Button>
      </div>
      <AssetThumb asset={asset} ratio="16/9" animate="always" />
      {editing ? (
        <div className="space-y-2.5">
          {rows.map(r => (
            <Field key={String(r.key)} label={r.label}>
              {r.rows ? <TextArea rows={r.rows} value={String(local[r.key] ?? '')} onChange={e => setLocal({ ...local, [r.key]: e.target.value } as Location)} />
                : <TextInput value={String(local[r.key] ?? '')} onChange={e => setLocal({ ...local, [r.key]: e.target.value } as Location)} />}
            </Field>
          ))}
          <Field label="Palette (comma separated hex)">
            <TextInput value={(local.palette ?? []).join(', ')} onChange={e => setLocal({ ...local, palette: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Props (comma separated)">
            <TextInput value={(local.props ?? []).join(', ')} onChange={e => setLocal({ ...local, props: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} />
          </Field>
          <Button size="sm" variant="primary" className="w-full" onClick={() => void save()}><Check size={12} />Save</Button>
        </div>
      ) : (
        <div>
          {rows.filter(r => String(l[r.key] ?? '')).map(r => (
            <div key={String(r.key)} className="border-b border-line-soft/60 py-1.5 last:border-0">
              <div className="label flex items-center gap-1">{r.key === 'architecture' && <Building2 size={9} />}{r.label}</div>
              <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-relaxed text-ink2">{String(l[r.key])}</p>
            </div>
          ))}
          {l.palette?.length > 0 && (
            <div className="py-1.5">
              <div className="label mb-1.5 flex items-center gap-1"><Palette size={9} />Colour palette</div>
              <div className="flex flex-wrap gap-1">
                {l.palette.map(c => <span key={c} className="flex items-center gap-1 rounded border border-line-soft bg-well py-0.5 pl-0.5 pr-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: c }} /><code className="mono text-[9px] text-ink3">{c}</code></span>)}
              </div>
            </div>
          )}
          {l.props?.length > 0 && (
            <div className="py-1.5">
              <div className="label mb-1">Props</div>
              <div className="flex flex-wrap gap-1">{l.props.map(p => <Badge key={p} tone="mut">{p}</Badge>)}</div>
            </div>
          )}
          <div className="mt-2 border-t border-line-soft pt-2 text-[10.5px] text-ink3">{scenes} scene{scenes === 1 ? '' : 's'} use this location.</div>
        </div>
      )}
    </div>
  );
}
