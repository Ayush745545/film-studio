'use client';
import * as React from 'react';
import { FolderOpen, Upload, Sparkles, Type, AudioLines, Search, Plus, Music4, GripVertical, Wand2 } from 'lucide-react';
import { cx, Badge, Button, EmptyState, PrevisBadge, Tip, Segmented } from '@/components/ui/primitives';
import { Select, TextInput } from '@/components/ui/inputs';
import { AssetThumb } from '@/components/stages/AssetThumb';
import { useProject } from '@/store/project';
import { useEditor, useSelectedClip } from '@/store/editor';
import { useApp } from '@/store/app';
import { upload, describeError } from '@/lib/client/api';
import { addTextClip, addAdjustmentLayer } from '@/lib/timeline/ops';
import { formatSeconds, formatBytes } from '@/lib/client/ids';
import type { Asset } from '@/types';

const TABS = [
  { id: 'media', label: 'Media', icon: <FolderOpen size={13} /> },
  { id: 'effects', label: 'Effects', icon: <Sparkles size={13} /> },
  { id: 'text', label: 'Text', icon: <Type size={13} /> },
  { id: 'audio', label: 'Audio', icon: <AudioLines size={13} /> }
] as const;

const TEXT_PRESETS = [
  { id: 'title', label: 'Main title', content: 'TITLE', size: 96, y: 0.5, animate: 'fade', bg: false, align: 'center' as const, font: 'Georgia' },
  { id: 'subtitle', label: 'Subtitle', content: 'Subtitle text', size: 40, y: 0.86, animate: 'fade', bg: true, align: 'center' as const, font: 'Inter' },
  { id: 'lower', label: 'Lower third', content: 'Name — Role', size: 44, y: 0.78, animate: 'rise', bg: false, align: 'left' as const, font: 'Inter' },
  { id: 'caption', label: 'Burned-in caption', content: 'Caption line', size: 38, y: 0.88, animate: 'none', bg: true, align: 'center' as const, font: 'Inter' },
  { id: 'card', label: 'End card', content: 'THE END', size: 72, y: 0.5, animate: 'fade', bg: false, align: 'center' as const, font: 'Georgia' }
];

const TRANSITION_PRESETS = [
  { id: 'crossfade', label: 'Crossfade', dur: 0.6 }, { id: 'dip-black', label: 'Dip to black', dur: 0.5 },
  { id: 'dip-white', label: 'Dip to white', dur: 0.35 }, { id: 'wipe-left', label: 'Wipe left', dur: 0.5 },
  { id: 'slide', label: 'Slide', dur: 0.45 }, { id: 'zoom', label: 'Zoom punch', dur: 0.3 },
  { id: 'blur', label: 'Blur dissolve', dur: 0.6 }, { id: 'light-leak', label: 'Light leak', dur: 0.7 }
];

/** Left panel: media browser, effects, text and audio — all drag onto the timeline. */
export function MediaPanel() {
  const [tab, setTab] = React.useState<(typeof TABS)[number]['id']>('media');
  return (
    <div className="flex h-full min-h-0 flex-col border-r border-line bg-panel">
      <div className="flex shrink-0 border-b border-line-soft">
        {TABS.map(t => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)} data-on={tab === t.id}
            className="tab-underline flex flex-1 items-center justify-center gap-1 py-2 text-[10.5px] font-medium text-ink3 transition-colors hover:text-ink2 data-[on=true]:text-ink">
            {t.icon}{t.label}
          </button>
        ))}
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {tab === 'media' && <MediaTab />}
        {tab === 'effects' && <EffectsTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'audio' && <AudioTab />}
      </div>
    </div>
  );
}

function MediaTab() {
  const assets = useProject(s => s.assets);
  const project = useProject(s => s.project);
  const toast = useApp(s => s.toast);
  const refresh = useProject(s => s.refresh);
  const [q, setQ] = React.useState('');
  const [kind, setKind] = React.useState('all');
  const [busy, setBusy] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const kinds = ['all', ...new Set(assets.map(a => a.kind))];
  const shown = assets.filter(a => (kind === 'all' || a.kind === kind) && (!q || `${a.name} ${a.prompt}`.toLowerCase().includes(q.toLowerCase())));

  const onUpload = async (files: FileList | null) => {
    if (!files?.length || !project) return;
    setBusy(true);
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      fd.append('projectId', project.id);
      const r = await upload<{ assets: Asset[] }>('/api/uploads', fd);
      toast({ level: 'success', title: `${r.assets.length} file(s) imported`, body: 'They are in the project library and ready to drag onto the timeline.' });
      await refresh();
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  };

  return (
    <div className="space-y-2 p-2.5">
      <div className="flex gap-1.5">
        <Button size="xs" className="flex-1" loading={busy} onClick={() => fileRef.current?.click()}><Upload size={11} />Import media</Button>
        <input ref={fileRef} type="file" multiple className="hidden" accept="image/*,video/*,audio/*,.json,.csv,.cube,.zip"
          onChange={e => void onUpload(e.target.files)} />
      </div>
      <div className="relative">
        <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink3" />
        <TextInput className="h-[28px] pl-7 text-[11px]" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter library…" />
      </div>
      <Select size="sm" value={kind} onChange={setKind} options={kinds.map(k => ({ value: k, label: k === 'all' ? `All kinds (${assets.length})` : `${k} (${assets.filter(a => a.kind === k).length})` }))} />

      {!shown.length && (
        <EmptyState compact icon={<FolderOpen size={15} />} title="Nothing here yet"
          body={<>Import your own footage, or generate media in the AI stages — every generation lands here automatically and can be dragged onto a track.</>}
          action={<Button size="xs" onClick={() => fileRef.current?.click()}><Upload size={11} />Import</Button>} />
      )}

      <div className="grid grid-cols-2 gap-1.5">
        {shown.map(a => <MediaTile key={a.id} asset={a} />)}
      </div>
    </div>
  );
}

function MediaTile({ asset }: { asset: Asset }) {
  const onDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData('application/x-afs-asset', JSON.stringify({
      id: asset.id, kind: asset.kind, durationSec: asset.durationSec, url: asset.url, mimeType: asset.mimeType, demo: asset.demo
    }));
    e.dataTransfer.effectAllowed = 'copy';
  };
  const addAtPlayhead = () => {
    const ed = useEditor.getState();
    const tl = ed.timeline; if (!tl) return;
    const isAudio = asset.mimeType.startsWith('audio/');
    const tracks = tl.tracks.filter(t => t.kind === (isAudio ? 'audio' : 'video')).sort((a, b) => a.index - b.index);
    const track = tracks[0];
    if (!track) return;
    const dur = Math.max(0.5, asset.durationSec ?? (asset.mimeType.startsWith('image/') ? 4 : 5));
    ed.apply([{ op: 'addClip', track: track.index, clip: { trackId: track.id, kind: isAudio ? 'audio' : asset.mimeType.startsWith('image/') ? 'image' : 'video', name: asset.name, assetId: asset.id, srcUrl: asset.url, demo: asset.demo, start: ed.playhead, duration: dur, in: 0, out: dur } }], { label: 'add clip' });
    useApp.getState().toast({ level: 'success', title: 'Added at playhead', body: asset.name });
  };
  return (
    <div draggable onDragStart={onDragStart} onDoubleClick={addAtPlayhead}
      className="group relative cursor-grab overflow-hidden rounded-md border border-line bg-well transition-colors hover:border-accent/35 active:cursor-grabbing">
      <AssetThumb asset={asset} ratio="16/10" animate="hover" className="rounded-none border-0" />
      <div className="space-y-0.5 p-1.5">
        <p className="truncate text-[10px] font-medium text-ink2 group-hover:text-ink">{asset.name}</p>
        <p className="flex items-center gap-1 truncate text-[9px] text-ink3">
          {asset.kind}{asset.durationSec ? ` · ${formatSeconds(asset.durationSec)}` : ''}{asset.bytes ? ` · ${formatBytes(asset.bytes)}` : ''}
        </p>
      </div>
      <span className="pointer-events-none absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100">
        <GripVertical size={11} className="text-ink/60" />
      </span>
      <button type="button" onClick={addAtPlayhead}
        className="absolute bottom-8 right-1 flex h-5 w-5 items-center justify-center rounded border border-line bg-black/70 text-ink2 opacity-0 backdrop-blur transition-opacity hover:text-accent-bright group-hover:opacity-100"
        aria-label="Add at playhead"><Plus size={11} /></button>
    </div>
  );
}

function EffectsTab() {
  const clip = useSelectedClip();
  const apply = useEditor(s => s.apply);
  const toast = useApp(s => s.toast);
  const add = (type: string, name: string, params: Record<string, number | string> = {}) => {
    if (!clip) { toast({ level: 'warn', title: 'Select a clip first' }); return; }
    apply([{ op: 'updateClip', clipId: clip.id, patch: { effects: [...clip.effects, { id: `fx_${Math.random().toString(36).slice(2, 10)}`, type, name, enabled: true, intensity: 1, params, keyframes: {} }] } }]);
  };
  return (
    <div className="space-y-3 p-2.5">
      <div>
        <div className="label mb-1.5">Transitions</div>
        <div className="grid grid-cols-2 gap-1.5">
          {TRANSITION_PRESETS.map(t => (
            <button key={t.id} type="button" disabled={!clip}
              onClick={() => clip && apply([{ op: 'addTransition', clipId: clip.id, edge: 'out', kind: t.id as never, dur: t.dur }])}
              className="rounded-md border border-line bg-well px-2 py-1.5 text-left text-[10.5px] text-ink2 transition-colors hover:border-accent/35 hover:text-ink disabled:opacity-40">
              <span className="block truncate">{t.label}</span>
              <span className="block text-[9px] text-ink3">{t.dur}s</span>
            </button>
          ))}
        </div>
        {!clip && <p className="mt-1.5 text-[10px] text-ink3">Select a clip to apply a transition to its out point.</p>}
      </div>

      <div>
        <div className="label mb-1.5">Video effects</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            ['blur', 'Gaussian Blur', { radius: 8 }], ['sharpen', 'Sharpen', { amount: 0.6 }],
            ['grayscale', 'Black & White', {}], ['sepia', 'Sepia', {}], ['hue-shift', 'Hue Shift', { degrees: 30 }],
            ['brightness', 'Brightness', { amount: 0.2 }], ['contrast', 'Contrast', { amount: 0.3 }],
            ['saturate', 'Saturate', { amount: 0.4 }], ['chroma-key', 'Chroma Key', { color: '#00FF00', tolerance: 0.4, spill: 0.3 }],
            ['mask', 'Mask', { shape: 'rect', feather: 20 }], ['motion-track', 'Motion Track', { x: 0, y: 0 }],
            ['speed-ramp', 'Speed Ramp', { from: 1, to: 1.5 }]
          ].map(([type, name, params]) => (
            <button key={String(type)} type="button" disabled={!clip} onClick={() => add(String(type), String(name), params as Record<string, number | string>)}
              className="rounded-md border border-line bg-well px-2 py-1.5 text-left text-[10.5px] text-ink2 transition-colors hover:border-accent/35 hover:text-ink disabled:opacity-40">
              {String(name)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="label mb-1.5">Layers</div>
        <div className="space-y-1.5">
          <Button size="xs" variant="ghost" className="w-full justify-start"
            onClick={() => { const ed = useEditor.getState(); ed.apply(addAdjustmentLayer(ed.timeline!, ed.playhead, 5), { label: 'adjustment layer' }); }}>
            <Plus size={11} />Adjustment layer (5s at playhead)
          </Button>
          <Button size="xs" variant="ghost" className="w-full justify-start"
            onClick={() => { const ed = useEditor.getState(); ed.apply([{ op: 'addClip', track: 0, clip: { kind: 'solid', name: 'Solid', start: ed.playhead, duration: 3, color: '#2E3338', meta: { color: 'rgb(var(--deep-rgb))' } } }]); }}>
            <Plus size={11} />Solid colour (3s)
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">
          An adjustment layer grades everything beneath it without touching the clips — ideal for a look you may want to lift later.
        </p>
      </div>
    </div>
  );
}

function TextTab() {
  const apply = useEditor(s => s.apply);
  const playhead = useEditor(s => s.playhead);
  const [custom, setCustom] = React.useState('Your title here');
  return (
    <div className="space-y-3 p-2.5">
      <div>
        <div className="label mb-1.5">Presets</div>
        <div className="space-y-1.5">
          {TEXT_PRESETS.map(p => (
            <button key={p.id} type="button"
              onClick={() => apply(addTextClip(useEditor.getState().timeline!, p.content, playhead, 4, { size: p.size, y: p.y, animate: p.animate as 'none' | 'fade' | 'rise' | 'type', bg: p.bg, align: p.align, font: p.font, color: 'rgb(var(--ink-rgb))' }), { label: 'text' })}
              className="flex w-full items-center gap-2 rounded-md border border-line bg-well px-2.5 py-2 text-left transition-colors hover:border-accent/35">
              <Type size={12} className="shrink-0 text-accent/70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] text-ink2">{p.label}</span>
                <span className="block truncate text-[9.5px] text-ink3">{p.size}px · {p.align} · {p.animate}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="label mb-1.5">Custom</div>
        <TextInput value={custom} onChange={e => setCustom(e.target.value)} placeholder="Text…" />
        <Button size="xs" variant="primary" className="mt-1.5 w-full"
          onClick={() => apply(addTextClip(useEditor.getState().timeline!, custom, playhead, 4), { label: 'text' })}>
          <Plus size={11} />Add at playhead
        </Button>
      </div>
      <div className="rounded-md border border-line-soft bg-well p-2.5">
        <div className="label mb-1 flex items-center gap-1"><Wand2 size={10} />Captions from dialogue</div>
        <p className="text-[10px] leading-relaxed text-ink3">
          Ask the AI copilot to "add subtitles" and it will propose a caption track built from your dialogue lines,
          placed inside the lower title-safe area. You approve the diff before it lands.
        </p>
      </div>
    </div>
  );
}

function AudioTab() {
  const assets = useProject(s => s.assets);
  const sounds = useProject(s => s.sounds);
  const voices = useProject(s => s.voices);
  const toast = useApp(s => s.toast);
  const [view, setView] = React.useState<'assets' | 'cues' | 'lines'>('assets');
  const audio = assets.filter(a => ['audio', 'voice', 'music', 'sfx'].includes(a.kind));

  const addCue = (startSec: number, durationSec: number, asset: Asset) => {
    const ed = useEditor.getState();
    const tl = ed.timeline; if (!tl) return;
    const tracks = tl.tracks.filter(t => t.kind === 'audio').sort((a, b) => a.index - b.index);
    const track = tracks[0]; if (!track) { toast({ level: 'warn', title: 'No audio track' }); return; }
    ed.apply([{ op: 'addClip', track: track.index, clip: { trackId: track.id, kind: 'audio', name: asset.name, assetId: asset.id, srcUrl: asset.url, demo: asset.demo, start: startSec, duration: durationSec, in: 0, out: durationSec, fadeIn: 0.4, fadeOut: 0.8 } }], { label: 'add audio' });
  };

  return (
    <div className="space-y-2 p-2.5">
      <Segmented size="sm" className="w-full" value={view} onChange={v => setView(v as never)}
        options={[{ value: 'assets', label: `Library ${audio.length}` }, { value: 'cues', label: `Cues ${sounds.length}` }, { value: 'lines', label: `Lines ${voices.length}` }]} />

      {view === 'assets' && (
        audio.length ? (
          <div className="space-y-1">
            {audio.map(a => (
              <div key={a.id} draggable onDragStart={e => e.dataTransfer.setData('application/x-afs-asset', JSON.stringify({ id: a.id, kind: a.kind, durationSec: a.durationSec, url: a.url, mimeType: a.mimeType, demo: a.demo }))}
                onDoubleClick={() => addCue(useEditor.getState().playhead, Math.max(1, a.durationSec ?? 3), a)}
                className="group flex cursor-grab items-center gap-2 rounded-md border border-line bg-well px-2 py-1.5 transition-colors hover:border-accent/35">
                <Music4 size={12} className="shrink-0 text-ok/70" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10.5px] text-ink2 group-hover:text-ink">{a.name}</span>
                  <span className="block text-[9px] text-ink3">{a.kind} · {formatSeconds(a.durationSec ?? 0)}</span>
                </span>
                {a.demo && <PrevisBadge />}
              </div>
            ))}
          </div>
        ) : <EmptyState compact icon={<AudioLines size={15} />} title="No audio yet" body="Generate voice, sound effects or score in the audio stages, or import files from the Media tab." />
      )}

      {view === 'cues' && (
        sounds.length ? (
          <div className="space-y-1">
            {sounds.sort((a, b) => a.startSec - b.startSec).map(c => {
              const asset = c.assetId ? assets.find(a => a.id === c.assetId) : null;
              return (
                <button key={c.id} type="button" disabled={!asset} onClick={() => asset && addCue(c.startSec, c.durationSec, asset)}
                  className="flex w-full items-center gap-2 rounded-md border border-line bg-well px-2 py-1.5 text-left transition-colors hover:border-accent/35 disabled:opacity-45">
                  <Badge tone={c.kind === 'score' ? 'accent' : 'mut'}>{c.kind}</Badge>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10.5px] text-ink2">{c.name}</span>
                    <span className="block text-[9px] text-ink3">{formatSeconds(c.startSec)} · {c.durationSec.toFixed(1)}s{asset ? '' : ' · not rendered'}</span>
                  </span>
                  {asset ? <Plus size={11} className="shrink-0 text-ink3" /> : null}
                </button>
              );
            })}
          </div>
        ) : <EmptyState compact icon={<Music4 size={15} />} title="No sound cues" body="Run sound design in the Sound stage to build a cue sheet from the scene breakdown." />
      )}

      {view === 'lines' && (
        voices.length ? (
          <div className="space-y-1">
            {voices.map(v => {
              const asset = v.assetId ? assets.find(a => a.id === v.assetId) : null;
              return (
                <button key={v.id} type="button" disabled={!asset} onClick={() => asset && addCue(useEditor.getState().playhead, Math.max(0.5, asset.durationSec ?? 2), asset)}
                  className="flex w-full items-start gap-2 rounded-md border border-line bg-well px-2 py-1.5 text-left transition-colors hover:border-accent/35 disabled:opacity-45">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10.5px] text-ink2">{v.speaker}: “{v.text.slice(0, 40)}”</span>
                    <span className="block text-[9px] text-ink3">{v.emotion}{asset ? ` · ${formatSeconds(asset.durationSec ?? 0)}` : ' · no take yet'}</span>
                  </span>
                  {asset?.demo && <PrevisBadge label="SCRATCH TAKE" />}
                </button>
              );
            })}
          </div>
        ) : <EmptyState compact icon={<Type size={15} />} title="No dialogue lines" body="Extract dialogue from the screenplay in the Voice stage." />
      )}
      <Tip label="Double-click or drag to place on the timeline"><span className="block text-center text-[9.5px] text-ink3">double-click to place at playhead</span></Tip>
    </div>
  );
}
