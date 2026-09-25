'use client';
import * as React from 'react';
import { Download, Monitor, Server, Film, Music4, Package, Check, AlertTriangle, X, Clock, Loader2, Play, Scissors, Share2, Sparkles } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Progress, cx, Tip, Segmented } from '@/components/ui/primitives';
import { Field, Select, Slider, Toggle } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useEditor } from '@/store/editor';
import { useApp, useFfmpeg } from '@/store/app';
import { get, post, upload, describeError } from '@/lib/client/api';
import { renderTimeline, supportedMimeTypes, qualityToBitrate } from '@/lib/client/export-render';
import { formatBytes, formatSeconds } from '@/lib/client/ids';
import { timecode } from '@/lib/timeline/factory';
import { humanTime } from './GenerateBar';
import type { ExportJob } from '@/types';

const FORMATS = [
  { value: 'mp4', label: 'MP4', hint: 'Universal delivery, H.264/H.265' },
  { value: 'mov', label: 'MOV', hint: 'Edit-friendly, supports ProRes' },
  { value: 'webm', label: 'WebM', hint: 'Web, VP9/AV1' }
];
const CODECS = ['h264', 'h265', 'prores', 'vp9', 'av1'];
const RESOLUTIONS = ['720p', '1080p', '1440p', '4k'];
const QUALITIES = [
  { value: 'draft', label: 'Draft', hint: 'Fast, small, for review' },
  { value: 'high', label: 'High', hint: 'Delivery quality' },
  { value: 'master', label: 'Master', hint: 'Archive / broadcast' }
];

export function ExportStage() {
  const project = useProject(s => s.project);
  const timeline = useProject(s => s.timeline);
  const assets = useProject(s => s.assets);
  const exportsList = useProject(s => s.exports);
  const refresh = useProject(s => s.refresh);
  const init = useEditor(s => s.init);
  const editorTl = useEditor(s => s.timeline);
  const toast = useApp(s => s.toast);
  const ffmpeg = useFfmpeg();
  const { confirm, node } = useConfirm();

  const [engine, setEngine] = React.useState<'browser' | 'ffmpeg'>('browser');
  const [format, setFormat] = React.useState('mp4');
  const [codec, setCodec] = React.useState('h264');
  const [resolution, setResolution] = React.useState('1080p');
  const [fps, setFps] = React.useState(24);
  const [aspect, setAspect] = React.useState('16:9');
  const [quality, setQuality] = React.useState<'draft' | 'high' | 'master'>('high');
  const [bitrate, setBitrate] = React.useState(12);
  const [useMarks, setUseMarks] = React.useState(false);
  const [progress, setProgress] = React.useState<{ p: number; stage: string } | null>(null);
  const [history, setHistory] = React.useState<ExportJob[]>(exportsList ?? []);
  const abortRef = React.useRef<AbortController | null>(null);

  React.useEffect(() => { if (project) { setFps(project.settings.fps); setAspect(project.settings.format); } }, [project]);
  React.useEffect(() => { if (timeline && project && (!editorTl || editorTl.id !== timeline.id)) init(timeline, project.id); }, [timeline, project, editorTl, init]);
  React.useEffect(() => {
    const types = supportedMimeTypes();
    if (!types.length) setEngine('ffmpeg');
  }, []);

  const tl = editorTl ?? timeline;
  const clipCount = tl?.tracks.reduce((a, t) => a + t.clips.length, 0) ?? 0;
  const duration = tl?.durationSec ?? 0;
  const range = useMarks && editorTl?.inPoint != null && editorTl?.outPoint != null
    ? [editorTl.inPoint, editorTl.outPoint] as [number, number] : null;
  const renderDur = range ? range[1] - range[0] : duration;
  const dims = React.useMemo(() => {
    const short = { '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 }[resolution] ?? 1080;
    const [aw, ah] = aspect.split(':').map(Number);
    const landscape = aw >= ah;
    const w = landscape ? Math.round(short * aw / ah) : short;
    const h = landscape ? short : Math.round(short * ah / aw);
    return { w: Math.round(w / 2) * 2, h: Math.round(h / 2) * 2 };
  }, [resolution, aspect]);

  const loadHistory = React.useCallback(async () => {
    if (!project) return;
    try { const r = await get<{ exports: ExportJob[]; ffmpeg: boolean }>(`/api/projects/${project.id}/export`); setHistory(r.exports); } catch { /* ignore */ }
  }, [project]);
  React.useEffect(() => { void loadHistory(); const i = setInterval(loadHistory, 6000); return () => clearInterval(i); }, [loadHistory]);

  const browserExport = async (label: string, opts?: { scale?: number; aspectOverride?: string }) => {
    if (!project || !tl || !clipCount) { toast({ level: 'warn', title: 'Nothing to export' }); return; }
    const types = supportedMimeTypes();
    if (!types.length) { toast({ level: 'error', title: 'This browser cannot record video', body: 'Use the server-side ffmpeg export, or a Chromium-based browser.' }); return; }
    const ok = await confirm({
      title: `Render "${label}" in the browser?`, confirmLabel: 'Start render',
      body: <>The editor renders the timeline in real time — a {formatSeconds(renderDur)} cut takes about {formatSeconds(renderDur)} plus encoding. Keep this tab visible and do not switch away.</>,
      credits: 0,
      details: [
        { label: 'Engine', value: 'Browser (canvas + MediaRecorder)' },
        { label: 'Container', value: types[0].label },
        { label: 'Resolution', value: `${dims.w}×${dims.h}` },
        { label: 'Frame rate', value: `${fps} fps` },
        { label: 'Bitrate', value: `${qualityToBitrate(quality, dims.w, dims.h, fps) / 1e6 | 0} Mbps` },
        { label: 'Range', value: range ? `${range[0].toFixed(1)}s → ${range[1].toFixed(1)}s` : `Full (${formatSeconds(duration)})` }
      ]
    });
    if (!ok) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress({ p: 0, stage: 'preparing' });
    try {
      const scale = (opts?.scale ?? 1) * (dims.w / Math.max(1, tl.width));
      const res = await renderTimeline(tl,
        id => (id ? assets.find(a => a.id === id)?.url ?? null : null),
        id => { const a = id ? assets.find(x => x.id === id) : null; return a ? { ...(a.meta ?? {}), mimeType: a.mimeType, mime: a.mimeType } : {}; },
        {
          mimeType: types[0].mime, fps, scale: Math.min(2, Math.max(0.25, scale)),
          videoBitsPerSecond: qualityToBitrate(quality, dims.w, dims.h, fps),
          range, signal: ctrl.signal,
          onProgress: (p, stage) => setProgress({ p, stage })
        });
      setProgress({ p: 1, stage: 'uploading to library' });
      // save into the project library so the deliverable is versioned with the project
      const fd = new FormData();
      fd.append('file', res.blob, `${project.name.replace(/\W+/g, '_')}_${label.replace(/\W+/g, '_')}.${types[0].ext}`);
      fd.append('projectId', project.id); fd.append('timelineId', tl.id); fd.append('label', label);
      fd.append('format', types[0].ext === 'mp4' ? 'mp4' : 'webm'); fd.append('codec', types[0].ext === 'mp4' ? 'h264' : 'vp9');
      fd.append('resolution', resolution); fd.append('fps', String(fps)); fd.append('aspectRatio', aspect);
      fd.append('quality', quality); fd.append('durationSec', String(res.durationSec));
      fd.append('width', String(res.width)); fd.append('height', String(res.height));
      await upload('/api/exports/upload', fd);
      // also hand the file straight to the user
      const url = URL.createObjectURL(res.blob);
      const a = document.createElement('a'); a.href = url; a.download = `${project.name.replace(/\W+/g, '_')}_${label}.${types[0].ext}`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ level: 'success', title: 'Export complete', body: `${formatBytes(res.blob.size)} · saved to the asset library and downloaded.` });
      await refresh(); await loadHistory();
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const d = describeError(err);
        toast({ level: 'error', title: d.title || 'Export failed', body: d.body, ttl: 12000 });
      }
    } finally { setProgress(null); abortRef.current = null; }
  };

  const serverExport = async (kind: 'video' | 'stems' | 'bundle') => {
    if (!project || !tl) return;
    const body = kind === 'video'
      ? { engine: 'ffmpeg', format, codec, resolution, fps, aspectRatio: aspect, quality, bitrate, range, label: `${resolution} ${format.toUpperCase()}` }
      : kind === 'stems' ? { engine: 'stems', label: 'Stems', stemBuses: ['dialogue', 'sfx', 'ambience', 'music'] }
      : { engine: 'bundle', label: 'Project bundle' };
    try {
      await post(`/api/projects/${project.id}/export`, body);
      toast({ level: 'success', title: 'Export queued', body: 'Track progress in the queue (⌘J).' });
      setUiQueue();
      await loadHistory();
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body, ttl: 12000 });
    }
  };
  const setUiQueue = () => useApp.getState().setUi('queue', true);

  return (
    <StageFrame
      icon={<Download size={15} />}
      title="Export"
      subtitle={clipCount ? `${formatSeconds(duration)} · ${clipCount} clips · ${dims.w}×${dims.h} @ ${fps}fps` : 'Render deliverables, stems and a restorable project bundle'}
      headerRight={
        <>
          <Badge tone={ffmpeg ? 'ok' : 'bad'} className="gap-1">{ffmpeg ? <><Server size={9} />ffmpeg ready</> : <><AlertTriangle size={9} />no ffmpeg</>}</Badge>
          <Badge tone="mut" className="gap-1"><Monitor size={9} />browser render ready</Badge>
        </>
      }
      asideTitle="Deliverables"
      aside={
        <div className="space-y-2.5 p-3">
          <ExportButton icon={<Film size={12} />} title="Export master" sub={`${resolution} ${format.toUpperCase()} · ${codec}`} disabled={!clipCount} onClick={() => engine === 'browser' ? void browserExport('Master') : void serverExport('video')} />
          <ExportButton icon={<Share2 size={12} />} title="Export social version" sub="9:16, hook first, 45s" disabled={!clipCount}
            onClick={() => void useProject.getState().generate('assemble', { mode: 'social', grade: 'cinematic', addCaptions: true }).then(() => toast({ level: 'success', title: 'Social cut assembled', body: 'Review it in the Pro Editor, then export.' }))} />
          <ExportButton icon={<Scissors size={12} />} title="Export trailer" sub="~75s, three-act" disabled={!clipCount}
            onClick={() => void useProject.getState().generate('assemble', { mode: 'trailer', grade: 'cinematic' }).then(() => toast({ level: 'success', title: 'Trailer cut assembled' }))} />
          <ExportButton icon={<Music4 size={12} />} title="Export stems" sub="Dialogue / SFX / Ambience / Music" disabled={!clipCount}
            hint="Real offline mixdown on the server — no ffmpeg needed." onClick={() => void serverExport('stems')} />
          <ExportButton icon={<Package size={12} />} title="Export project" sub="JSON + every asset (.zip)"
            hint="Restorable bundle: full project graph and media." onClick={() => void serverExport('bundle')} />
          <div className="mt-1 rounded-md border border-line-soft bg-well p-2.5">
            <div className="label mb-1">Why two engines?</div>
            <p className="text-[10px] leading-relaxed text-ink3">
              The browser renderer runs the same compositor and colour pipeline as the preview, so it always works and
              always matches what you see. ffmpeg adds ProRes, H.265 and faster-than-realtime encoding when it is
              installed on the server.
            </p>
          </div>
        </div>
      }
      footer={<ReviewBar next={null} nextLabel="Done" note={clipCount ? 'Exports are saved to the asset library and versioned with the project.' : 'Assemble a cut first.'} />}>
      {node}
      <div className="p-4 xl:p-6">
        {!clipCount && (
          <EmptyState icon={<Download size={17} />} title="Nothing to export yet"
            body="The timeline is empty. Assemble your generated shots, or cut manually in the Pro Editor."
            action={<Button size="sm" variant="primary" onClick={() => void useProject.getState().generate('assemble', { mode: 'full', grade: 'cinematic' })}><Sparkles size={12} />Assemble timeline</Button>}
            secondary={<Button size="sm" onClick={() => useProject.getState().setStage('editor')}>Open Pro Editor</Button>} />
        )}

        {clipCount > 0 && (
          <div className="mx-auto max-w-[980px] space-y-4">
            <Card hover={false} className="p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="label">Render settings</div>
                <Segmented size="sm" value={engine} onChange={v => setEngine(v as never)}
                  options={[{ value: 'browser', label: <span className="flex items-center gap-1"><Monitor size={11} />Browser</span> }, { value: 'ffmpeg', label: <span className="flex items-center gap-1"><Server size={11} />Server</span> }]} />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Format" hint={FORMATS.find(f => f.value === format)?.hint}>
                  <Select value={format} onChange={v => { setFormat(v); if (v === 'mov') setCodec('prores'); else if (v === 'webm') setCodec('vp9'); else setCodec('h264'); }}
                    options={FORMATS.map(f => ({ value: f.value, label: f.label }))} />
                </Field>
                <Field label="Codec" hint={engine === 'browser' ? 'Browser renders use the container’s native codec.' : undefined}>
                  <Select value={codec} onChange={setCodec} options={CODECS.map(c => ({ value: c, label: c.toUpperCase() }))} />
                </Field>
                <Field label="Resolution"><Select value={resolution} onChange={setResolution} options={RESOLUTIONS.map(r => ({ value: r, label: r.toUpperCase() }))} /></Field>
                <Field label="Frame rate"><Select value={String(fps)} onChange={v => setFps(Number(v))} options={[24, 25, 30, 50, 60].map(f => ({ value: String(f), label: `${f} fps` }))} /></Field>
                <Field label="Aspect"><Select value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '4:5', '2.39:1', '4:3', '21:9']} /></Field>
                <Field label="Quality">
                  <Select value={quality} onChange={v => setQuality(v as never)} options={QUALITIES.map(q => ({ value: q.value, label: `${q.label} — ${q.hint}` }))} />
                </Field>
              </div>

              {engine === 'ffmpeg' && (
                <div className="mt-3">
                  <Slider label="Bitrate" min={2} max={80} step={1} value={bitrate} onChange={setBitrate} unit=" Mbps" />
                </div>
              )}

              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-md border border-line-soft bg-well p-2.5">
                  <Toggle checked={useMarks} onChange={setUseMarks} label="Use in/out marks" hint={editorTl?.inPoint != null && editorTl?.outPoint != null ? `Range ${editorTl.inPoint.toFixed(2)}s → ${editorTl.outPoint.toFixed(2)}s` : 'Set marks in the Pro Editor with I and O.'} />
                </div>
                <div className="rounded-md border border-line-soft bg-well p-2.5">
                  <div className="label mb-1">Output</div>
                  <p className="font-mono text-[10.5px] text-ink2">{dims.w}×{dims.h} · {fps}fps · {formatSeconds(renderDur)}</p>
                  <p className="mt-0.5 text-[10px] text-ink3">
                    ≈{formatBytes((qualityToBitrate(quality, dims.w, dims.h, fps) / 8) * renderDur)} · {engine === 'browser' ? 'real-time render' : `~${humanTime(renderDur * 0.4)}`}
                  </p>
                </div>
              </div>

              {engine === 'ffmpeg' && !ffmpeg && (
                <div className="mt-3 flex items-start gap-2 rounded-md border border-accent/30 bg-accent/[0.07] px-3 py-2.5">
                  <AlertTriangle size={13} className="mt-[2px] shrink-0 text-accent-bright" />
                  <div className="min-w-0 text-[11px] leading-relaxed text-ink2">
                    <p className="font-semibold text-ink">FFmpeg is not installed on this server.</p>
                    <p className="mt-0.5">Install it and set <code className="mono text-ink2">FFMPEG_PATH</code> to enable H.264/H.265/ProRes masters.
                      Meanwhile use the Browser engine for a real render, or export Stems and Project Bundle, which do not need ffmpeg.</p>
                  </div>
                </div>
              )}

              {progress && (
                <div className="mt-3 rounded-md border border-accent/30 bg-accent/[0.07] p-3">
                  <div className="mb-1.5 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin text-accent-bright" />
                    <span className="text-[11.5px] font-medium text-ink">Rendering in browser…</span>
                    <span className="ml-auto font-mono text-[10.5px] text-accent-bright tnum">{Math.round(progress.p * 100)}%</span>
                    <button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={() => abortRef.current?.abort()} aria-label="Cancel"><X size={12} /></button>
                  </div>
                  <Progress value={progress.p} />
                  <p className="mt-1.5 text-[10px] text-ink3">{progress.stage}</p>
                </div>
              )}

              <div className="mt-3.5 flex flex-wrap items-center gap-2">
                <Button variant="primary" disabled={!clipCount || Boolean(progress) || (engine === 'ffmpeg' && !ffmpeg)}
                  loading={Boolean(progress)}
                  onClick={() => engine === 'browser' ? void browserExport('Master') : void serverExport('video')}>
                  <Download size={13} />Export {engine === 'browser' ? 'in browser' : 'on server'}
                </Button>
                <Button disabled={!clipCount || Boolean(progress)} onClick={() => void browserExport('Draft', { scale: 0.5 })}>Draft (half res)</Button>
                <Button disabled={!clipCount} onClick={() => void serverExport('stems')}><Music4 size={12} />Stems</Button>
                <Button onClick={() => void serverExport('bundle')}><Package size={12} />Project bundle</Button>
                <span className="ml-auto text-[10.5px] text-ink3">Export never consumes credits.</span>
              </div>
            </Card>

            <Card hover={false} className="overflow-hidden">
              <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
                <div className="label">Export history</div>
                <Badge tone="mut">{history.length}</Badge>
                <div className="flex-1" />
                <Button size="xs" variant="ghost" onClick={() => void loadHistory()}>Refresh</Button>
              </div>
              {!history.length ? (
                <p className="px-4 py-6 text-center text-[11.5px] text-ink3">No exports yet. Your renders will appear here and in the asset library.</p>
              ) : (
                <ul className="divide-y divide-line-soft/60">
                  {history.slice(0, 12).map(e => {
                    const asset = e.assetId ? assets.find(a => a.id === e.assetId) : null;
                    return (
                      <li key={e.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className={cx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md border',
                          e.status === 'succeeded' ? 'border-ok/30 bg-ok/10 text-ok' : e.status === 'failed' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-accent/30 bg-accent/10 text-accent-bright')}>
                          {e.status === 'succeeded' ? <Check size={12} /> : e.status === 'failed' ? <X size={12} /> : <Loader2 size={12} className="animate-spin" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-medium text-ink">{e.label}</span>
                            <Badge tone="mut">{e.engine}</Badge>
                            {e.format && <Badge tone="mut">{e.format.toUpperCase()} · {e.resolution}</Badge>}
                          </span>
                          <span className="mt-0.5 flex items-center gap-2 text-[10px] text-ink3">
                            <Clock size={9} />{new Date(e.createdAt).toLocaleString()}
                            {asset && <span>{formatBytes(asset.bytes)}</span>}
                            {e.error && <span className="truncate text-bad">{e.error}</span>}
                          </span>
                          {['queued', 'rendering', 'encoding'].includes(e.status) && <Progress className="mt-1.5 h-1" value={e.progress} />}
                        </span>
                        {asset && (
                          <span className="flex shrink-0 gap-1">
                            <Tip label="Play"><a className="icon-btn" href={asset.url} target="_blank" rel="noreferrer"><Play size={12} /></a></Tip>
                            <Tip label="Download"><a className="icon-btn" href={asset.url} download={asset.name}><Download size={12} /></a></Tip>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card hover={false} className="p-4">
              <div className="label mb-2">What gets exported</div>
              <div className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
                <MetaRow label="Timeline">{tl?.name ?? '—'}</MetaRow>
                <MetaRow label="Video tracks">{tl?.tracks.filter(t => t.kind === 'video').length ?? 0}</MetaRow>
                <MetaRow label="Audio tracks">{tl?.tracks.filter(t => t.kind === 'audio').length ?? 0}</MetaRow>
                <MetaRow label="Clips">{clipCount}</MetaRow>
                <MetaRow label="Grade">{tl?.grade ? 'timeline grade applied' : 'none'}</MetaRow>
                <MetaRow label="Markers">{tl?.markers.length ?? 0}</MetaRow>
                <MetaRow label="Previs media">{assets.filter(a => a.demo).length} asset(s)</MetaRow>
                <MetaRow label="Timecode start">{timecode(0, fps)}</MetaRow>
              </div>
              <div className="mt-3"><StageNote tone={assets.some(a => a.demo) ? 'warn' : 'ok'} title={assets.some(a => a.demo) ? 'This export contains previs plates' : 'All media is model-generated or imported'}>
                {assets.some(a => a.demo)
                  ? <>{assets.filter(a => a.demo).length} asset(s) on this timeline were rendered by the built-in Studio Engine and carry a "STUDIO ENGINE · PREVIS" mark baked into the frame. Replace them with model generations before delivering.</>
                  : 'No previs plates are present on this timeline.'}
              </StageNote></div>
            </Card>
          </div>
        )}
      </div>
    </StageFrame>
  );
}

function ExportButton({ icon, title, sub, onClick, disabled, hint }: { icon: React.ReactNode; title: string; sub: string; onClick: () => void; disabled?: boolean; hint?: string }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="w-full rounded-md border border-line bg-well px-2.5 py-2 text-left transition-colors hover:border-accent/35 hover:bg-accent/[0.05] disabled:cursor-not-allowed disabled:opacity-40">
      <span className="flex items-center gap-2">
        <span className="shrink-0 text-accent">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-medium text-ink">{title}</span>
          <span className="block truncate text-[9.5px] text-ink3">{sub}</span>
        </span>
      </span>
      {hint && <span className="mt-1 block text-[9px] leading-snug text-ink3">{hint}</span>}
    </button>
  );
}
