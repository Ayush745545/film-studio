'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import { Play, ImageOff, Check, X, Loader2, Download, Copy, Trash2, RefreshCw, Eye, Lock, Film } from 'lucide-react';
import { cx, Badge, PrevisBadge, Tip } from '@/components/ui/primitives';
import { Popover, MenuItem } from '@/components/ui/overlays';
import type { Asset } from '@/types';

interface MotionMeta { frames?: string[]; fps?: number; zoomFrom?: number; zoomTo?: number; panX?: number; panY?: number; move?: string; label?: string }

function motionOf(asset: Asset | null | undefined): MotionMeta | null {
  if (!asset) return null;
  const m = (asset.meta as { motion?: MotionMeta } | undefined)?.motion;
  if (m?.frames?.length) return m;
  if (asset.mimeType === 'application/json' && asset.url) return { frames: [] };
  return null;
}

/**
 * Universal media thumbnail.
 *
 * Handles stills, encoded video (plays on hover, real <video>) and demo motion
 * plates (a real generated frame sequence played back with the camera move the
 * shot asked for). Demo assets are always visibly labelled.
 */
export function AssetThumb({ asset, className, ratio = '16/9', animate = 'hover', badge, children, fallbackLabel }: {
  asset: Asset | null | undefined; className?: string; ratio?: string;
  animate?: 'hover' | 'always' | 'none'; badge?: React.ReactNode; children?: React.ReactNode; fallbackLabel?: string;
}) {
  const motion = motionOf(asset);
  const isVideo = asset?.mimeType?.startsWith('video/') && !motion;
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const [hover, setHover] = React.useState(false);
  const [frame, setFrame] = React.useState(0);
  const [failed, setFailed] = React.useState(false);
  const playing = animate === 'always' || (animate === 'hover' && hover);

  React.useEffect(() => {
    if (!motion?.frames?.length || !playing) { setFrame(0); return; }
    const fps = Math.max(2, Math.min(30, motion.fps ?? 8));
    const i = setInterval(() => setFrame(f => (f + 1) % motion.frames!.length), 1000 / fps);
    return () => clearInterval(i);
  }, [motion, playing]);

  React.useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playing) { v.playbackRate = 1; void v.play().catch(() => {}); } else { v.pause(); }
  }, [playing, isVideo]);

  if (!asset) {
    return (
      <div className={cx('relative flex items-center justify-center overflow-hidden rounded-md border border-dashed border-line bg-well', className)} style={{ aspectRatio: ratio }}>
        <span className="flex flex-col items-center gap-1 text-ink3">
          <ImageOff size={16} />
          <span className="text-[10px]">{fallbackLabel ?? 'No media yet'}</span>
        </span>
      </div>
    );
  }

  const zoom = motion ? (motion.zoomFrom ?? 1) + ((motion.zoomTo ?? 1.1) - (motion.zoomFrom ?? 1)) * (motion.frames?.length ? frame / motion.frames.length : 0) : 1;
  const px = motion ? (motion.panX ?? 0) * (motion.frames?.length ? frame / motion.frames.length : 0) * 100 : 0;
  const py = motion ? (motion.panY ?? 0) * (motion.frames?.length ? frame / motion.frames.length : 0) * 100 : 0;

  return (
    <div className={cx('group/thumb relative overflow-hidden rounded-md border border-line bg-deep', className)}
      style={{ aspectRatio: ratio }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-1 text-ink3">
          <ImageOff size={16} /><span className="text-[10px]">Media unavailable</span>
        </div>
      ) : isVideo ? (
        <video ref={videoRef} src={asset.url} loop muted playsInline preload="metadata" onError={() => setFailed(true)}
          className="h-full w-full object-cover" />
      ) : motion?.frames?.length ? (
        <img src={motion.frames[Math.min(frame, motion.frames.length - 1)]} alt={asset.name} onError={() => setFailed(true)}
          className="h-full w-full object-cover transition-transform duration-200 ease-linear"
          style={{ transform: `scale(${zoom}) translate(${px}%, ${py}%)` }} />
      ) : (
        <img src={asset.url} alt={asset.name} loading="lazy" decoding="async" onError={() => setFailed(true)}
          className={cx('h-full w-full object-cover transition-transform duration-500 ease-cine', playing && 'scale-[1.03]')} />
      )}

      {/* demo marker */}
      {(asset.demo || motion) && <span className="absolute left-1.5 top-1.5"><PrevisBadge label={motion ? 'PREVIS MOTION' : 'PREVIS'} /></span>}

      {/* hover transport hint */}
      {(isVideo || motion) && !playing && (
        <span className="absolute bottom-1.5 right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-black/60 backdrop-blur">
          <Play size={9} className="translate-x-px fill-current text-ink" />
        </span>
      )}
      {badge && <span className="absolute right-1.5 top-1.5">{badge}</span>}
      {children}
    </div>
  );
}

/** Selection / review overlay for storyboard and shot grids. */
export function ThumbActions({ status, selected, onSelect, onApprove, onReject, onRegenerate, onOpen, busy, extra }: {
  status?: string; selected?: boolean; onSelect?: () => void;
  onApprove?: () => void; onReject?: () => void; onRegenerate?: () => void; onOpen?: () => void;
  busy?: boolean; extra?: React.ReactNode;
}) {
  return (
    <div className={cx('pointer-events-none absolute inset-0 flex flex-col justify-between p-1.5 transition-opacity',
      selected ? 'opacity-100' : 'opacity-0 group-hover/thumb:opacity-100')}>
      <div className="flex items-start justify-between gap-1">
        <div className="pointer-events-auto flex gap-1">
          {onSelect && (
            <button type="button" onClick={onSelect}
              className={cx('flex h-5 w-5 items-center justify-center rounded border backdrop-blur transition-colors',
                selected ? 'border-accent bg-accent text-accent-on' : 'border-white/20 bg-black/50 text-transparent hover:text-ink/60')}>
              <Check size={11} />
            </button>
          )}
        </div>
        <div className="pointer-events-auto flex gap-1">
          {busy && <span className="flex h-5 w-5 items-center justify-center rounded border border-accent/40 bg-black/60 backdrop-blur"><Loader2 size={10} className="animate-spin text-accent-bright" /></span>}
          {status === 'approved' && !busy && <span className="flex h-5 items-center gap-1 rounded border border-ok/40 bg-black/60 px-1.5 text-[9px] font-semibold text-ok backdrop-blur"><Check size={9} />APPROVED</span>}
          {status === 'rejected' && !busy && <span className="flex h-5 items-center gap-1 rounded border border-bad/40 bg-black/60 px-1.5 text-[9px] font-semibold text-bad backdrop-blur"><X size={9} />REJECTED</span>}
        </div>
      </div>
      <div className="pointer-events-auto flex items-center justify-end gap-1">
        {extra}
        {onApprove && <Tip label="Approve"><button type="button" onClick={onApprove} className="flex h-5 w-5 items-center justify-center rounded border border-white/15 bg-black/60 text-ok backdrop-blur transition-colors hover:bg-ok/20"><Check size={11} /></button></Tip>}
        {onReject && <Tip label="Reject"><button type="button" onClick={onReject} className="flex h-5 w-5 items-center justify-center rounded border border-white/15 bg-black/60 text-bad backdrop-blur transition-colors hover:bg-bad/20"><X size={11} /></button></Tip>}
        {onRegenerate && <Tip label="Regenerate"><button type="button" onClick={onRegenerate} className="flex h-5 w-5 items-center justify-center rounded border border-white/15 bg-black/60 text-ink2 backdrop-blur transition-colors hover:text-accent-bright"><RefreshCw size={11} /></button></Tip>}
        {onOpen && <Tip label="Open"><button type="button" onClick={onOpen} className="flex h-5 w-5 items-center justify-center rounded border border-white/15 bg-black/60 text-ink2 backdrop-blur transition-colors hover:text-ink"><Eye size={11} /></button></Tip>}
      </div>
    </div>
  );
}

/** Asset row actions used by the library and inspectors. */
export function AssetMenu({ asset, onRename, onDuplicate, onDelete, onUse, onVariation, onDownload }: {
  asset: Asset; onRename?: () => void; onDuplicate?: () => void; onDelete?: () => void;
  onUse?: () => void; onVariation?: () => void; onDownload?: () => void;
}) {
  return (
    <Popover width={210} trigger={({ toggle }) => <button type="button" onClick={e => { e.stopPropagation(); toggle(); }} className="icon-btn h-6 w-6 bg-black/50 backdrop-blur"><Film size={12} /></button>}>
      {close => (
        <div onClick={e => e.stopPropagation()}>
          {onUse && <MenuItem icon={<Play size={13} />} label="Use in project" onClick={() => { close(); onUse(); }} />}
          {onVariation && <MenuItem icon={<RefreshCw size={13} />} label="Generate variation" onClick={() => { close(); onVariation(); }} />}
          {onDownload && <MenuItem icon={<Download size={13} />} label="Download" hint={asset.mimeType.split('/')[1]} onClick={() => { close(); onDownload(); }} />}
          {onRename && <MenuItem icon={<Copy size={13} />} label="Rename" onClick={() => { close(); onRename(); }} />}
          {onDuplicate && <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { close(); onDuplicate(); }} />}
          <div className="my-1 h-px bg-line-soft" />
          {onDelete && <MenuItem tone="danger" icon={<Trash2 size={13} />} label="Delete" onClick={() => { close(); onDelete(); }} />}
        </div>
      )}
    </Popover>
  );
}

export function AssetMetaLine({ asset }: { asset: Asset }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink3">
      <Badge tone="mut">{asset.kind}</Badge>
      {asset.width ? <span className="tnum">{asset.width}×{asset.height}</span> : null}
      {asset.durationSec ? <span className="tnum">{asset.durationSec.toFixed(1)}s</span> : null}
      {asset.seed ? <span className="mono">seed {asset.seed}</span> : null}
      {asset.demo && <PrevisBadge />}
    </div>
  );
}
export { Lock };
