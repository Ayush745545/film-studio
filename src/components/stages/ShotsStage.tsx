'use client';
import * as React from 'react';
import { Clapperboard, Camera, Download, Filter } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { AssetThumb } from './AssetThumb';
import { Button, Badge, EmptyState, cx, Tip } from '@/components/ui/primitives';
import { Select, TextInput, TextArea } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { formatSeconds } from '@/lib/client/ids';
import { LENSES } from '@/types';
import type { Shot } from '@/types';

const SIZES = ['Extreme Wide', 'Wide', 'Full', 'Medium Wide', 'Medium', 'Medium Close', 'Close-up', 'Extreme Close-up', 'Over Shoulder', 'POV', 'Insert', 'Two Shot'];
const MOVES = ['Static', 'Pan', 'Tilt', 'Dolly', 'Dolly In', 'Dolly Out', 'Truck', 'Crane', 'Handheld', 'Steadicam', 'Slow Push', 'Pull Back', 'Whip Pan', 'Orbit', 'Zoom', 'Rack Focus', 'Aerial'];

/** Shot list — the production view of every camera parameter, all editable. */
export function ShotsStage() {
  const shots = useProject(s => s.shots);
  const scenes = useProject(s => s.scenes);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const setStage = useProject(s => s.setStage);
  const toast = useApp(s => s.toast);
  const [sort, setSort] = React.useState<'order' | 'duration' | 'size'>('order');
  const [q, setQ] = React.useState('');
  const [onlyMissing, setOnlyMissing] = React.useState(false);

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const rows = React.useMemo(() => {
    let out = shots.slice();
    if (q) { const s = q.toLowerCase(); out = out.filter(x => `${x.size} ${x.lens} ${x.move} ${x.description} ${x.prompt}`.toLowerCase().includes(s)); }
    if (onlyMissing) out = out.filter(x => !x.videoAssetId);
    if (sort === 'duration') out.sort((a, b) => b.durationSec - a.durationSec);
    else if (sort === 'size') out.sort((a, b) => SIZES.indexOf(a.size) - SIZES.indexOf(b.size));
    else out.sort((a, b) => a.sceneId.localeCompare(b.sceneId) || a.index - b.index);
    return out;
  }, [shots, q, sort, onlyMissing]);

  const total = shots.reduce((a, s) => a + s.durationSec, 0);

  const exportCsv = () => {
    const head = ['scene', 'shot', 'size', 'lens', 'move', 'angle', 'duration', 'description', 'dialogue', 'prompt'];
    const body = shots.map(s => {
      const sc = scenes.find(x => x.id === s.sceneId);
      return [sc?.index ?? '', s.index, s.size, s.lens, s.move, s.angle, s.durationSec, s.description, s.dialogue, s.prompt]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',');
    });
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'shot-list.csv'; a.click(); URL.revokeObjectURL(a.href);
    toast({ level: 'success', title: 'Shot list exported', body: `${shots.length} shots as CSV.` });
  };

  return (
    <StageFrame
      icon={<Clapperboard size={15} />}
      title="Shot list"
      subtitle={`${shots.length} shots · ${formatSeconds(total)} of screen time · camera, lens, movement and duration are all editable`}
      headerRight={
        <>
          <Button size="sm" variant="ghost" onClick={exportCsv} disabled={!shots.length}><Download size={12} />CSV</Button>
          <GenerateBar config={{ action: 'frames', label: 'All storyboard frames' }} modelKind="image" label="Frames" size="sm" variant="default" />
          <GenerateBar config={{ action: 'videos', label: 'All shot videos' }} modelKind="video" label="Videos" size="sm" />
        </>
      }
      asideTitle="Filters"
      aside={
        <div className="space-y-3 p-3">
          <div className="space-y-2">
            <TextInput value={q} onChange={e => setQ(e.target.value)} placeholder="Filter shots…" />
            <Select value={sort} onChange={v => setSort(v as never)}
              options={[{ value: 'order', label: 'Sort: scene order' }, { value: 'duration', label: 'Sort: longest first' }, { value: 'size', label: 'Sort: widest first' }]} />
            <button type="button" onClick={() => setOnlyMissing(v => !v)}
              className={cx('flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-[11px] transition-colors',
                onlyMissing ? 'border-accent/40 bg-accent/10 text-accent-bright' : 'border-line bg-well text-ink2 hover:text-ink')}>
              <Filter size={11} />Only shots without video
            </button>
          </div>
          <div className="rounded-md border border-line-soft bg-well p-2.5">
            <div className="label mb-1.5">Totals</div>
            <dl className="space-y-1 text-[10.5px]">
              <div className="flex justify-between"><dt className="text-ink3">Shots</dt><dd className="tnum text-ink2">{shots.length}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">Runtime</dt><dd className="tnum text-ink2">{formatSeconds(total)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">With frame</dt><dd className="tnum text-ink2">{shots.filter(s => s.frameAssetId).length}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">With video</dt><dd className="tnum text-ink2">{shots.filter(s => s.videoAssetId).length}</dd></div>
              <div className="flex justify-between"><dt className="text-ink3">Average shot</dt><dd className="tnum text-ink2">{shots.length ? (total / shots.length).toFixed(1) : '0'}s</dd></div>
            </dl>
          </div>
          <StageNote tone="info" title="Shot list is the contract">
            Duration here decides how long the generated video must be and how the shot is placed on the timeline during
            assembly. Change it any time — assembly reads the current values.
          </StageNote>
        </div>
      }
      footer={shots.length ? <ReviewBar next="video" onRegenerate={() => void generate('breakdown', { regenerateShots: true })}
        note={<>{rows.length} shot(s) shown · {shots.filter(s => s.frameStatus === 'approved').length} frames approved</>} /> : undefined}>
      <div className="p-4 xl:p-6">
        {!shots.length && (
          <EmptyState icon={<Clapperboard size={17} />} title="No shots yet"
            body="Shots are planned by the scene breakdown. Open the Scenes stage and run it — you'll get a coverage plan per scene that you can then edit here."
            action={<Button size="sm" variant="primary" onClick={() => setStage('scenes')}>Open scene breakdown</Button>} />
        )}
        {shots.length > 0 && !rows.length && (
          <EmptyState compact icon={<Filter size={15} />} title="No shots match" body="Clear the filter to see the whole shot list."
            action={<Button size="xs" onClick={() => { setQ(''); setOnlyMissing(false); }}>Clear filters</Button>} />
        )}

        {rows.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-well2 text-left">
                  {['', 'Sc/Sh', 'Frame', 'Size', 'Lens', 'Move', 'Angle', 'Dur', 'Video', 'Description', ''].map(h => (
                    <th key={h} className="label whitespace-nowrap px-2.5 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(s => {
                  const sc = scenes.find(x => x.id === s.sceneId);
                  return (
                    <tr key={s.id} className="group border-b border-line-soft/50 align-middle transition-colors last:border-0 hover:bg-white/[0.018]">
                      <td className="w-[52px] px-2.5 py-1.5">
                        <AssetThumb asset={s.frameAssetId ? assetById.get(s.frameAssetId) : null} ratio="16/9" className="w-[48px]" animate="none" />
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-[10px] text-ink2">
                        <span className="text-accent-bright">{String(sc?.index ?? 0).padStart(2, '0')}</span>/{String(s.index).padStart(2, '0')}
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Tip label={s.frameStatus}><span className={cx('h-1.5 w-1.5 rounded-full', s.frameStatus === 'approved' ? 'bg-ok' : s.frameStatus === 'rejected' ? 'bg-bad' : s.frameAssetId ? 'bg-accent' : 'bg-white/15')} /></Tip>
                          <GenerateBar config={{ action: 'frames', label: `SH ${s.index}`, params: { shotId: s.id, variations: 1 } }} modelKind="image" label="Frame" size="xs" variant="default" />
                        </div>
                      </td>
                      <td className="px-1.5 py-1.5"><Select size="sm" className="w-[124px]" value={s.size} onChange={v => void update<Shot>('shots', s.id, { size: v } as Partial<Shot>)} options={SIZES} /></td>
                      <td className="px-1.5 py-1.5"><Select size="sm" className="w-[104px]" value={s.lens} onChange={v => void update<Shot>('shots', s.id, { lens: v } as Partial<Shot>)} options={[...LENSES]} /></td>
                      <td className="px-1.5 py-1.5"><Select size="sm" className="w-[110px]" value={s.move} onChange={v => void update<Shot>('shots', s.id, { move: v } as Partial<Shot>)} options={MOVES} /></td>
                      <td className="px-1.5 py-1.5"><TextInput className="h-[26px] w-[110px] text-[10.5px]" value={s.angle} onChange={e => void update<Shot>('shots', s.id, { angle: e.target.value } as Partial<Shot>)} /></td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input type="range" className="rng w-14" min={1} max={20} step={0.5} value={s.durationSec}
                            style={{ ['--pct' as never]: `${((s.durationSec - 1) / 19) * 100}%` }}
                            onChange={e => void update<Shot>('shots', s.id, { durationSec: Number(e.target.value) } as Partial<Shot>)} />
                          <span className="w-8 font-mono text-[10px] text-ink2 tnum">{s.durationSec.toFixed(1)}s</span>
                        </div>
                      </td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          {s.videoAssetId ? <Badge tone="info">ready</Badge> : <Badge tone="mut">—</Badge>}
                          <GenerateBar config={{ action: 'videos', label: `Video SH ${s.index}`, params: { shotId: s.id } }} modelKind="video" label="Video" size="xs" variant="default" />
                        </div>
                      </td>
                      <td className="max-w-[280px] px-2.5 py-1.5">
                        <TextArea rows={1} className="min-h-[26px] resize-none py-1 text-[10.5px]" value={s.description}
                          onChange={e => void update<Shot>('shots', s.id, { description: e.target.value } as Partial<Shot>)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <Tip label={s.frameStatus === 'approved' ? 'Unapprove frame' : 'Approve frame'}>
                          <button type="button" className={cx('icon-btn h-6 w-6', s.frameStatus === 'approved' && 'text-ok')}
                            onClick={() => void update<Shot>('shots', s.id, { frameStatus: s.frameStatus === 'approved' ? 'ready' : 'approved' } as Partial<Shot>)}>
                            <Camera size={12} />
                          </button>
                        </Tip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </StageFrame>
  );
}
