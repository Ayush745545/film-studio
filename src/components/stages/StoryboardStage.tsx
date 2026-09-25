'use client';
import * as React from 'react';
import { LayoutGrid, Check, RefreshCw, Camera, Sparkles, Film, Eye } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { AssetThumb, ThumbActions } from './AssetThumb';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge, Segmented } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select } from '@/components/ui/inputs';
import { Modal } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { IMAGE_PRESETS } from '@/lib/ai/registry';
import { LENSES } from '@/types';
import type { Asset, Shot } from '@/types';

const SIZES = ['Extreme Wide', 'Wide', 'Full', 'Medium Wide', 'Medium', 'Medium Close', 'Close-up', 'Extreme Close-up', 'Over Shoulder', 'POV', 'Insert', 'Two Shot'];
const MOVES = ['Static', 'Pan', 'Tilt', 'Dolly', 'Dolly In', 'Dolly Out', 'Truck', 'Crane', 'Handheld', 'Steadicam', 'Slow Push', 'Pull Back', 'Whip Pan', 'Orbit', 'Zoom', 'Rack Focus', 'Aerial'];
const LIGHTING = ['low-key practicals, deep shadow', 'cold morning blue', 'sodium-vapour amber', 'hard backlight silhouette', 'soft overcast diffusion', 'neon spill magenta/cyan', 'firelight', 'single overhead fluorescent'];

export function StoryboardStage() {
  const project = useProject(s => s.project);
  const scenes = useProject(s => s.scenes);
  const shots = useProject(s => s.shots);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const setStage = useProject(s => s.setStage);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [filter, setFilter] = React.useState<'all' | 'missing' | 'approved' | 'rejected'>('all');
  const [sceneFilter, setSceneFilter] = React.useState<string>('');
  const [detail, setDetail] = React.useState<Shot | null>(null);
  const [lightbox, setLightbox] = React.useState<Asset | null>(null);
  const [busyIds, setBusyIds] = React.useState<Set<string>>(new Set());

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const frameOf = (s: Shot): Asset | null => (s.frameAssetId ? assetById.get(s.frameAssetId) ?? null : null);
  const variationsOf = (s: Shot): Asset[] => (s.variations ?? []).map(id => assetById.get(id)).filter(Boolean) as Asset[];

  const shown = shots
    .filter(s => !sceneFilter || s.sceneId === sceneFilter)
    .filter(s => filter === 'all' ? true
      : filter === 'missing' ? !s.frameAssetId
      : filter === 'approved' ? s.frameStatus === 'approved'
      : s.frameStatus === 'rejected')
    .sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.index - b.index);

  const grouped = React.useMemo(() => {
    const m = new Map<string, Shot[]>();
    for (const s of shown) { const arr = m.get(s.sceneId) ?? []; arr.push(s); m.set(s.sceneId, arr); }
    return [...m.entries()];
  }, [shown]);

  // live busy state from the queue
  React.useEffect(() => {
    const next = new Set<string>();
    for (const j of jobs) {
      if ((j.status === 'queued' || j.status === 'running') && j.stage === 'storyboard') {
        const id = (j.input as any)?.target?.id;
        if (id) next.add(id);
      }
    }
    setBusyIds(next);
  }, [jobs]);

  const setMany = async (ids: string[], patch: Partial<Shot>) => {
    await Promise.all(ids.map(id => update<Shot>('shots', id, patch)));
  };
  const approveAll = async () => {
    const ids = shown.filter(s => s.frameAssetId && s.frameStatus !== 'approved').map(s => s.id);
    if (!ids.length) { toast({ level: 'info', title: 'Nothing to approve' }); return; }
    await setMany(ids, { frameStatus: 'approved' } as Partial<Shot>);
    await takeSnapshot('Storyboard approved');
    useProject.getState().markStage('storyboard', 'approved');
    toast({ level: 'success', title: `${ids.length} frame(s) approved`, body: 'These become the start frames for video generation.' });
  };

  const approved = shots.filter(s => s.frameStatus === 'approved').length;
  const withFrames = shots.filter(s => s.frameAssetId).length;

  return (
    <StageFrame
      icon={<LayoutGrid size={15} />}
      title="Storyboard"
      subtitle={shots.length ? `${withFrames}/${shots.length} frames generated · ${approved} approved` : 'Visual frames per shot — approve, reject or regenerate'}
      headerRight={
        <>
          <Segmented size="sm" value={filter} onChange={setFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'missing', label: 'Missing' }, { value: 'approved', label: 'Approved' }, { value: 'rejected', label: 'Rejected' }]} />
          <Select size="sm" className="w-[150px]" value={sceneFilter} onChange={setSceneFilter} placeholder="All scenes"
            options={scenes.map(s => ({ value: s.id, label: `SC ${String(s.index).padStart(2, '0')} · ${s.locationName}` }))} />
          <GenerateBar config={{ action: 'frames', label: 'All storyboard frames', params: filter === 'missing' ? { missingOnly: true } : {} }} modelKind="image" label="Generate frames" size="sm" />
        </>
      }
      asideTitle="Batch"
      aside={
        <div className="space-y-3 p-3">
          <div className="space-y-1.5">
            <div className="label">Batch generation</div>
            <GenerateBar config={{ action: 'frames', label: '4 variations each', params: { variations: 4 } }} modelKind="image" label="4 variations per shot" size="xs" variant="default" />
            <GenerateBar config={{ action: 'frames', label: '8 variations each', params: { variations: 8 } }} modelKind="image" label="8 variations per shot" size="xs" variant="default" />
            <GenerateBar config={{ action: 'frames', label: 'Missing frames only', params: { missingOnly: true } }} modelKind="image" label="Only missing frames" size="xs" variant="default" />
          </div>
          <div className="rounded-md border border-line-soft bg-well p-2.5">
            <div className="label mb-1.5">Coverage</div>
            <div className="space-y-1 text-[10.5px]">
              <Bar label="Frames" value={withFrames} max={shots.length} />
              <Bar label="Approved" value={approved} max={shots.length} tone="ok" />
              <Bar label="Rejected" value={shots.filter(s => s.frameStatus === 'rejected').length} max={shots.length} tone="bad" />
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="label">Selection</div>
            <Button size="xs" variant="ghost" className="w-full justify-start" onClick={approveAll}><Check size={11} />Approve every rendered frame</Button>
            <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => void setMany(shown.filter(s => s.frameAssetId).map(s => s.id), { frameStatus: 'ready' } as Partial<Shot>)}><RefreshCw size={11} />Clear approvals</Button>
            <Button size="xs" variant="ghost" className="w-full justify-start" onClick={() => setStage('video')}><Film size={11} />Go to video generation</Button>
          </div>
          <StageNote tone="info" title="Frames become video inputs">
            An approved frame is sent as the start frame for that shot's video generation, so composition and character
            identity carry into motion instead of being re-invented.
          </StageNote>
        </div>
      }
      footer={shots.length ? (
        <ReviewBar approved={approved > 0 && approved === withFrames} next="video"
          onApprove={approveAll}
          onRegenerate={() => void generate('frames', {})}
          note={<>{approved} of {withFrames} rendered frames approved · {shots.length - withFrames} shot(s) still need a frame</>} />
      ) : undefined}>
      <div className="p-4 xl:p-6">
        {!shots.length && (
          <EmptyState icon={<LayoutGrid size={17} />} title="No storyboards yet"
            body="Generate your first storyboard from the scene breakdown. Each shot gets a frame rendered with its own camera, lens, lighting and the character/location identity prompts."
            action={<Button size="sm" variant="primary" onClick={() => setStage('scenes')}><Sparkles size={12} />Open scene breakdown</Button>} />
        )}

        {shots.length > 0 && !grouped.length && (
          <EmptyState icon={<Eye size={17} />} title="No frames match this filter"
            body="Clear the filter, or generate frames for the shots that are still missing them."
            action={<Button size="sm" onClick={() => { setFilter('all'); setSceneFilter(''); }}>Clear filters</Button>} />
        )}

        {grouped.map(([sceneId, scShots]) => {
          const sc = scenes.find(s => s.id === sceneId);
          return (
            <section key={sceneId} className="mb-6">
              <header className="mb-2.5 flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded border border-accent/25 bg-accent/[0.08] font-mono text-[10px] font-bold text-accent-bright">
                  {String(sc?.index ?? 0).padStart(2, '0')}
                </span>
                <h2 className="font-mono text-[12px] font-semibold uppercase tracking-wide text-ink">{sc?.heading ?? 'Scene'}</h2>
                <Badge tone="mut">{scShots.length} frames</Badge>
                {sc?.emotion && <Badge tone="mut">{sc.emotion}</Badge>}
                <div className="flex-1" />
                <GenerateBar config={{ action: 'frames', label: `Frames · SC ${sc?.index}`, params: { sceneId } }} modelKind="image" label="This scene" size="xs" variant="default" />
                <Button size="xs" variant="ghost" onClick={() => void setMany(scShots.filter(s => s.frameAssetId).map(s => s.id), { frameStatus: 'approved' } as Partial<Shot>)}><Check size={11} />Approve scene</Button>
              </header>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {scShots.map(shot => {
                  const frame = frameOf(shot);
                  const busy = busyIds.has(shot.id);
                  return (
                    <Card key={shot.id} hover className={cx('group overflow-hidden', shot.frameStatus === 'approved' && 'border-ok/40', shot.frameStatus === 'rejected' && 'border-bad/35 opacity-70')}>
                      <div className="relative">
                        <AssetThumb asset={frame} ratio="16/9" className="rounded-none border-0" fallbackLabel={busy ? 'Rendering…' : 'No frame'} />
                        {busy && (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/72 backdrop-blur-[2px]">
                            <Skeleton className="h-1 w-2/3" />
                            <span className="text-[10px] text-accent-bright">Rendering {shot.size.toLowerCase()} {shot.lens}…</span>
                          </div>
                        )}
                        <ThumbActions status={shot.frameStatus} busy={busy}
                          onSelect={() => setDetail(shot)}
                          onApprove={() => void update<Shot>('shots', shot.id, { frameStatus: shot.frameStatus === 'approved' ? 'ready' : 'approved' } as Partial<Shot>)}
                          onReject={() => void update<Shot>('shots', shot.id, { frameStatus: 'rejected' } as Partial<Shot>)}
                          onRegenerate={() => void generate('frames', { shotId: shot.id, variations: 1 })}
                          onOpen={() => frame && setLightbox(frame)} />
                        <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-ink2 backdrop-blur">
                          SH {String(shot.index).padStart(2, '0')} · {shot.size} · {shot.lens}
                        </span>
                      </div>
                      <div className="space-y-1.5 p-2.5">
                        <div className="flex items-center gap-1.5">
                          <Select size="sm" className="flex-1" value={shot.size} onChange={v => void update<Shot>('shots', shot.id, { size: v } as Partial<Shot>)} options={SIZES} />
                          <Select size="sm" className="w-[86px]" value={shot.lens} onChange={v => void update<Shot>('shots', shot.id, { lens: v } as Partial<Shot>)} options={[...LENSES]} />
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Select size="sm" className="flex-1" value={shot.move} onChange={v => void update<Shot>('shots', shot.id, { move: v } as Partial<Shot>)} options={MOVES} />
                          <span className="w-[46px] shrink-0 text-right font-mono text-[10px] text-ink3 tnum">{shot.durationSec.toFixed(1)}s</span>
                        </div>
                        <p className="line-clamp-2 text-[10.5px] leading-snug text-ink3">{shot.description || shot.notes}</p>
                        {variationsOf(shot).length > 0 && (
                          <div className="flex gap-1 pt-0.5">
                            {variationsOf(shot).slice(0, 4).map(v => (
                              <button key={v.id} type="button" onClick={() => setLightbox(v)} className="w-1/4">
                                <AssetThumb asset={v} ratio="1/1" animate="none" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      {/* shot detail / prompt editor */}
      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} width={720}
        title={detail ? `Shot ${detail.index} · ${detail.size} ${detail.lens}` : ''}
        sub={detail ? scenes.find(s => s.id === detail.sceneId)?.heading : undefined}
        footer={detail ? (
          <>
            <Button variant="ghost" onClick={() => setDetail(null)}>Close</Button>
            <GenerateBar config={{ action: 'frames', label: 'Regenerate frame', params: { shotId: detail.id, variations: 4 } }} modelKind="image" label="Regenerate 4" />
          </>
        ) : undefined}>
        {detail && <ShotEditor shot={detail} asset={frameOf(detail)} onSave={async p => { await update<Shot>('shots', detail.id, p); setDetail({ ...detail, ...p }); }} />}
      </Modal>

      <Modal open={Boolean(lightbox)} onClose={() => setLightbox(null)} width={1000} title={lightbox?.name} sub={lightbox?.prompt}>
        {lightbox && (
          <div className="space-y-3">
            <AssetThumb asset={lightbox} ratio="16/9" animate="none" className="w-full" />
            <div className="grid gap-2 sm:grid-cols-2">
              <div><div className="label mb-1">Prompt</div><p className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] leading-relaxed text-ink2">{lightbox.prompt}</p></div>
              <div className="space-y-1">
                <div className="label">Metadata</div>
                <p className="text-[11px] text-ink2">Seed <span className="mono">{lightbox.seed}</span></p>
                <p className="text-[11px] text-ink2">{lightbox.width}×{lightbox.height} · {lightbox.mimeType}</p>
                <p className="text-[11px] text-ink2">Model {lightbox.modelId ?? '—'}</p>
                {lightbox.demo && <PrevisBadge label="PREVIS PLATE" />}
                <a className="btn btn-xs mt-2" href={lightbox.url} download={lightbox.name} target="_blank" rel="noreferrer">Download</a>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </StageFrame>
  );
}

function ShotEditor({ shot, asset, onSave }: { shot: Shot; asset: Asset | null; onSave: (p: Partial<Shot>) => Promise<void> }) {
  const [f, setF] = React.useState(shot);
  React.useEffect(() => setF(shot), [shot.id]);
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <div className="space-y-2">
        <AssetThumb asset={asset} ratio="16/9" animate="always" />
        <div className="grid grid-cols-2 gap-2">
          <Field label="Size"><Select size="sm" value={f.size} onChange={v => setF({ ...f, size: v as Shot['size'] })} options={SIZES} /></Field>
          <Field label="Lens"><Select size="sm" value={f.lens} onChange={v => setF({ ...f, lens: v })} options={[...LENSES]} /></Field>
          <Field label="Movement"><Select size="sm" value={f.move} onChange={v => setF({ ...f, move: v as Shot['move'] })} options={MOVES} /></Field>
          <Field label="Angle"><TextInput value={f.angle} onChange={e => setF({ ...f, angle: e.target.value })} /></Field>
          <Field label="Duration"><TextInput type="number" step={0.5} min={0.5} max={60} value={f.durationSec} onChange={e => setF({ ...f, durationSec: Number(e.target.value) })} /></Field>
          <Field label="Seed"><TextInput type="number" value={f.seed} onChange={e => setF({ ...f, seed: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Lighting">
          <Select size="sm" value={f.lighting} onChange={v => setF({ ...f, lighting: v })} placeholder="Choose a lighting setup" options={LIGHTING} />
        </Field>
        <Button size="sm" variant="primary" className="w-full" onClick={() => void onSave({ size: f.size, lens: f.lens, move: f.move, angle: f.angle, durationSec: f.durationSec, seed: f.seed, lighting: f.lighting, description: f.description, prompt: f.prompt, negativePrompt: f.negativePrompt, notes: f.notes })}>
          <Check size={12} />Save shot
        </Button>
      </div>
      <div className="space-y-2.5">
        <Field label="Shot description" hint="What happens in frame. Feeds the image prompt.">
          <TextArea rows={3} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} />
        </Field>
        <Field label="Image prompt" hint="Sent verbatim to the image model. Character and location identity prompts are already included.">
          <TextArea rows={7} value={f.prompt} onChange={e => setF({ ...f, prompt: e.target.value })} className="mono text-[11px]" />
        </Field>
        <Field label="Negative prompt">
          <TextArea rows={2} value={f.negativePrompt} onChange={e => setF({ ...f, negativePrompt: e.target.value })} className="mono text-[11px]" />
        </Field>
        <Field label="Dialogue in this shot">
          <TextArea rows={2} value={f.dialogue} onChange={e => setF({ ...f, dialogue: e.target.value })} />
        </Field>
        <Field label="Notes">
          <TextInput value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {IMAGE_PRESETS.slice(0, 6).map(p => (
            <Tip key={p.id} label={p.prompt.slice(0, 90)}>
              <Button size="xs" variant="ghost" onClick={() => setF({ ...f, prompt: `${f.prompt.split('. ').slice(0, -1).join('. ')}. ${p.prompt}` })}>
                <Camera size={10} />{p.label}
              </Button>
            </Tip>
          ))}
        </div>
      </div>
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone?: 'ok' | 'bad' }) {
  const pct = max ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-[58px] shrink-0 text-ink3">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
        <span className={cx('block h-full rounded-full', tone === 'ok' ? 'bg-ok' : tone === 'bad' ? 'bg-bad' : 'bg-gradient-to-r from-accent-dim to-accent')} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-8 shrink-0 text-right text-ink2 tnum">{value}/{max}</span>
    </div>
  );
}
