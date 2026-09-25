'use client';
import * as React from 'react';
import { Video as VideoIcon, Play, Check, RotateCcw, Upload, X, Layers } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { AssetThumb } from './AssetThumb';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge, Segmented } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Slider } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { upload, describeError } from '@/lib/client/api';
import { MOTION_PRESETS, CAMERA_PRESETS } from '@/lib/ai/registry';
import { formatSeconds } from '@/lib/client/ids';
import type { Asset, Shot } from '@/types';

export function VideoStage() {
  const project = useProject(s => s.project);
  const shots = useProject(s => s.shots);
  const scenes = useProject(s => s.scenes);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const setStage = useProject(s => s.setStage);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [mode, setMode] = React.useState<'shots' | 'freeform'>('shots');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [lightbox, setLightbox] = React.useState<Asset | null>(null);

  // freeform panel state
  const [ff, setFf] = React.useState({
    prompt: '', negative: '', duration: 5, aspect: project?.settings.format ?? '16:9',
    resolution: project?.settings.resolution ?? '1080p', motion: 'Cinematic', camera: 'Dolly', seed: 0,
    startFrame: null as Asset | null, endFrame: null as Asset | null, ref: null as Asset | null
  });

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const selected = shots.find(s => s.id === selectedId) ?? null;
  const withFrames = shots.filter(s => s.frameAssetId);
  const withVideo = shots.filter(s => s.videoAssetId);
  const busyShots = React.useMemo(() => {
    const set = new Set<string>();
    for (const j of jobs) if ((j.status === 'queued' || j.status === 'running') && j.stage === 'video') { const id = (j.input as any)?.target?.id; if (id) set.add(id); }
    return set;
  }, [jobs]);

  React.useEffect(() => { if (!selectedId && withFrames[0]) setSelectedId(withFrames[0].id); }, [withFrames, selectedId]);

  const onUpload = async (file: File, slot: 'startFrame' | 'endFrame' | 'ref') => {
    try {
      const fd = new FormData(); fd.append('files', file); fd.append('projectId', project?.id ?? ''); fd.append('kind', 'image');
      const r = await upload<{ assets: Asset[] }>('/api/uploads', fd);
      if (r.assets[0]) setFf(f => ({ ...f, [slot]: r.assets[0] }));
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <StageFrame
      icon={<VideoIcon size={15} />}
      title="Video generation"
      subtitle={`${withVideo.length}/${shots.length} shots have motion · approved frames are used as start frames so identity carries through`}
      headerRight={
        <>
          <Segmented size="sm" value={mode} onChange={setMode} options={[{ value: 'shots', label: 'From shots' }, { value: 'freeform', label: 'Freeform' }]} />
          <GenerateBar config={{ action: 'videos', label: 'All shot videos' }} modelKind="video" label="Generate all videos" size="sm" />
        </>
      }
      asideTitle={selected ? `Shot ${selected.index}` : 'Shot'}
      aside={selected ? (
        <div className="space-y-3 p-3">
          <AssetThumb asset={selected.videoAssetId ? assetById.get(selected.videoAssetId) : null} ratio="16/9" animate="hover" fallbackLabel="No video yet" />
          <AssetThumb asset={selected.frameAssetId ? assetById.get(selected.frameAssetId) : null} ratio="16/9" animate="none" fallbackLabel="No start frame" />
          <div>
            <MetaRow label="Size">{selected.size}</MetaRow>
            <MetaRow label="Lens" mono>{selected.lens}</MetaRow>
            <MetaRow label="Move">{selected.move}</MetaRow>
            <MetaRow label="Duration">{selected.durationSec.toFixed(1)}s</MetaRow>
            <MetaRow label="Scene">{scenes.find(s => s.id === selected.sceneId)?.heading ?? '—'}</MetaRow>
          </div>
          <Field label="Duration">
            <Slider value={selected.durationSec} min={1} max={12} step={0.5} onChange={v => void update<Shot>('shots', selected.id, { durationSec: v } as Partial<Shot>)} unit="s" />
          </Field>
          <GenerateBar config={{ action: 'videos', label: `Video SH ${selected.index}`, params: { shotId: selected.id } }} modelKind="video" label="Generate video" size="sm" />
          <div className="flex gap-1.5">
            <Button size="xs" variant="ghost" className="flex-1" onClick={() => void update<Shot>('shots', selected.id, { videoStatus: selected.videoStatus === 'approved' ? 'ready' : 'approved' } as Partial<Shot>)}>
              <Check size={11} />{selected.videoStatus === 'approved' ? 'Approved' : 'Approve'}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => void update<Shot>('shots', selected.id, { videoStatus: 'rejected' } as Partial<Shot>)}><X size={11} />Reject</Button>
          </div>
          <StageNote tone="info" title="Provider adapters">
            Video models are adapters behind one interface. Kling, Veo, MiniMax, Hunyuan, Wan and ComfyUI workflows all
            appear here automatically once their provider has a key — the UI never changes.
          </StageNote>
        </div>
      ) : undefined}
      footer={shots.length ? (
        <ReviewBar approved={withVideo.length > 0 && withVideo.every(s => s.videoStatus === 'approved')} next="voice"
          onApprove={async () => { for (const s of withVideo) if (s.videoStatus !== 'approved') await update<Shot>('shots', s.id, { videoStatus: 'approved' } as Partial<Shot>); useProject.getState().markStage('video', 'approved'); await takeSnapshot('Videos approved'); }}
          note={<>{withVideo.length} shot(s) with motion · {withVideo.filter(s => s.videoStatus === 'approved').length} approved</>} />
      ) : undefined}>

      <div className="p-4 xl:p-6">
        {mode === 'shots' && (
          <>
            {!shots.length && (
              <EmptyState icon={<VideoIcon size={17} />} title="No shots to animate"
                body="Video generation works from your shot list. Break the script into scenes first — approved storyboard frames become the start frame for each shot."
                action={<Button size="sm" variant="primary" onClick={() => setStage('shots')}>Open shot list</Button>} />
            )}
            {shots.length > 0 && withFrames.length === 0 && (
              <EmptyState icon={<Layers size={17} />} title="No start frames yet"
                body="You can generate video straight from the prompt, but results stay far more consistent when an approved storyboard frame is used as the start frame."
                action={<Button size="sm" variant="primary" onClick={() => setStage('storyboard')}>Go to storyboard</Button>}
                secondary={<GenerateBar config={{ action: 'videos', label: 'All shot videos', params: { allowStills: false } }} modelKind="video" label="Generate without frames" size="sm" variant="default" />} />
            )}
            {withFrames.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shots.map(s => {
                  const frame = s.frameAssetId ? assetById.get(s.frameAssetId) ?? null : null;
                  const vid = s.videoAssetId ? assetById.get(s.videoAssetId) ?? null : null;
                  const busy = busyShots.has(s.id);
                  const sc = scenes.find(x => x.id === s.sceneId);
                  return (
                    <Card key={s.id} hover className={cx('group overflow-hidden', selectedId === s.id && 'border-accent/45 shadow-glow', s.videoStatus === 'approved' && 'border-ok/35')}>
                      <button type="button" onClick={() => setSelectedId(s.id)} className="block w-full text-left">
                        <div className="relative">
                          <AssetThumb asset={vid ?? frame} ratio="16/9" className="rounded-none border-0" animate="hover"
                            fallbackLabel={busy ? 'Generating motion…' : 'No frame'} />
                          {busy && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 backdrop-blur-[2px]">
                              <Skeleton className="h-1 w-2/3" />
                              <span className="flex items-center gap-1.5 text-[10px] text-accent-bright"><RotateCcw size={10} className="animate-spin" />Rendering {s.durationSec.toFixed(0)}s of motion…</span>
                            </div>
                          )}
                          {!busy && vid && <span className="absolute left-2 top-2"><Badge tone="info"><Play size={8} />motion</Badge></span>}
                          {!busy && !vid && frame && <span className="absolute left-2 top-2"><Badge tone="mut">frame only</Badge></span>}
                          {vid?.demo && !busy && <span className="absolute right-2 top-2"><PrevisBadge label="PREVIS MOTION" /></span>}
                          {s.videoStatus === 'approved' && !busy && <span className="absolute bottom-2 right-2"><Badge tone="ok"><Check size={9} />approved</Badge></span>}
                          <span className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[9px] text-ink2 backdrop-blur">
                            SC{String(sc?.index ?? 0).padStart(2, '0')} SH{String(s.index).padStart(2, '0')} · {s.move}
                          </span>
                        </div>
                        <div className="p-2.5">
                          <p className="line-clamp-2 text-[11px] leading-snug text-ink2">{s.description || s.prompt.slice(0, 110)}</p>
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] text-ink3">
                            <Badge tone="mut">{s.size}</Badge><span className="mono">{s.lens}</span>
                            <span className="ml-auto tnum">{s.durationSec.toFixed(1)}s</span>
                          </div>
                        </div>
                      </button>
                      <div className="flex items-center gap-1 border-t border-line-soft px-2 py-1.5">
                        <GenerateBar config={{ action: 'videos', label: `Video SH ${s.index}`, params: { shotId: s.id } }} modelKind="video" label={vid ? 'Re-render' : 'Generate'} size="xs" />
                        <div className="flex-1" />
                        {vid && <Tip label="Open"><button type="button" className="icon-btn h-6 w-6" onClick={() => setLightbox(vid)}><Play size={11} /></button></Tip>}
                        <Tip label={s.videoStatus === 'approved' ? 'Unapprove' : 'Approve'}>
                          <button type="button" className={cx('icon-btn h-6 w-6', s.videoStatus === 'approved' && 'text-ok')}
                            onClick={() => void update<Shot>('shots', s.id, { videoStatus: s.videoStatus === 'approved' ? 'ready' : 'approved' } as Partial<Shot>)}><Check size={12} /></button>
                        </Tip>
                        <Tip label="Reject"><button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={() => void update<Shot>('shots', s.id, { videoStatus: 'rejected' } as Partial<Shot>)}><X size={12} /></button></Tip>
                      </div>
                    </Card>
                  );
                })}
              </div>
            )}
          </>
        )}

        {mode === 'freeform' && (
          <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
            <Card hover={false} className="p-4">
              <div className="label mb-2">Freeform video generation</div>
              <p className="mb-3 text-[11.5px] leading-relaxed text-ink2">
                Generate motion that isn't tied to a shot — a title background, an insert, a B-roll plate. The result
                lands in the asset library and can be dragged straight onto the timeline.
              </p>
              <div className="space-y-3">
                <Field label="Prompt" required>
                  <TextArea rows={4} value={ff.prompt} onChange={e => setFf({ ...ff, prompt: e.target.value })}
                    placeholder="Slow dolly through a rain-soaked alley, neon reflecting in puddles, steam rising from a grate, no people" />
                </Field>
                <Field label="Negative prompt"><TextArea rows={2} value={ff.negative} onChange={e => setFf({ ...ff, negative: e.target.value })} /></Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Duration"><Select value={String(ff.duration)} onChange={v => setFf({ ...ff, duration: Number(v) })} options={[2, 3, 4, 5, 6, 8, 10, 12].map(n => ({ value: String(n), label: `${n} seconds` }))} /></Field>
                  <Field label="Aspect ratio"><Select value={ff.aspect} onChange={v => setFf({ ...ff, aspect: v as never })} options={['16:9', '9:16', '1:1', '4:5', '2.39:1']} /></Field>
                  <Field label="Resolution"><Select value={ff.resolution} onChange={v => setFf({ ...ff, resolution: v as never })} options={['480p', '720p', '1080p', '1440p']} /></Field>
                  <Field label="Motion"><Select value={ff.motion} onChange={v => setFf({ ...ff, motion: v })} options={[...MOTION_PRESETS]} /></Field>
                  <Field label="Camera"><Select value={ff.camera} onChange={v => setFf({ ...ff, camera: v })} options={[...CAMERA_PRESETS]} /></Field>
                  <Field label="Seed"><TextInput type="number" value={ff.seed} onChange={e => setFf({ ...ff, seed: Number(e.target.value) })} /></Field>
                </div>
              </div>
            </Card>

            <div className="space-y-3">
              <Card hover={false} className="p-3">
                <div className="label mb-2">Frames & references</div>
                <div className="space-y-2">
                  {(['startFrame', 'endFrame', 'ref'] as const).map(slot => (
                    <div key={slot}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-[10.5px] text-ink3">{slot === 'ref' ? 'Reference image' : slot === 'startFrame' ? 'Start frame' : 'End frame'}</span>
                        {ff[slot] && <button type="button" className="text-[10px] text-ink3 hover:text-bad" onClick={() => setFf({ ...ff, [slot]: null })}>clear</button>}
                      </div>
                      <label className="relative block cursor-pointer">
                        <AssetThumb asset={ff[slot]} ratio="16/9" animate="none" fallbackLabel="Click to upload" />
                        <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity hover:opacity-100">
                          <span className="flex items-center gap-1.5 rounded-md border border-line bg-black/70 px-2 py-1 text-[10.5px] text-ink2 backdrop-blur"><Upload size={11} />Upload</span>
                        </span>
                        <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void onUpload(f, slot); e.target.value = ''; }} />
                      </label>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-ink3">
                  Start and end frames are only sent to models that support them (Kling, MiniMax, Wan). The router drops
                  them gracefully for models that don't.
                </p>
              </Card>
              <Card hover={false} className="p-3">
                <div className="label mb-2">Generate</div>
                <GenerateBar config={{
                  action: 'video', label: 'Freeform video',
                  params: {
                    prompt: ff.prompt, negativePrompt: ff.negative, durationSec: ff.duration, aspectRatio: ff.aspect,
                    resolution: ff.resolution, motion: ff.motion, camera: ff.camera, seed: ff.seed || undefined,
                    name: ff.prompt.slice(0, 40) || 'Freeform video',
                    refs: ff.ref ? [{ key: ff.ref.storageKey, url: ff.ref.url, mime: ff.ref.mimeType }] : undefined,
                    startFrame: ff.startFrame ? { key: ff.startFrame.storageKey, url: ff.startFrame.url, mime: ff.startFrame.mimeType } : undefined,
                    endFrame: ff.endFrame ? { key: ff.endFrame.storageKey, url: ff.endFrame.url, mime: ff.endFrame.mimeType } : undefined
                  }
                }} modelKind="video" label="Generate video" disabled={!ff.prompt.trim()} />
                {!ff.prompt.trim() && <p className="mt-2 text-[10px] text-ink3">Write a prompt to enable generation.</p>}
              </Card>
            </div>
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/85 p-6 backdrop-blur" onClick={() => setLightbox(null)}>
          <div className="max-h-full w-full max-w-[1000px]" onClick={e => e.stopPropagation()}>
            <AssetThumb asset={lightbox} ratio="16/9" animate="always" className="w-full" />
            <div className="mt-2 flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[11px] text-ink2">{lightbox.name}</p>
              {lightbox.demo && <PrevisBadge label="PREVIS MOTION PLATE" />}
              <a className="btn btn-xs" href={lightbox.url} download={lightbox.name}>Download</a>
              <Button size="xs" variant="ghost" onClick={() => setLightbox(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </StageFrame>
  );
}
