'use client';
import * as React from 'react';
import { Music4, Play, Pause, Check, RotateCcw, Plus, Trash2, Waves, Drum, AudioLines } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Waveform } from './VoiceStage';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge, Segmented } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Slider, Toggle } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useApp, useDemoMode } from '@/store/app';
import { formatSeconds } from '@/lib/client/ids';
import type { SoundCue, SoundKind } from '@/types';

/** Client-side copy of the server synth catalogue (kept in sync with lib/media/wav). */
const SYNTH_PRESETS = [
  'rain', 'storm', 'wind', 'city-traffic', 'room-tone', 'forest', 'ocean', 'crowd', 'footsteps', 'door',
  'impact', 'whoosh', 'riser', 'server-hum', 'fire', 'clock', 'heartbeat', 'ui-click', 'scratch-voice',
  'score-tension', 'score-warm', 'score-epic', 'score-melancholy', 'score-drive'
];
const KINDS: { id: SoundKind; label: string; icon: React.ReactNode }[] = [
  { id: 'ambience', label: 'Ambience', icon: <Waves size={12} /> },
  { id: 'foley', label: 'Foley', icon: <AudioLines size={12} /> },
  { id: 'sfx', label: 'SFX', icon: <Drum size={12} /> },
  { id: 'score', label: 'Score', icon: <Music4 size={12} /> },
  { id: 'music', label: 'Music', icon: <Music4 size={12} /> },
  { id: 'dialogue', label: 'Dialogue', icon: <AudioLines size={12} /> }
];

export function SoundStage() {
  const project = useProject(s => s.project);
  const sounds = useProject(s => s.sounds);
  const scenes = useProject(s => s.scenes);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const remove = useProject(s => s.deleteEntity);
  const generate = useProject(s => s.generate);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const demo = useDemoMode();
  const { confirm, node } = useConfirm();
  const [kind, setKind] = React.useState<SoundKind | 'all'>('all');
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [playing, setPlaying] = React.useState<string | null>(null);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const selected = sounds.find(s => s.id === selectedId) ?? null;
  const generating = jobs.some(j => j.stage === 'sound' && (j.status === 'queued' || j.status === 'running'));
  const done = sounds.filter(s => s.assetId).length;
  const shown = sounds.filter(s => kind === 'all' || s.kind === kind).sort((a, b) => a.startSec - b.startSec);

  const play = (s: SoundCue) => {
    const a = assetById.get(s.assetId ?? '');
    if (!a) return;
    if (playing === s.id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const el = new Audio(a.url); audioRef.current = el;
    el.onended = () => setPlaying(null);
    void el.play().then(() => setPlaying(s.id)).catch(() => setPlaying(null));
  };

  const addCue = async () => {
    if (!project) return;
    try {
      await useProject.getState().createEntity('sounds', {
        projectId: project.id, kind: 'sfx', name: 'New cue', description: '', prompt: '',
        startSec: 0, durationSec: 3, volume: 0.8, loop: false, assetId: null, status: 'none',
        modelId: null, demo: false, autoDetected: false, tags: [], sceneId: null
      });
      toast({ level: 'success', title: 'Cue added' });
    } catch (err) { toast({ level: 'error', title: (err as Error).message }); }
  };

  const totals = React.useMemo(() => {
    const m: Record<string, { count: number; dur: number; done: number }> = {};
    for (const s of sounds) {
      m[s.kind] ??= { count: 0, dur: 0, done: 0 };
      m[s.kind].count++; m[s.kind].dur += s.durationSec; if (s.assetId) m[s.kind].done++;
    }
    return m;
  }, [sounds]);

  return (
    <StageFrame
      icon={<Music4 size={15} />}
      title="Sound design"
      subtitle={sounds.length ? `${done}/${sounds.length} cues rendered · ${formatSeconds(sounds.reduce((a, s) => a + s.durationSec, 0))} of audio` : 'SFX, ambience, foley and score placed from the scene breakdown'}
      headerRight={
        <>
          <Segmented size="sm" value={kind} onChange={v => setKind(v as never)}
            options={[{ value: 'all', label: 'All' }, ...KINDS.map(k => ({ value: k.id, label: k.label }))]} />
          <Button size="sm" variant="ghost" onClick={addCue}><Plus size={12} />Cue</Button>
          <GenerateBar config={{ action: 'sound-design', label: 'Sound design' }} label="Auto-design" size="sm" variant="default" />
          <GenerateBar config={{ action: 'cues', label: 'All sound cues', params: { all: true, localSynth: demo } }} modelKind="sfx" label="Render all cues" size="sm" />
        </>
      }
      asideTitle={selected ? selected.name : 'Cue'}
      aside={selected ? (
        <div className="space-y-3 p-3">
          {selected.assetId && (
            <div className="rounded-md border border-line-soft bg-well p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <Button size="xs" variant="primary" onClick={() => play(selected)}>{playing === selected.id ? <Pause size={11} /> : <Play size={11} />}{playing === selected.id ? 'Stop' : 'Play'}</Button>
                <span className="text-[10px] text-ink3 tnum">{formatSeconds(assetById.get(selected.assetId)?.durationSec ?? selected.durationSec)}</span>
                {assetById.get(selected.assetId)?.demo && <PrevisBadge label={selected.kind === 'score' ? 'SYNTH' : 'PREVIS'} />}
              </div>
              <Waveform peaks={(assetById.get(selected.assetId)?.meta as any)?.peaks ?? []} playing={playing === selected.id} />
            </div>
          )}
          <Field label="Name"><TextInput value={selected.name} onChange={e => void update<SoundCue>('sounds', selected.id, { name: e.target.value } as Partial<SoundCue>)} /></Field>
          <Field label="Kind"><Select value={selected.kind} onChange={v => void update<SoundCue>('sounds', selected.id, { kind: v as SoundKind } as Partial<SoundCue>)} options={KINDS.map(k => ({ value: k.id, label: k.label }))} /></Field>
          <Field label="Description / prompt">
            <TextArea rows={3} value={selected.description || selected.prompt} onChange={e => void update<SoundCue>('sounds', selected.id, { description: e.target.value, prompt: e.target.value } as Partial<SoundCue>)} />
          </Field>
          <Field label="Synth preset" hint="Used when rendering locally (built-in engine or offline).">
            <Select value={SYNTH_PRESETS.includes(String((selected as any).preset ?? '')) ? String((selected as any).preset) : ''} onChange={v => void update<SoundCue>('sounds', selected.id, { prompt: selected.prompt } as Partial<SoundCue>)}
              placeholder="Detect from prompt" options={SYNTH_PRESETS} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start (s)"><TextInput type="number" step={0.1} value={selected.startSec} onChange={e => void update<SoundCue>('sounds', selected.id, { startSec: Number(e.target.value) } as Partial<SoundCue>)} /></Field>
            <Field label="Duration"><TextInput type="number" step={0.5} value={selected.durationSec} onChange={e => void update<SoundCue>('sounds', selected.id, { durationSec: Number(e.target.value) } as Partial<SoundCue>)} /></Field>
          </div>
          <Field label="Volume"><Slider value={selected.volume * 100} min={0} max={100} onChange={v => void update<SoundCue>('sounds', selected.id, { volume: v / 100 } as Partial<SoundCue>)} unit="%" /></Field>
          <div className="rounded-md border border-line-soft bg-well px-2.5 py-2">
            <Toggle checked={selected.loop} onChange={v => void update<SoundCue>('sounds', selected.id, { loop: v } as Partial<SoundCue>)} label="Loop this cue" hint="Beds (ambience, room tone) usually loop." />
          </div>
          <div>
            <MetaRow label="Scene">{scenes.find(s => s.id === selected.sceneId)?.heading ?? '—'}</MetaRow>
            <MetaRow label="Source">{selected.autoDetected ? 'auto-detected' : 'manual'}</MetaRow>
            <MetaRow label="Status"><Badge tone={selected.status === 'ready' || selected.status === 'approved' ? 'ok' : 'mut'}>{selected.status}</Badge></MetaRow>
          </div>
          <GenerateBar config={{ action: 'cues', label: `Render · ${selected.name}`, params: { cueId: selected.id, localSynth: demo } }} modelKind={selected.kind === 'score' || selected.kind === 'music' ? 'music' : 'sfx'} label="Render cue" size="sm" />
          <Button size="xs" variant="danger" className="w-full" onClick={async () => { const ok = await confirm({ title: 'Delete this cue?', tone: 'danger', confirmLabel: 'Delete' }); if (ok) { await remove('sounds', selected.id); setSelectedId(null); } }}>
            <Trash2 size={11} />Delete cue
          </Button>
        </div>
      ) : undefined}
      footer={sounds.length ? (
        <ReviewBar approved={done > 0 && done === sounds.length} next="aiedit"
          onApprove={async () => { for (const s of sounds) if (s.assetId && s.status !== 'approved') await update<SoundCue>('sounds', s.id, { status: 'approved' } as Partial<SoundCue>); useProject.getState().markStage('sound', 'approved'); }}
          onRegenerate={() => void generate('sound-design', {})}
          note={<>{done} of {sounds.length} cues rendered · assembly places them on the audio buses automatically</>} />
      ) : undefined}>
      {node}
      <div className="p-4 xl:p-6">
        {!sounds.length && generating && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>}
        {!sounds.length && !generating && (
          <EmptyState icon={<Music4 size={17} />} title="No sound design yet"
            body={<>Run sound design to read the scene breakdown and propose a real cue sheet: rain beds for wet exteriors, room tone for interiors, footsteps where someone walks, door cues where a door is used, and a score figure matched to each scene's emotion.</>}
            action={<GenerateBar config={{ action: 'sound-design', label: 'Sound design' }} label="Design sound" />}
            secondary={<Button size="sm" onClick={addCue}><Plus size={12} />Add a cue manually</Button>} />
        )}

        {sounds.length > 0 && (
          <>
            <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {Object.entries(totals).map(([k, v]) => (
                <Card key={k} hover={false} className="flex items-center gap-3 p-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.08] text-accent-bright">
                    {KINDS.find(x => x.id === k)?.icon ?? <AudioLines size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold capitalize text-ink">{k}</span>
                    <span className="block text-[10px] text-ink3">{v.done}/{v.count} rendered · {formatSeconds(v.dur)}</span>
                  </span>
                  <GenerateBar config={{ action: 'cues', label: `Render ${k}`, params: { kind: k, localSynth: demo } }} modelKind={k === 'score' || k === 'music' ? 'music' : 'sfx'} label="Render" size="xs" variant="default" />
                </Card>
              ))}
            </div>

            <div className="space-y-1">
              {shown.map(s => {
                const asset = s.assetId ? assetById.get(s.assetId) : null;
                const busy = jobs.some(j => (j.status === 'queued' || j.status === 'running') && (j.input as any)?.target?.id === s.id);
                const sc = scenes.find(x => x.id === s.sceneId);
                return (
                  <Card key={s.id} hover className={cx('flex items-center gap-3 px-2.5 py-2', selectedId === s.id && 'border-accent/40')}>
                    <button type="button" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line bg-well text-ink2 transition-colors hover:border-accent/40 hover:text-accent-bright"
                      onClick={() => asset ? play(s) : setSelectedId(s.id)} disabled={!asset}>
                      {playing === s.id ? <Pause size={12} /> : <Play size={12} />}
                    </button>
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(s.id)}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-[12px] font-medium text-ink">{s.name}</span>
                        <Badge tone={s.kind === 'score' || s.kind === 'music' ? 'accent' : s.kind === 'ambience' ? 'info' : 'mut'}>{s.kind}</Badge>
                        {s.loop && <Badge tone="mut">loop</Badge>}
                        {asset?.demo && <PrevisBadge label={s.kind === 'score' ? 'SYNTH' : 'PREVIS'} />}
                        {busy && <Badge tone="info">rendering…</Badge>}
                        {s.status === 'approved' && <Badge tone="ok"><Check size={9} /></Badge>}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-ink3">
                        {sc ? `SC ${String(sc.index).padStart(2, '0')} · ` : ''}{formatSeconds(s.startSec)} → {formatSeconds(s.startSec + s.durationSec)} · {s.description.slice(0, 90)}
                      </span>
                    </button>
                    <span className="hidden w-[130px] shrink-0 lg:block">{asset && <Waveform peaks={(asset.meta as any)?.peaks ?? []} height={20} playing={playing === s.id} />}</span>
                    <span className="flex w-[74px] shrink-0 items-center gap-1.5">
                      <input type="range" className="rng flex-1" min={0} max={100} value={Math.round(s.volume * 100)}
                        style={{ ['--pct' as never]: `${s.volume * 100}%` }}
                        onChange={e => void update<SoundCue>('sounds', s.id, { volume: Number(e.target.value) / 100 } as Partial<SoundCue>)} />
                      <span className="w-6 text-right font-mono text-[9.5px] text-ink3 tnum">{Math.round(s.volume * 100)}</span>
                    </span>
                    <span className="flex shrink-0 gap-0.5">
                      <Tip label="Re-render"><button type="button" className="icon-btn h-6 w-6" onClick={() => void generate('cues', { cueId: s.id, localSynth: demo })}><RotateCcw size={11} /></button></Tip>
                      <Tip label={s.status === 'approved' ? 'Unapprove' : 'Approve'}>
                        <button type="button" className={cx('icon-btn h-6 w-6', s.status === 'approved' && 'text-ok')} onClick={() => void update<SoundCue>('sounds', s.id, { status: s.status === 'approved' ? 'ready' : 'approved' } as Partial<SoundCue>)}><Check size={11} /></button>
                      </Tip>
                      <Tip label="Delete"><button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={async () => { const ok = await confirm({ title: 'Delete cue?', tone: 'danger', confirmLabel: 'Delete' }); if (ok) await remove('sounds', s.id); }}><Trash2 size={11} /></button></Tip>
                    </span>
                  </Card>
                );
              })}
            </div>

            <div className="mt-5 grid gap-3 lg:grid-cols-2">
              <StageNote tone="info" title="Automatic placement">
                Cues are positioned from the scene breakdown: ambience beds span their scene, foley lands on the beat
                where the action names it, and the score figure follows each scene's emotion. Move any cue in the
                inspector or drag it on the timeline afterwards.
              </StageNote>
              <StageNote tone={demo ? 'warn' : 'ok'} title={demo ? 'Built-in synthesis is real audio' : 'Provider rendering'}>
                {demo
                  ? 'With no audio provider configured, cues are synthesised on the server by a real DSP engine — rain, room tone, footsteps, doors, impacts and an additive-synthesis score, all as genuine WAV files. Add an ElevenLabs key for photoreal sound effects and score.'
                  : 'Cues render through the configured audio provider, with the local synth kept as an automatic fallback so a provider outage never blocks the cut.'}
              </StageNote>
            </div>
          </>
        )}
      </div>
    </StageFrame>
  );
}
