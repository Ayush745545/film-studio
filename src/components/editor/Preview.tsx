'use client';
import * as React from 'react';
import {
  Play, Pause, SkipBack, SkipForward, ChevronsLeft, ChevronsRight, Maximize2, Minimize2,
  Frame, Grid3x3, Volume2, VolumeX, Monitor, Gauge, AlertTriangle, Cpu
} from 'lucide-react';
import { cx, Tip, Badge, Segmented } from '@/components/ui/primitives';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';
import { TimelineRenderer } from '@/lib/client/renderer';
import { PlaybackEngine } from '@/lib/client/playback';
import { timecode } from '@/lib/timeline/factory';

/**
 * Program monitor.
 *
 * A real canvas compositor driven by the WebGL colour pipeline, with an
 * AudioContext-clocked transport so picture and sound stay in sync. Supports
 * fit/50/100/200% zoom, safe areas, frame stepping, playback quality and
 * fullscreen — the same renderer is reused for in-browser export.
 */
export function Preview({ compact }: { compact?: boolean }) {
  const editorTl = useEditor(s => s.timeline);
  const projectTl = useProject(s => s.timeline);
  const tl = editorTl ?? projectTl;
  const playhead = useEditor(s => s.playhead);
  const playing = useEditor(s => s.playing);
  const rate = useEditor(s => s.rate);
  const bypass = useEditor(s => s.bypass);
  const set = useEditor(s => s.set);
  const setPlayhead = useEditor(s => s.setPlayhead);
  const assets = useProject(s => s.assets);

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const renderer = React.useRef<TimelineRenderer | null>(null);
  const engine = React.useRef<PlaybackEngine | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const [zoom, setZoom] = React.useState<number>(0);           // 0 = fit
  const [safe, setSafe] = React.useState(false);
  const [quality, setQuality] = React.useState<'full' | 'half' | 'quarter'>('full');
  const [muted, setMuted] = React.useState(false);
  const [volume, setVolume] = React.useState(0.9);
  const [fullscreen, setFullscreen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [scale, setScale] = React.useState(1);

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);

  /* ── renderer + engine lifecycle ─────────────────────────── */
  React.useEffect(() => {
    if (!canvasRef.current) return;
    const r = new TimelineRenderer({ canvas: canvasRef.current });
    r.setResolvers(
      id => (id ? assetById.get(id)?.url ?? null : null),
      id => { const a = id ? assetById.get(id) : null; return a ? { ...(a.meta ?? {}), mimeType: a.mimeType, mime: a.mimeType } : {}; }
    );
    renderer.current = r;
    const e = new PlaybackEngine();
    e.resolveUrl = (id, clip) => (id ? assetById.get(id)?.url ?? null : clip.srcUrl);
    e.onEnded = () => { useEditor.setState({ playing: false }); };
    engine.current = e;
    return () => { r.destroy(); e.destroy(); renderer.current = null; engine.current = null; };
    // asset map identity changes often; re-binding resolvers is cheap and keeps media fresh
  }, [assetById]);

  React.useEffect(() => { renderer.current?.setTimeline(tl); engine.current?.setTimeline(tl); }, [tl]);
  React.useEffect(() => { if (renderer.current) renderer.current.quality = quality; }, [quality]);
  React.useEffect(() => { engine.current?.setMuted(muted); }, [muted]);
  React.useEffect(() => { engine.current?.setVolume(volume); }, [volume]);
  React.useEffect(() => { engine.current?.setRate(rate); }, [rate]);
  React.useEffect(() => { if (renderer.current) renderer.current.overlays.safeAreas = safe; }, [safe]);

  /* ── transport ───────────────────────────────────────────── */
  React.useEffect(() => {
    const eng = engine.current;
    if (!eng) return;
    if (playing) {
      void eng.play(playhead);
      const loop = () => {
        const t = eng.time();
        const total = useEditor.getState().timeline?.durationSec ?? 0;
        if (total && t >= total) { useEditor.setState({ playing: false }); return; }
        useEditor.setState({ playhead: t });
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
    } else {
      eng.pause();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, rate]);

  /* ── draw ────────────────────────────────────────────────── */
  React.useEffect(() => {
    let alive = true;
    const draw = async () => {
      const r = renderer.current;
      if (!r || !tl || !alive) return;
      const w = tl.width, h = tl.height;
      const ok = await r.render(playhead, { skipGrade: useEditor.getState().bypass });
      setPending(!ok);
      r.preload(playhead, playing ? 8 : 2);
      void w; void h;
    };
    void draw();
  }, [playhead, tl, playing, bypass]);

  /* ── fit sizing ──────────────────────────────────────────── */
  React.useEffect(() => {
    const el = wrapRef.current;
    if (!el || !tl) return;
    const compute = () => {
      const box = el.getBoundingClientRect();
      const pad = 28;
      const availW = Math.max(80, box.width - pad * 2);
      const availH = Math.max(60, box.height - pad * 2);
      const fit = Math.min(availW / tl.width, availH / tl.height);
      const s = zoom === 0 ? fit : zoom;
      setScale(s);
      if (renderer.current) renderer.current.resize(tl.width, tl.height);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tl, zoom]);

  const total = tl?.durationSec ?? 0;
  const fps = tl?.fps ?? 24;
  const frame = Math.floor(playhead * fps);

  const toggleFullscreen = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) { void el.requestFullscreen?.().then(() => setFullscreen(true)).catch(() => setFullscreen(true)); }
    else { void document.exitFullscreen?.().then(() => setFullscreen(false)); }
  };

  return (
    <div ref={wrapRef} className={cx('relative flex h-full min-h-0 flex-col overflow-hidden bg-stage', fullscreen && 'bg-black')}>
      {/* canvas area */}
      <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-3.5"
        onDoubleClick={toggleFullscreen}>
        {tl ? (
          <div className="relative shadow-[0_24px_70px_-24px_rgba(0,0,0,.95)]" style={{ width: tl.width * scale, height: tl.height * scale }}>
            <canvas ref={canvasRef} width={tl.width} height={tl.height}
              className="h-full w-full rounded-[2px] bg-black" style={{ imageRendering: quality === 'quarter' ? 'auto' : 'auto' }} />
            {/* letterbox guides at scope ratios */}
            {safe && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute inset-[5%] border border-dashed border-white/25" />
                <div className="absolute inset-[10%] border border-dashed border-white/12" />
                <div className="absolute inset-y-0 left-1/3 w-px bg-white/8" />
                <div className="absolute inset-y-0 left-2/3 w-px bg-white/8" />
                <div className="absolute inset-x-0 top-1/3 h-px bg-white/8" />
                <div className="absolute inset-x-0 top-2/3 h-px bg-white/8" />
              </div>
            )}
            {pending && (
              <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-1.5 rounded border border-accent/30 bg-black/70 px-2 py-1 text-[9.5px] text-accent-bright backdrop-blur">
                <Cpu size={10} className="animate-pulseDot" />loading media…
              </div>
            )}
            {total === 0 && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
                <Frame size={20} className="text-ink3" />
                <p className="text-[12px] text-ink2">Empty timeline</p>
                <p className="max-w-[36ch] text-[10.5px] leading-relaxed text-ink3">
                  Drag media from the left panel onto a track, or assemble the cut from your generated shots.
                </p>
              </div>
            )}
            {tl && (tl.width === 0 || tl.height === 0) && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center text-ink3">
                <AlertTriangle size={20} />
                <p className="text-[12px]">Invalid timeline dimensions ({tl.width}×{tl.height})</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[12px] text-ink3">No timeline</p>
        )}
      </div>

      {/* transport */}
      <div className={cx('sheen relative flex shrink-0 flex-wrap items-center gap-1.5 border-t border-line bg-panel-grad px-2.5 py-2', compact && 'py-1.5')}>
        <Tip label="Go to start (Home)"><button type="button" className="icon-btn" onClick={() => { set({ playing: false }); setPlayhead(0, { snap: false }); }}><ChevronsLeft size={14} /></button></Tip>
        <Tip label="Previous frame (←)"><button type="button" className="icon-btn" onClick={() => { set({ playing: false }); useEditor.getState().nudge(-1); }}><SkipBack size={13} /></button></Tip>
        <Tip label={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <button type="button" className={cx('icon-btn h-8 w-8', playing && 'text-accent-bright')} data-on={playing}
            onClick={() => set({ playing: !playing })}>
            {playing ? <Pause size={15} /> : <Play size={15} className="translate-x-px" />}
          </button>
        </Tip>
        <Tip label="Next frame (→)"><button type="button" className="icon-btn" onClick={() => { set({ playing: false }); useEditor.getState().nudge(1); }}><SkipForward size={13} /></button></Tip>
        <Tip label="Go to end (End)"><button type="button" className="icon-btn" onClick={() => { set({ playing: false }); setPlayhead(total, { snap: false }); }}><ChevronsRight size={14} /></button></Tip>

        <div className="mx-1 vdivider self-stretch" />
        <div className="flex items-baseline gap-1.5 rounded-md border border-line bg-deep px-2 py-1 shadow-inset">
          <span className="mono text-[13px] font-semibold text-accent-bright tnum">{timecode(playhead, fps)}</span>
          <span className="mono text-[9.5px] text-ink3">f{frame}</span>
        </div>
        <span className="mono text-[10px] text-ink3 tnum">/ {timecode(total, fps)}</span>

        <div className="mx-1 vdivider self-stretch" />
        <Segmented size="sm" value={String(rate)} onChange={v => set({ rate: Number(v) })}
          options={[{ value: '-2', label: '−2×' }, { value: '-1', label: '−1×' }, { value: '1', label: '1×' }, { value: '2', label: '2×' }]} />

        <div className="flex-1" />

        <Tip label="Safe areas & guides">
          <button type="button" className="icon-btn" data-on={safe} onClick={() => setSafe(s => !s)}><Grid3x3 size={13} /></button>
        </Tip>
        <Segmented size="sm" value={quality} onChange={v => setQuality(v as never)}
          options={[{ value: 'quarter', label: '¼', title: 'Fast scrubbing' }, { value: 'half', label: '½', title: 'Balanced' }, { value: 'full', label: 'Full', title: 'Full resolution' }]} />
        <Segmented size="sm" value={String(zoom)} onChange={v => setZoom(Number(v))}
          options={[{ value: '0', label: 'Fit' }, { value: '0.5', label: '50%' }, { value: '1', label: '100%' }, { value: '2', label: '200%' }]} />

        <div className="mx-1 vdivider self-stretch" />
        <Tip label={muted ? 'Unmute' : 'Mute'}>
          <button type="button" className="icon-btn" data-on={!muted} onClick={() => setMuted(m => !m)}>{muted ? <VolumeX size={13} /> : <Volume2 size={13} />}</button>
        </Tip>
        <input type="range" className="rng w-16" min={0} max={100} value={Math.round(volume * 100)}
          style={{ ['--pct' as never]: `${volume * 100}%` }} onChange={e => setVolume(Number(e.target.value) / 100)} />
        <Tip label="Fullscreen (double-click the picture)">
          <button type="button" className="icon-btn" onClick={toggleFullscreen}>{fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}</button>
        </Tip>
      </div>

      {/* status line */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line-soft bg-deep px-2.5 py-1 text-[9.5px] text-ink3">
        <Monitor size={10} />
        <span className="tnum">{tl?.width ?? 0}×{tl?.height ?? 0}</span>
        <span>·</span><span>{tl?.aspectRatio}</span>
        <span>·</span><span className="tnum">{fps} fps</span>
        <span>·</span><span>scale {(scale * 100).toFixed(0)}%</span>
        <div className="flex-1" />
        {renderer.current && !renderer.current.webglAvailable && (
          <Tip label="Grading still works through the Canvas2D path with a reduced control set. WebGL is usually blocked inside sandboxed iframes — open the app in its own browser tab for the full shader pipeline.">
            <Badge tone="mut" className="cursor-help gap-1"><AlertTriangle size={9} />Canvas2D grade path</Badge>
          </Tip>
        )}
        {rate !== 1 && <Badge tone="accent">{rate > 0 ? '' : 'reverse '}{Math.abs(rate)}×</Badge>}
        <span className="tnum">{Math.round(scale * 100)}%</span>
        <Tip label="Rendering quality affects preview only, never the export">
          <span className="flex items-center gap-1"><Gauge size={10} />{quality}</span>
        </Tip>
      </div>
    </div>
  );
}
