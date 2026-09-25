'use client';
import * as React from 'react';
import {
  Eye, EyeOff, Volume2, VolumeX, Lock, Unlock, Plus, Trash2, Scissors, Magnet,
  ChevronDown, ChevronUp, AudioLines, Film, Type, Square, Layers, Link2
} from 'lucide-react';
import { cx, Tip, Badge } from '@/components/ui/primitives';
import { Popover, MenuItem } from '@/components/ui/overlays';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';
import { rippleTrim } from '@/lib/timeline/ops';
import { timecode } from '@/lib/timeline/factory';
import type { Clip, Timeline as TL, Track } from '@/types';

const HEADER_W = 132;
const RULER_H = 26;

/** Multi-track timeline: drag, trim, ripple, split, snap, razor, per-track controls. */
export function Timeline() {
  const editorTl = useEditor(s => s.timeline);
  const projectTl = useProject(s => s.timeline);
  const tl = editorTl ?? projectTl;
  const zoom = useEditor(s => s.zoom);
  const setZoom = useEditor(s => s.set);
  const playhead = useEditor(s => s.playhead);
  const setPlayhead = useEditor(s => s.setPlayhead);
  const selection = useEditor(s => s.selection);
  const select = useEditor(s => s.select);
  const apply = useEditor(s => s.apply);
  const snap = useEditor(s => s.snap);
  const tool = useEditor(s => s.tool);
  const assets = useProject(s => s.assets);

  const scroller = React.useRef<HTMLDivElement>(null);
  const laneRef = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState<null | {
    mode: 'move' | 'trim-in' | 'trim-out' | 'scrub'; clipId: string; startX: number;
    origStart: number; origDur: number; origIn: number; trackId: string; moved: boolean;
  }>(null);
  const [dropTarget, setDropTarget] = React.useState<{ trackId: string; time: number } | null>(null);
  const [ctx, setCtx] = React.useState<{ x: number; y: number; clipId: string } | null>(null);
  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);

  const duration = Math.max(tl?.durationSec ?? 0, 30);
  const pps = zoom;
  const width = duration * pps + 200;

  const timeAt = React.useCallback((clientX: number) => {
    const el = laneRef.current; if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + (scroller.current?.scrollLeft ?? 0) - HEADER_W) / pps);
  }, [pps]);

  /* ── ruler scrub ─────────────────────────────────────────── */
  const onRulerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setPlayhead(timeAt(e.clientX), { snap: false });
    setDrag({ mode: 'scrub', clipId: '', startX: e.clientX, origStart: 0, origDur: 0, origIn: 0, trackId: '', moved: false });
  };

  /* ── clip interactions ───────────────────────────────────── */
  const onClipDown = (e: React.PointerEvent, clip: Clip, mode: 'move' | 'trim-in' | 'trim-out') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (clip.locked) return;
    if (tool === 'razor' && mode === 'move') {
      apply([{ op: 'splitClip', clipId: clip.id, at: timeAt(e.clientX) }], { label: 'razor' });
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    select([clip.id], e.shiftKey || e.metaKey || e.ctrlKey);
    setDrag({ mode, clipId: clip.id, startX: e.clientX, origStart: clip.start, origDur: clip.duration, origIn: clip.in, trackId: clip.trackId, moved: false });
    document.body.classList.add('grabbing');
  };

  React.useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.mode === 'scrub') { setPlayhead(timeAt(e.clientX), { snap: false }); return; }
      const clip = findClip(tl, drag.clipId); if (!clip) return;
      const dx = (e.clientX - drag.startX) / pps;
      if (Math.abs(dx) > 0.005) setDrag(d => d ? { ...d, moved: true } : d);
      if (drag.mode === 'move') {
        let next = Math.max(0, drag.origStart + dx);
        if (snap && tl) {
          const edges = [0, playhead];
          for (const tr of tl.tracks) for (const c of tr.clips) if (c.id !== clip.id) { edges.push(c.start, c.start + c.duration); }
          for (const m of tl?.markers ?? []) edges.push(m.t);
          for (const candidate of [next, next + clip.duration]) {
            const hit = edges.find(x => Math.abs(x - candidate) < 8 / pps);
            if (hit !== undefined) next = candidate === next ? hit : Math.max(0, hit - clip.duration);
          }
        }
        // live preview without pushing undo history
        useEditor.setState(s => s.timeline ? ({
          timeline: { ...s.timeline, tracks: s.timeline.tracks.map(t => t.id !== clip.trackId ? t : { ...t, clips: t.clips.map(c => c.id !== clip.id ? c : { ...c, start: next }) }) }
        }) : s);
      } else {
        const newTime = Math.max(0, timeAt(e.clientX));
        const ops = rippleTrim(tl!, drag.clipId, drag.mode === 'trim-in' ? 'in' : 'out', newTime);
        if (ops.length) useEditor.setState(s => s.timeline ? ({ timeline: applyPreview(s.timeline, ops) }) : s);
      }
    };
    const up = (e: PointerEvent) => {
      document.body.classList.remove('grabbing');
      const clip = findClip(tl, drag.clipId);
      if (drag.mode === 'scrub') { setDrag(null); return; }
      if (!clip || !drag.moved) { setDrag(null); return; }
      if (drag.mode === 'move') {
        const dx = (e.clientX - drag.startX) / pps;
        let next = Math.max(0, drag.origStart + dx);
        if (snap && tl) {
          const edges = [0, playhead];
          for (const tr of tl.tracks) for (const c of tr.clips) if (c.id !== clip.id) { edges.push(c.start, c.start + c.duration); }
          for (const candidate of [next, next + clip.duration]) {
            const hit = edges.find(x => Math.abs(x - candidate) < 8 / pps);
            if (hit !== undefined) next = candidate === next ? hit : Math.max(0, hit - clip.duration);
          }
        }
        // determine target track from pointer Y
        const trackId = trackAtY(tl, e.clientY) ?? drag.trackId;
        apply([{ op: 'moveClip', clipId: drag.clipId, start: Math.round(next * 1000) / 1000, trackId }], { label: 'move clip' });
      } else {
        const ops = rippleTrim(tl!, drag.clipId, drag.mode === 'trim-in' ? 'in' : 'out', timeAt(e.clientX));
        if (ops.length) apply(ops, { label: 'trim' });
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, tl, pps, snap, playhead, apply, setPlayhead, timeAt]);

  /* ── drag & drop from the media panel ────────────────────── */
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-afs-asset')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const trackId = trackAtY(tl, e.clientY);
    setDropTarget(trackId ? { trackId, time: timeAt(e.clientX) } : null);
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/x-afs-asset');
    setDropTarget(null);
    if (!raw || !tl) return;
    try {
      const asset = JSON.parse(raw) as { id: string; name?: string; kind: string; durationSec?: number; url?: string; mimeType?: string; demo?: boolean };
      const trackId = trackAtY(tl, e.clientY);
      const track = tl.tracks.find(t => t.id === trackId);
      if (!track) return;
      const isAudio = track.kind === 'audio';
      let t = Math.max(0, timeAt(e.clientX));
      if (snap) {
        const edges = [0, playhead];
        for (const tr of tl.tracks) for (const c of tr.clips) { edges.push(c.start, c.start + c.duration); }
        const hit = edges.find(x => Math.abs(x - t) < 10 / pps);
        if (hit !== undefined) t = hit;
      }
      const dur = Math.max(0.5, asset.durationSec ?? (isAudio ? 3 : asset.kind === 'image' ? 4 : 5));
      apply([{
        op: 'addClip', track: track.index,
        clip: {
          trackId: track.id,
          kind: (isAudio ? 'audio' : (asset.mimeType?.startsWith('image/') || asset.kind === 'image' ? 'image' : 'video')) as Clip['kind'],
          name: String(asset.name ?? asset.id), assetId: asset.id,
          srcUrl: asset.url ?? undefined, demo: Boolean(asset.demo),
          start: t, duration: dur, in: 0, out: dur
        }
      }], { label: 'add clip' });
      select([]);
    } catch { /* malformed payload */ }
  };

  if (!tl) return <div className="flex h-full items-center justify-center text-[12px] text-ink3">No timeline loaded</div>;

  const videoTracks = tl.tracks.filter(t => t.kind === 'video').sort((a, b) => b.index - a.index);
  const audioTracks = tl.tracks.filter(t => t.kind === 'audio').sort((a, b) => a.index - b.index);

  return (
    <div className="flex h-full min-h-0 flex-col bg-deep" onContextMenu={e => e.preventDefault()}>
      {/* toolbar */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line bg-panel px-2 py-1.5">
        <Tip label="Split at playhead (S)"><button type="button" className="icon-btn" onClick={() => useEditor.getState().splitAtPlayhead()}><Scissors size={13} /></button></Tip>
        <Tip label={snap ? 'Snapping on (N)' : 'Snapping off (N)'}>
          <button type="button" className="icon-btn" data-on={snap} onClick={() => useEditor.getState().set({ snap: !snap })}><Magnet size={13} /></button>
        </Tip>
        <Tip label="Ripple delete selection"><button type="button" className="icon-btn" onClick={() => useEditor.getState().deleteSelected(true)}><Trash2 size={13} /></button></Tip>
        <div className="vdivider mx-1 self-stretch" />
        <Tip label="Zoom out (−)"><button type="button" className="icon-btn" onClick={() => setZoom({ zoom: Math.max(4, zoom / 1.3) })}><ChevronDown size={13} className="rotate-90" /></button></Tip>
        <input type="range" className="rng w-24" min={4} max={400} step={1} value={zoom}
          style={{ ['--pct' as never]: `${((zoom - 4) / 396) * 100}%` }}
          onChange={e => setZoom({ zoom: Number(e.target.value) })} />
        <Tip label="Zoom in (+)"><button type="button" className="icon-btn" onClick={() => setZoom({ zoom: Math.min(400, zoom * 1.3) })}><ChevronUp size={13} className="rotate-90" /></button></Tip>
        <span className="mono ml-1 w-[86px] shrink-0 text-[10.5px] text-ink3 tnum">{pps.toFixed(0)} px/s</span>
        <div className="vdivider mx-1 self-stretch" />
        <Tip label="Add video track"><button type="button" className="icon-btn" onClick={() => useEditor.getState().addTrack('video')}><Film size={13} /></button></Tip>
        <Tip label="Add audio track"><button type="button" className="icon-btn" onClick={() => useEditor.getState().addTrack('audio')}><AudioLines size={13} /></button></Tip>
        <div className="flex-1" />
        <Badge tone="mut" className="tnum">{selection.length} selected</Badge>
        <Badge tone="mut" className="tnum">{timecode(tl.durationSec, tl.fps)}</Badge>
      </div>

      <div ref={scroller} className="scroll-thin relative min-h-0 flex-1 overflow-auto"
        onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDropTarget(null)}>
        <div className="relative" style={{ width: HEADER_W + width }}>
          {/* ruler */}
          <div className="tl-ruler sticky top-0 z-30 flex h-[26px] border-b border-line" style={{ width: HEADER_W + width }}>
            <div className="sticky left-0 z-10 flex h-full shrink-0 items-center justify-center border-r border-line bg-well text-[9px] uppercase tracking-wider text-ink3" style={{ width: HEADER_W }}>
              {tl.fps}fps
            </div>
            <div className="relative h-full flex-1 cursor-ew-resize select-none" onPointerDown={onRulerDown}>
              <RulerMarks duration={duration} pps={pps} fps={tl.fps} />
              {tl.markers.map(m => (
                <span key={m.id} className="absolute top-0 z-20 flex h-full flex-col items-center" style={{ left: m.t * pps - 4 }}>
                  <span className="h-2 w-2 rotate-45 bg-accent" />
                  <Tip label={m.label}><span className="h-full w-px bg-accent/40" /></Tip>
                </span>
              ))}
              {(useEditor.getState().inPoint != null) && <span className="absolute top-0 h-full w-px bg-ok/70" style={{ left: (useEditor.getState().inPoint ?? 0) * pps }} />}
              {(useEditor.getState().outPoint != null) && <span className="absolute top-0 h-full w-px bg-bad/70" style={{ left: (useEditor.getState().outPoint ?? 0) * pps }} />}
              <span className="tl-playhead" style={{ left: playhead * pps }}>
                <span className="absolute -left-[5px] -top-[1px] h-[7px] w-[11px] bg-accent-bright" style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }} />
              </span>
            </div>
          </div>

          {/* tracks */}
          <div className="relative flex" style={{ width: HEADER_W + width }} ref={laneRef}
            onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDropTarget(null)}>
            {/* headers */}
            <div className="sticky left-0 z-20 shrink-0 border-r border-line bg-well" style={{ width: HEADER_W }}>
              {[...videoTracks, ...audioTracks].map(tr => (
                <TrackHeader key={tr.id} track={tr} tl={tl} active={useEditor.getState().activeTrack === tr.id}
                  onSelect={() => useEditor.getState().selectTrack(tr.id)} />
              ))}
              <button type="button" className="flex h-[26px] w-full items-center justify-center gap-1 border-t border-line-soft text-[10px] text-ink3 hover:text-ink2"
                onClick={() => useEditor.getState().addTrack('video')}><Plus size={10} />track</button>
            </div>

            {/* lanes */}
            <div className="relative flex-1" style={{ width }}
              onDragOver={onDragOver} onDrop={onDrop} onDragLeave={() => setDropTarget(null)}>
              {[...videoTracks, ...audioTracks].map(tr => (
                <div key={tr.id} data-track-id={tr.id} className={cx('tl-track relative border-b border-line-soft/70', tr.index % 2 === 0 && 'bg-well', tr.locked && 'opacity-70')}
                  style={{ height: tr.height }}
                  onPointerDown={e => { if (e.target === e.currentTarget) { select([]); setPlayhead(timeAt(e.clientX), { snap: false }); } }}>
                  {tr.clips.map(c => (
                    <ClipView key={c.id} clip={c} track={tr} pps={pps} selected={selection.includes(c.id)}
                      asset={c.assetId ? assetById.get(c.assetId) ?? null : null}
                      onDown={e => onClipDown(e, c, 'move')}
                      onTrimDown={mode => e => onClipDown(e, c, mode)}
                      onContext={(x, y) => { select([c.id]); setCtx({ x, y, clipId: c.id }); }}
                      tool={tool} />
                  ))}
                  {dropTarget?.trackId === tr.id && (
                    <span className="pointer-events-none absolute inset-y-0 w-px bg-accent shadow-[0_0_10px_#D99A32]" style={{ left: dropTarget.time * pps }} />
                  )}
                </div>
              ))}
              {/* playhead over lanes */}
              <span className="tl-playhead" style={{ left: playhead * pps, top: 0, bottom: 0 }} />
            </div>
          </div>
        </div>
      </div>

      {ctx && <ClipContextMenu x={ctx.x} y={ctx.y} clipId={ctx.clipId} tl={tl} onClose={() => setCtx(null)} />}
    </div>
  );
}

/* ── ruler ────────────────────────────────────────────────── */
function RulerMarks({ duration, pps, fps }: { duration: number; pps: number; fps: number }) {
  const target = 78;
  const candidates = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = candidates.find(c => c * pps >= target) ?? 600;
  const marks: React.ReactNode[] = [];
  for (let t = 0; t <= duration + step; t += step) {
    const major = step >= 1 ? Number.isInteger(t) : true;
    marks.push(
      <span key={t} className="absolute top-0 flex h-full flex-col justify-end" style={{ left: t * pps }}>
        {major && <span className="mb-0.5 pl-1 font-mono text-[9px] text-ink3 tnum">{label(t, step)}</span>}
        <span className={cx('w-px', major ? 'h-2 bg-line' : 'h-1 bg-line-soft')} />
      </span>
    );
    if (step >= 1 && pps > 26) {
      const sub = step / 4;
      for (let k = 1; k < 4; k++) {
        const st = t + sub * k;
        if (st > duration + step) break;
        marks.push(<span key={`${t}-${k}`} className="absolute bottom-0 h-1 w-px bg-line-soft/60" style={{ left: st * pps }} />);
      }
    }
  }
  void fps;
  return <>{marks}</>;
}
function label(t: number, step: number) {
  if (step >= 60) return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  if (step >= 1) return t % 60 === 0 ? `${Math.floor(t / 60)}:00` : `${t}s`;
  return `${t.toFixed(2)}s`;
}

/* ── track header ─────────────────────────────────────────── */
function TrackHeader({ track, tl, onSelect, active }: { track: Track; tl: TL; onSelect: () => void; active: boolean }) {
  const apply = useEditor.getState().apply;
  const patch = (p: Partial<Track>) => {
    const next = { ...tl, tracks: tl.tracks.map(t => t.id === track.id ? { ...t, ...p } : t) };
    useEditor.setState({ timeline: next, dirty: true });
    void useEditor.getState().flush();
  };
  return (
    <div className={cx('group flex items-center gap-1 border-b border-line-soft/70 px-1.5', active && 'bg-accent/[0.06]')}
      style={{ height: track.height }} onPointerDown={onSelect}>
      <span className={cx('flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[8px] font-bold',
        track.kind === 'video' ? 'border-accent/30 bg-accent/10 text-accent-bright' : 'border-ok/25 bg-ok/10 text-ok')}>
        {track.kind === 'video' ? <Film size={9} /> : <AudioLines size={9} />}
      </span>
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-ink2">{track.name}</span>
      <span className="flex shrink-0 items-center gap-px opacity-60 transition-opacity group-hover:opacity-100">
        {track.kind === 'audio' && (
          <Tip label={track.muted ? 'Unmute' : 'Mute'}>
            <button type="button" className={cx('icon-btn h-[18px] w-[18px]', track.muted && 'text-bad')} onClick={e => { e.stopPropagation(); patch({ muted: !track.muted }); }}>
              {track.muted ? <VolumeX size={9} /> : <Volume2 size={9} />}
            </button>
          </Tip>
        )}
        {track.kind === 'video' && (
          <Tip label={track.hidden ? 'Show' : 'Hide'}>
            <button type="button" className={cx('icon-btn h-[18px] w-[18px]', track.hidden && 'text-bad')} onClick={e => { e.stopPropagation(); patch({ hidden: !track.hidden }); }}>
              {track.hidden ? <EyeOff size={9} /> : <Eye size={9} />}
            </button>
          </Tip>
        )}
        <Tip label="Solo">
          <button type="button" className={cx('icon-btn h-[18px] w-[18px] text-[9px] font-bold', track.solo && 'text-accent-bright')} onClick={e => { e.stopPropagation(); patch({ solo: !track.solo }); }}>S</button>
        </Tip>
        <Tip label={track.locked ? 'Unlock' : 'Lock'}>
          <button type="button" className={cx('icon-btn h-[18px] w-[18px]', track.locked && 'text-accent-bright')} onClick={e => { e.stopPropagation(); patch({ locked: !track.locked }); }}>
            {track.locked ? <Lock size={9} /> : <Unlock size={9} />}
          </button>
        </Tip>
      </span>
      {void apply}
    </div>
  );
}

/* ── clip ─────────────────────────────────────────────────── */
function ClipView({ clip, track, pps, selected, asset, onDown, onTrimDown, onContext, tool }: {
  clip: Clip; track: Track; pps: number; selected: boolean; asset: { url?: string; mimeType?: string; demo?: boolean; kind?: string } | null;
  onDown: (e: React.PointerEvent) => void; onTrimDown: (m: 'trim-in' | 'trim-out') => (e: React.PointerEvent) => void;
  onContext: (x: number, y: number) => void; tool: string;
}) {
  const left = clip.start * pps;
  const w = Math.max(4, clip.duration * pps);
  const isAudio = track.kind === 'audio';
  const peaks = clip.waveformPeaks ?? ((asset as any)?.meta?.peaks as number[] | undefined) ?? null;
  const bg = asset?.url && !isAudio && (asset.mimeType?.startsWith('image/') || asset.mimeType?.startsWith('video/') || asset.mimeType === 'application/json')
    ? { backgroundImage: `url(${asset.url})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {};

  return (
    <div className={cx('tl-clip group/clip', selected && 'z-20')} data-sel={selected}
      style={{ left, width: w, top: 2, bottom: 2, cursor: tool === 'razor' ? 'crosshair' : track.locked || clip.locked ? 'not-allowed' : 'grab', ...bg }}
      onPointerDown={onDown}
      onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onContext(e.clientX, e.clientY); }}
      title={`${clip.name} · ${clip.duration.toFixed(2)}s`}>
      {/* colour wash so clips read on dark media */}
      <span className="pointer-events-none absolute inset-0" style={{ background: `linear-gradient(180deg, ${clip.color}F2, ${clip.color}C4)`, opacity: isAudio ? 0.92 : 0.62 }} />
      {!isAudio && asset?.url && <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/25" />}

      {/* trim handles */}
      {!clip.locked && !track.locked && <>
        <span className="tl-handle left-0" onPointerDown={onTrimDown('trim-in')} />
        <span className="tl-handle right-0" onPointerDown={onTrimDown('trim-out')} />
      </>}

      {/* content */}
      {isAudio ? (
        <span className="pointer-events-none absolute inset-0 flex items-center gap-px overflow-hidden px-1">
          {(peaks ?? Array.from({ length: Math.max(4, Math.floor(w / 3)) }, (_, i) => 0.3 + ((i * 37) % 60) / 100)).slice(0, Math.max(4, Math.floor(w / 3))).map((v, i) => (
            <span key={i} className="min-w-px flex-1 rounded-sm bg-ok/70" style={{ height: `${Math.max(6, Math.min(100, v * 100))}%` }} />
          ))}
        </span>
      ) : clip.kind === 'text' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 px-1.5">
          <Type size={10} className="shrink-0 text-ink/70" />
          <span className="truncate text-[9.5px] font-medium text-ink/90">{clip.text?.content ?? clip.name}</span>
        </span>
      ) : clip.kind === 'adjustment' ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center gap-1 bg-elevated/85 px-1.5">
          <Layers size={10} className="shrink-0 text-ink/70" /><span className="truncate text-[9.5px] text-ink/85">Adjustment</span>
        </span>
      ) : null}

      {/* label + badges */}
      <span className="pointer-events-none absolute inset-x-1 bottom-0.5 flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate text-[9.5px] font-medium text-ink/90 drop-shadow-[0_1px_2px_rgba(0,0,0,.9)]">{clip.name}</span>
        {clip.speed !== 1 && <span className="shrink-0 rounded bg-black/60 px-1 font-mono text-[8px] text-accent-bright">{clip.speed.toFixed(2)}×</span>}
        {(clip.transitionIn !== 'none' && clip.transitionIn !== 'cut') || (clip.transitionOut !== 'none' && clip.transitionOut !== 'cut')
          ? <span className="shrink-0 rounded bg-black/60 px-1 text-[8px] text-info">fx</span> : null}
        {clip.grade && <span className="shrink-0 rounded bg-black/60 px-1 text-[8px] text-accent-bright">grade</span>}
        {clip.effects?.length > 0 && <span className="shrink-0 rounded bg-black/60 px-1 text-[8px] text-info">{clip.effects.length}</span>}
        {asset?.demo && <span className="shrink-0 rounded bg-accent/85 px-1 text-[7.5px] font-bold text-accent-on">PREVIS</span>}
        {clip.locked && <Lock size={8} className="shrink-0 text-ink/70" />}
        {clip.linked?.length > 0 && <Link2 size={8} className="shrink-0 text-ink/60" />}
      </span>
      {clip.muted && <span className="pointer-events-none absolute inset-0 bg-black/45" />}
    </div>
  );
}

/* ── context menu ─────────────────────────────────────────── */
function ClipContextMenu({ x, y, clipId, tl, onClose }: { x: number; y: number; clipId: string; tl: TL; onClose: () => void }) {
  const apply = useEditor.getState().apply;
  const clip = findClip(tl, clipId);
  React.useEffect(() => {
    const h = () => onClose();
    window.addEventListener('pointerdown', h); window.addEventListener('keydown', h);
    return () => { window.removeEventListener('pointerdown', h); window.removeEventListener('keydown', h); };
  }, [onClose]);
  if (!clip) return null;
  const at = (e: React.MouseEvent) => { e.stopPropagation(); };
  return (
    <div className="fixed z-[400] w-[210px] rounded-lg border border-line bg-pop p-1 shadow-pop animate-floatUp"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 320) }} onPointerDown={at} onClick={at}>
      <div className="px-2.5 py-1.5 text-[10px] text-ink3">{clip.name}</div>
      <MenuItem icon={<Scissors size={13} />} label="Split at playhead" onClick={() => { apply([{ op: 'splitClip', clipId, at: useEditor.getState().playhead }]); onClose(); }} />
      <MenuItem icon={<Trash2 size={13} />} label="Delete" hint="Del" onClick={() => { useEditor.getState().deleteSelected(false); onClose(); }} />
      <MenuItem icon={<Trash2 size={13} />} label="Ripple delete" hint="⇧Del" onClick={() => { useEditor.getState().deleteSelected(true); onClose(); }} />
      <div className="my-1 h-px bg-line-soft" />
      <MenuItem icon={<Lock size={13} />} label={clip.locked ? 'Unlock clip' : 'Lock clip'} onClick={() => { apply([{ op: 'updateClip', clipId, patch: { locked: !clip.locked } }]); onClose(); }} />
      <MenuItem icon={<VolumeX size={13} />} label={clip.muted ? 'Unmute clip' : 'Mute clip'} onClick={() => { apply([{ op: 'updateClip', clipId, patch: { muted: !clip.muted } }]); onClose(); }} />
      <div className="my-1 h-px bg-line-soft" />
      <div className="px-2.5 py-1 text-[10px] text-ink3">Transition out</div>
      {(['cut', 'crossfade', 'dip-black', 'wipe-left', 'zoom', 'blur'] as const).map(k => (
        <MenuItem key={k} label={k} onClick={() => { apply([{ op: 'addTransition', clipId, edge: 'out', kind: k, dur: 0.5 }]); onClose(); }} />
      ))}
      <div className="my-1 h-px bg-line-soft" />
      <MenuItem icon={<Square size={13} />} label="Fit to frame" onClick={() => { apply([{ op: 'updateClip', clipId, patch: { transform: { ...clip.transform, x: 0, y: 0, scale: 1, rotation: 0 } } }]); onClose(); }} />
    </div>
  );
}

/* ── helpers ──────────────────────────────────────────────── */
function findClip(tl: TL | null, id: string): Clip | null {
  if (!tl) return null;
  for (const t of tl.tracks) { const c = t.clips.find(c => c.id === id); if (c) return c; }
  return null;
}
function trackAtY(tl: TL | null, clientY: number): string | null {
  if (!tl) return null;
  const lanes = document.querySelectorAll<HTMLElement>('[data-track-id]');
  const containerTop = lanes[0]?.getBoundingClientRect().top ?? 0;
  for (const lane of lanes) {
    const rect = lane.getBoundingClientRect();
    if (clientY >= rect.top && clientY < rect.bottom) return lane.dataset.trackId ?? null;
  }
  return null;
}
function applyPreview(tl: TL, ops: Parameters<typeof rippleTrim>[1] extends never ? never : any[]): TL {
  // local, non-undoable preview during a drag
  let out = tl;
  for (const op of ops) {
    if (op.op === 'trimClip') {
      out = { ...out, tracks: out.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.id !== op.clipId ? c : { ...c, start: op.start ?? c.start, duration: op.duration ?? c.duration, in: c.in }) })) };
    } else if (op.op === 'moveClip') {
      out = { ...out, tracks: out.tracks.map(t => ({ ...t, clips: t.clips.map(c => c.id !== op.clipId ? c : { ...c, start: op.start }) })) };
    } else if (op.op === 'removeClip') {
      out = { ...out, tracks: out.tracks.map(t => ({ ...t, clips: t.clips.filter(c => c.id !== op.clipId) })) };
    }
  }
  return out;
}
