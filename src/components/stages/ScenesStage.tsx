'use client';
import * as React from 'react';
import { Film, Clapperboard, Clock, Users, MapPin, Sparkles, ChevronDown, ChevronRight, Pencil, Check, X } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { formatSeconds } from '@/lib/client/ids';
import type { Scene, Shot } from '@/types';
import { LENSES } from '@/types';

const SIZES = ['Extreme Wide', 'Wide', 'Full', 'Medium Wide', 'Medium', 'Medium Close', 'Close-up', 'Extreme Close-up', 'Over Shoulder', 'POV', 'Insert', 'Two Shot'];
const MOVES = ['Static', 'Pan', 'Tilt', 'Dolly', 'Dolly In', 'Dolly Out', 'Truck', 'Crane', 'Handheld', 'Steadicam', 'Slow Push', 'Pull Back', 'Whip Pan', 'Orbit', 'Zoom', 'Rack Focus', 'Aerial'];

export function ScenesStage() {
  const project = useProject(s => s.project);
  const scenes = useProject(s => s.scenes);
  const shots = useProject(s => s.shots);
  const characters = useProject(s => s.characters);
  const locations = useProject(s => s.locations);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const setStage = useProject(s => s.setStage);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [open, setOpen] = React.useState<string | null>(null);
  const [editId, setEditId] = React.useState<string | null>(null);

  const generating = jobs.some(j => j.stage === 'scenes' && (j.status === 'queued' || j.status === 'running'));
  const total = shots.reduce((a, s) => a + s.durationSec, 0);
  const charById = React.useMemo(() => new Map(characters.map(c => [c.id, c])), [characters]);

  React.useEffect(() => { if (scenes.length && !open) setOpen(scenes[0].id); }, [scenes, open]);

  return (
    <StageFrame
      icon={<Film size={15} />}
      title="Scene breakdown"
      subtitle={scenes.length ? `${scenes.length} scenes · ${shots.length} shots · ${formatSeconds(total)} of screen time` : 'The screenplay turned into a production schedule'}
      headerRight={
        <>
          <Badge tone="mut" className="tnum">{formatSeconds(total)} runtime</Badge>
          <GenerateBar config={{ action: 'breakdown', label: 'Break into scenes & shots' }} label="Run breakdown" size="sm" />
          <GenerateBar config={{ action: 'breakdown', label: 'Re-plan coverage', params: { regenerateShots: true } }} label="Re-plan shots" size="sm" variant="default" />
        </>
      }
      asideTitle="Coverage plan"
      aside={
        <div className="space-y-3 p-3">
          <StageNote tone="info" title="How coverage is planned">
            Every scene gets an establishing shot when it is exterior or new, a two-shot when two or more people speak,
            a medium per speaker, a close-up on the turn, an insert when the action names an object, and a pull-back
            release for long scenes. Lens and movement follow the shot size.
          </StageNote>
          <div>
            <div className="label mb-1.5">Shot size distribution</div>
            <Distribution items={shots.map(s => s.size)} />
          </div>
          <div>
            <div className="label mb-1.5">Camera movement</div>
            <Distribution items={shots.map(s => s.move)} />
          </div>
          <div>
            <div className="label mb-1.5">Longest scenes</div>
            <ul className="space-y-1">
              {[...scenes].sort((a, b) => b.durationSec - a.durationSec).slice(0, 5).map(s => (
                <li key={s.id} className="flex items-center gap-2 text-[11px]">
                  <span className="w-8 shrink-0 font-mono text-ink3">S{String(s.index).padStart(2, '0')}</span>
                  <span className="min-w-0 flex-1 truncate text-ink2">{s.heading}</span>
                  <span className="shrink-0 text-ink3 tnum">{formatSeconds(s.durationSec)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-md border border-line-soft bg-well p-2.5 text-[10.5px] leading-relaxed text-ink3">
            Target duration is <strong className="text-ink2">{project?.settings.durationSec}s</strong>; the current plan
            runs {total > (project?.settings.durationSec ?? 0) ? 'over' : 'under'} by {formatSeconds(Math.abs(total - (project?.settings.durationSec ?? 0)))}.
            Adjust individual shot durations below, or re-plan coverage.
          </div>
        </div>
      }
      footer={scenes.length ? (
        <ReviewBar approved={scenes.every(s => s.approved)} next="storyboard"
          onApprove={async () => { for (const s of scenes) if (!s.approved) await update<Scene>('scenes', s.id, { approved: true } as Partial<Scene>); useProject.getState().markStage('scenes', 'approved'); toast({ level: 'success', title: 'Scenes approved' }); }}
          onRegenerate={() => void generate('breakdown', { regenerateShots: true })}
          note="Every scene and shot parameter below is editable — this is a first pass, not a verdict." />
      ) : undefined}>
      <div className="p-4 xl:p-6">
        {!scenes.length && generating && <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>}
        {!scenes.length && !generating && (
          <EmptyState icon={<Film size={17} />} title="No scenes yet"
            body={<>Break the screenplay into production scenes. You'll get duration, cast, location, emotion, lighting, props and dialogue per scene — plus an automatically planned shot list you can edit shot by shot.</>}
            action={<GenerateBar config={{ action: 'breakdown', label: 'Break into scenes' }} label="Break into scenes" />} />
        )}

        <div className="space-y-2">
          {scenes.map(sc => {
            const scShots = shots.filter(s => s.sceneId === sc.id).sort((a, b) => a.index - b.index);
            const isOpen = open === sc.id;
            const loc = locations.find(l => l.id === sc.locationId);
            return (
              <Card key={sc.id} hover={false} className={cx('overflow-hidden', sc.approved && 'border-ok/25')}>
                <button type="button" onClick={() => setOpen(isOpen ? null : sc.id)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-white/[0.02]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.08] font-mono text-[11px] font-bold text-accent-bright">
                    {String(sc.index).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold uppercase tracking-wide text-ink">{sc.heading}</span>
                      {sc.approved && <Badge tone="ok"><Check size={9} />approved</Badge>}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-ink3">
                      <span className="flex items-center gap-1"><Clock size={9} />{formatSeconds(sc.durationSec)}</span>
                      <span className="flex items-center gap-1"><Clapperboard size={9} />{scShots.length} shots</span>
                      <span className="flex items-center gap-1"><MapPin size={9} />{loc?.name ?? sc.locationName}</span>
                      <span className="flex items-center gap-1"><Users size={9} />{sc.characterIds.map(id => charById.get(id)?.name ?? id).filter(Boolean).join(', ') || '—'}</span>
                      {sc.emotion && <Badge tone="mut">{sc.emotion}</Badge>}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center gap-2 lg:flex">
                    <span className="flex h-6 w-24 overflow-hidden rounded bg-well">
                      {scShots.map(s => <span key={s.id} className="h-full border-r border-line-soft last:border-0" style={{ width: `${(s.durationSec / Math.max(0.1, sc.durationSec)) * 100}%`, background: s.frameAssetId ? '#4A3F2A' : '#1E1B17' }} />)}
                    </span>
                  </span>
                  {isOpen ? <ChevronDown size={14} className="shrink-0 text-ink3" /> : <ChevronRight size={14} className="shrink-0 text-ink3" />}
                </button>

                {isOpen && (
                  <div className="border-t border-line-soft">
                    <div className="grid gap-4 p-3.5 lg:grid-cols-[1fr_320px]">
                      <div className="space-y-3">
                        {editId === sc.id ? (
                          <SceneForm sc={sc} onCancel={() => setEditId(null)} onSave={async patch => { await update<Scene>('scenes', sc.id, patch); setEditId(null); }} />
                        ) : (
                          <>
                            <div>
                              <div className="label mb-1">Action</div>
                              <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink2">{sc.action || '—'}</p>
                            </div>
                            {sc.dialogue && (
                              <div>
                                <div className="label mb-1">Dialogue</div>
                                <pre className="screenplay max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-well p-2.5 text-[11px] text-ink2">{sc.dialogue}</pre>
                              </div>
                            )}
                          </>
                        )}
                        <div className="flex flex-wrap gap-1.5">
                          {editId === sc.id ? null : <Button size="xs" variant="ghost" onClick={() => setEditId(sc.id)}><Pencil size={11} />Edit scene</Button>}
                          <GenerateBar config={{ action: 'frames', label: `Frames · SC ${sc.index}`, params: { sceneId: sc.id } }} modelKind="image" label="Generate frames" size="xs" />
                          <GenerateBar config={{ action: 'videos', label: `Video · SC ${sc.index}`, params: { sceneId: sc.id } }} modelKind="video" label="Generate video" size="xs" variant="default" />
                          <Button size="xs" variant="ghost" onClick={() => void update<Scene>('scenes', sc.id, { approved: !sc.approved } as Partial<Scene>)}>
                            {sc.approved ? <><X size={11} />Unapprove</> : <><Check size={11} />Approve scene</>}
                          </Button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="label">Shots</div>
                        {scShots.map(s => <ShotRow key={s.id} shot={s} update={update} />)}
                        {!scShots.length && <p className="rounded-md border border-dashed border-line px-3 py-4 text-center text-[11px] text-ink3">No shots planned. Run the breakdown.</p>}
                        <Button size="xs" variant="ghost" className="w-full" onClick={() => void generate('breakdown', { regenerateShots: true })}><Sparkles size={11} />Re-plan this coverage</Button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {scenes.length > 0 && (
          <div className="mt-5"><StageNote tone="info" title="Next">
            Approved scenes feed the storyboard. Frames you approve become the start frame for video generation, so
            character and location identity carry through to motion.
            <Button size="xs" className="ml-2" onClick={() => setStage('storyboard')}>Open storyboard</Button>
          </StageNote></div>
        )}
      </div>
    </StageFrame>
  );
}

function ShotRow({ shot, update }: { shot: Shot; update: ReturnType<typeof useProject.getState>['updateEntity'] }) {
  return (
    <div className="rounded-md border border-line-soft bg-well p-2">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="font-mono text-[10px] font-bold text-accent-bright">SH {String(shot.index).padStart(2, '0')}</span>
        <Badge tone="mut">{shot.size}</Badge>
        <div className="flex-1" />
        <Tip label={shot.frameAssetId ? 'Frame generated' : 'No frame yet'}>
          <span className={cx('h-1.5 w-1.5 rounded-full', shot.frameAssetId ? 'bg-ok' : 'bg-white/15')} />
        </Tip>
        <Tip label={shot.videoAssetId ? 'Video generated' : 'No video yet'}>
          <span className={cx('h-1.5 w-1.5 rounded-full', shot.videoAssetId ? 'bg-info' : 'bg-white/15')} />
        </Tip>
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Select size="sm" value={shot.size} onChange={v => void update<Shot>('shots', shot.id, { size: v } as Partial<Shot>)} options={SIZES} className="text-[10px]" />
        <Select size="sm" value={shot.lens} onChange={v => void update<Shot>('shots', shot.id, { lens: v } as Partial<Shot>)} options={[...LENSES]} />
        <Select size="sm" value={shot.move} onChange={v => void update<Shot>('shots', shot.id, { move: v } as Partial<Shot>)} options={MOVES} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <span className="text-[10px] text-ink3">Duration</span>
        <input type="range" className="rng flex-1" min={1} max={20} step={0.5} value={shot.durationSec}
          style={{ ['--pct' as never]: `${((shot.durationSec - 1) / 19) * 100}%` }}
          onChange={e => void update<Shot>('shots', shot.id, { durationSec: Number(e.target.value) } as Partial<Shot>)} />
        <span className="w-9 text-right font-mono text-[10px] text-ink2 tnum">{shot.durationSec.toFixed(1)}s</span>
      </div>
      {shot.notes && <p className="mt-1 text-[9.5px] leading-snug text-ink3">{shot.notes}</p>}
    </div>
  );
}

function SceneForm({ sc, onSave, onCancel }: { sc: Scene; onSave: (p: Partial<Scene>) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = React.useState(sc);
  return (
    <div className="space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <Field label="Heading"><TextInput value={f.heading} onChange={e => setF({ ...f, heading: e.target.value })} /></Field>
        <Field label="Int/Ext"><Select value={f.intExt} onChange={v => setF({ ...f, intExt: v })} options={['INT.', 'EXT.', 'INT./EXT.']} /></Field>
        <Field label="Time of day"><TextInput value={f.timeOfDay} onChange={e => setF({ ...f, timeOfDay: e.target.value })} /></Field>
        <Field label="Emotion"><TextInput value={f.emotion} onChange={e => setF({ ...f, emotion: e.target.value })} /></Field>
        <Field label="Duration (s)"><TextInput type="number" step={0.5} value={f.durationSec} onChange={e => setF({ ...f, durationSec: Number(e.target.value) })} /></Field>
        <Field label="Music"><TextInput value={f.music} onChange={e => setF({ ...f, music: e.target.value })} placeholder="e.g. tension figure" /></Field>
      </div>
      <Field label="Lighting"><TextInput value={f.lighting} onChange={e => setF({ ...f, lighting: e.target.value })} /></Field>
      <Field label="Action"><TextArea rows={3} value={f.action} onChange={e => setF({ ...f, action: e.target.value })} /></Field>
      <Field label="Dialogue"><TextArea rows={3} value={f.dialogue} onChange={e => setF({ ...f, dialogue: e.target.value })} /></Field>
      <Field label="Props (comma separated)"><TextInput value={f.props.join(', ')} onChange={e => setF({ ...f, props: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} /></Field>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void onSave({ heading: f.heading, intExt: f.intExt, timeOfDay: f.timeOfDay, emotion: f.emotion, durationSec: f.durationSec, music: f.music, lighting: f.lighting, action: f.action, dialogue: f.dialogue, props: f.props })}><Check size={12} />Save scene</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function Distribution({ items }: { items: string[] }) {
  const counts = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [items]);
  const max = Math.max(1, ...counts.map(c => c[1]));
  if (!counts.length) return <p className="text-[10.5px] text-ink3">No shots yet.</p>;
  return (
    <ul className="space-y-1">
      {counts.map(([k, v]) => (
        <li key={k} className="flex items-center gap-2 text-[10.5px]">
          <span className="w-[92px] shrink-0 truncate text-ink3">{k}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-well">
            <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent" style={{ width: `${(v / max) * 100}%` }} />
          </span>
          <span className="w-4 shrink-0 text-right text-ink2 tnum">{v}</span>
        </li>
      ))}
    </ul>
  );
}
