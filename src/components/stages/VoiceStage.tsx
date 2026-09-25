'use client';
import * as React from 'react';
import { Mic2, Play, Pause, Check, X, RotateCcw } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge, Segmented } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Slider } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { get } from '@/lib/client/api';
import { formatSeconds } from '@/lib/client/ids';
import type { Character, VoiceLine } from '@/types';

const EMOTIONS = ['neutral', 'anxious', 'angry', 'sad', 'joyful', 'fearful', 'whisper', 'authoritative', 'tender', 'exhausted', 'excited', 'flat'];
const VOICE_IDS = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];

export function VoiceStage() {
  const project = useProject(s => s.project);
  const voices = useProject(s => s.voices);
  const characters = useProject(s => s.characters);
  const scenes = useProject(s => s.scenes);
  const assets = useProject(s => s.assets);
  const update = useProject(s => s.updateEntity);
  const generate = useProject(s => s.generate);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<'all' | 'missing' | 'character'>('all');
  const [charFilter, setCharFilter] = React.useState('');
  const [playing, setPlaying] = React.useState<string | null>(null);
  const [voiceCatalog, setVoiceCatalog] = React.useState<{ id: string; name: string; category?: string }[]>([]);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  const assetById = React.useMemo(() => new Map(assets.map(a => [a.id, a])), [assets]);
  const selected = voices.find(v => v.id === selectedId) ?? null;
  const generating = jobs.some(j => j.stage === 'voice' && (j.status === 'queued' || j.status === 'running'));
  const done = voices.filter(v => v.assetId).length;

  React.useEffect(() => {
    const providers = useApp.getState().boot?.providers ?? [];
    const el = providers.find(p => p.id === 'elevenlabs');
    if (el) { void get<{ voices: { id: string; name: string; category?: string }[] }>(`/api/providers/${el.id}/voices`).then(r => setVoiceCatalog(r.voices)).catch(() => setVoiceCatalog(VOICE_IDS.map(id => ({ id, name: id })))); }
    else setVoiceCatalog(VOICE_IDS.map(id => ({ id, name: id })));
  }, []);

  const shown = voices
    .filter(v => filter === 'all' || (filter === 'missing' ? !v.assetId : v.characterId === charFilter))
    .sort((a, b) => (scenes.findIndex(s => s.id === a.sceneId) - scenes.findIndex(s => s.id === b.sceneId)));

  const play = (v: VoiceLine) => {
    const a = assetById.get(v.assetId ?? '');
    if (!a) return;
    if (playing === v.id) { audioRef.current?.pause(); setPlaying(null); return; }
    audioRef.current?.pause();
    const el = new Audio(a.url);
    audioRef.current = el;
    el.onended = () => setPlaying(null);
    el.onerror = () => { setPlaying(null); toast({ level: 'error', title: 'Could not play this take' }); };
    void el.play().then(() => setPlaying(v.id)).catch(() => setPlaying(null));
  };

  const castOf = (v: VoiceLine): Character | null => characters.find(c => c.id === v.characterId || c.name.toUpperCase() === v.speaker.toUpperCase()) ?? null;

  return (
    <StageFrame
      icon={<Mic2 size={15} />}
      title="Voice"
      subtitle={voices.length ? `${done}/${voices.length} lines recorded · ${new Set(voices.map(v => v.speaker)).size} speakers` : 'Dialogue performance per character'}
      headerRight={
        <>
          <Segmented size="sm" value={filter} onChange={v => setFilter(v as never)} options={[{ value: 'all', label: 'All' }, { value: 'missing', label: 'Missing' }, { value: 'character', label: 'By cast' }]} />
          {filter === 'character' && <Select size="sm" className="w-[150px]" value={charFilter} onChange={setCharFilter} placeholder="Choose a character" options={characters.map(c => ({ value: c.id, label: c.name }))} />}
          <GenerateBar config={{ action: 'dialogue', label: 'Extract dialogue' }} modelKind="text" label="Extract from script" size="sm" variant="default" />
          <GenerateBar config={{ action: 'voices', label: 'All dialogue audio', params: filter === 'missing' ? {} : { all: true } }} modelKind="voice" label="Generate all lines" size="sm" />
        </>
      }
      asideTitle={selected ? `${selected.speaker}` : 'Line'}
      aside={selected ? (
        <div className="space-y-3 p-3">
          <div className="rounded-md border border-line-soft bg-well p-2.5">
            <div className="label mb-1">Line</div>
            <p className="font-cine text-[12px] leading-relaxed text-ink">“{selected.text}”</p>
          </div>
          {selected.assetId && (
            <div className="rounded-md border border-line-soft bg-well p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <Button size="xs" variant="primary" onClick={() => play(selected)}>{playing === selected.id ? <Pause size={11} /> : <Play size={11} />}{playing === selected.id ? 'Stop' : 'Play take'}</Button>
                <span className="text-[10px] text-ink3 tnum">{formatSeconds(assetById.get(selected.assetId)?.durationSec ?? 0)}</span>
                {assetById.get(selected.assetId)?.demo && <PrevisBadge label="SCRATCH TAKE" />}
              </div>
              <Waveform peaks={(assetById.get(selected.assetId)?.meta as any)?.peaks ?? []} />
            </div>
          )}
          <Field label="Character">
            <Select value={selected.characterId ?? ''} onChange={v => void update<VoiceLine>('voices', selected.id, { characterId: v || null } as Partial<VoiceLine>)}
              placeholder="Unassigned" options={characters.map(c => ({ value: c.id, label: `${c.name} · ${c.role}` }))} />
          </Field>
          <Field label="Voice" hint="Kept per character so the same voice returns in every scene.">
            <Select value={selected.voiceId} onChange={v => void update<VoiceLine>('voices', selected.id, { voiceId: v } as Partial<VoiceLine>)}
              options={voiceCatalog.map(v => ({ value: v.id, label: v.name, group: (v as any).category }))} />
          </Field>
          <Field label="Language"><Select value={selected.language} onChange={v => void update<VoiceLine>('voices', selected.id, { language: v } as Partial<VoiceLine>)} options={['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'hi', 'ar', 'zh']} /></Field>
          <Field label="Emotion"><Select value={selected.emotion} onChange={v => void update<VoiceLine>('voices', selected.id, { emotion: v } as Partial<VoiceLine>)} options={EMOTIONS} /></Field>
          <Field label="Speed"><Slider value={selected.speed} min={0.6} max={1.6} step={0.05} onChange={v => void update<VoiceLine>('voices', selected.id, { speed: v } as Partial<VoiceLine>)} format={v => `${v.toFixed(2)}×`} /></Field>
          <Field label="Pitch"><Slider value={selected.pitch} min={-12} max={12} step={1} bipolar onChange={v => void update<VoiceLine>('voices', selected.id, { pitch: v } as Partial<VoiceLine>)} format={v => `${v > 0 ? '+' : ''}${v} st`} /></Field>
          <Field label="Dialogue text"><TextArea rows={3} value={selected.text} onChange={e => void update<VoiceLine>('voices', selected.id, { text: e.target.value } as Partial<VoiceLine>)} /></Field>
          <div>
            <MetaRow label="Take">#{selected.take}</MetaRow>
            <MetaRow label="Scene">{scenes.find(s => s.id === selected.sceneId)?.heading ?? '—'}</MetaRow>
            <MetaRow label="Status"><Badge tone={selected.status === 'ready' || selected.status === 'approved' ? 'ok' : 'mut'}>{selected.status}</Badge></MetaRow>
          </div>
          <GenerateBar config={{ action: 'voices', label: `Take · ${selected.speaker}`, params: { lineId: selected.id, emotion: selected.emotion, speed: selected.speed, pitch: selected.pitch, voiceId: selected.voiceId, language: selected.language } }} modelKind="voice" label="Generate take" size="sm" />
          {castOf(selected)?.voiceProfile && (
            <StageNote tone="info" title="Voice direction">
              {castOf(selected)?.voiceProfile}
            </StageNote>
          )}
        </div>
      ) : undefined}
      footer={voices.length ? (
        <ReviewBar approved={done > 0 && done === voices.length} next="sound"
          onApprove={async () => { for (const v of voices) if (v.assetId && v.status !== 'approved') await update<VoiceLine>('voices', v.id, { status: 'approved' } as Partial<VoiceLine>); useProject.getState().markStage('voice', 'approved'); toast({ level: 'success', title: 'Dialogue approved' }); }}
          onRegenerate={() => void generate('voices', { all: true })}
          note={<>{done} of {voices.length} lines have audio · {voices.filter(v => v.demo).length} scratch takes</>} />
      ) : undefined}>
      <div className="p-4 xl:p-6">
        {!voices.length && generating && <div className="space-y-2">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>}
        {!voices.length && !generating && (
          <EmptyState icon={<Mic2 size={17} />} title="No dialogue lines yet"
            body={<>Extract dialogue from the screenplay. Each line is matched to its character, so the character's voice profile is used as direction and the same voice returns in every scene.</>}
            action={<GenerateBar config={{ action: 'dialogue', label: 'Extract dialogue' }} modelKind="text" label="Extract dialogue" />} />
        )}

        {voices.length > 0 && (
          <>
            <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {[...new Map(voices.map(v => [v.speaker, v])).values()].map(v => {
                const c = castOf(v);
                const lines = voices.filter(x => x.speaker === v.speaker);
                return (
                  <Card key={v.speaker} hover className="flex items-center gap-2.5 p-2.5" onClick={() => { setFilter('character'); setCharFilter(c?.id ?? ''); }}>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-accent-on"
                      style={{ background: `linear-gradient(160deg, ${c?.color ?? '#D99A32'}, ${c?.color ?? '#D99A32'}88)` }}>
                      {v.speaker.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold text-ink">{v.speaker}</span>
                      <span className="block truncate text-[10px] text-ink3">{lines.filter(l => l.assetId).length}/{lines.length} lines · {c?.voiceProfile?.slice(0, 34) ?? v.voiceId}</span>
                    </span>
                    <GenerateBar config={{ action: 'voices', label: v.speaker, params: { lineId: undefined, sceneId: undefined, all: true } }} modelKind="voice" label="" size="xs" variant="ghost" />
                  </Card>
                );
              })}
            </div>

            <div className="space-y-1.5">
              {shown.map(v => {
                const asset = v.assetId ? assetById.get(v.assetId) : null;
                const busy = jobs.some(j => (j.status === 'queued' || j.status === 'running') && (j.input as any)?.target?.id === v.id);
                const sc = scenes.find(s => s.id === v.sceneId);
                const c = castOf(v);
                return (
                  <Card key={v.id} hover className={cx('flex items-start gap-3 p-2.5', selectedId === v.id && 'border-accent/40')}>
                    <span className="mt-0.5 h-6 w-1 shrink-0 rounded-full" style={{ background: c?.color ?? '#3A352E' }} />
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(v.id)}>
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-ink">{v.speaker}</span>
                        <Badge tone="mut">{v.emotion}</Badge>
                        {sc && <span className="text-[10px] text-ink3">SC {String(sc.index).padStart(2, '0')}</span>}
                        {asset?.demo && <PrevisBadge label="SCRATCH TAKE" />}
                        {v.status === 'approved' && <Badge tone="ok"><Check size={9} /></Badge>}
                        {busy && <Badge tone="info">rendering…</Badge>}
                      </span>
                      <span className="mt-1 block font-cine text-[12.5px] leading-relaxed text-ink2">“{v.text}”</span>
                      {asset && (
                        <span className="mt-1.5 block"><Waveform peaks={(asset.meta as any)?.peaks ?? []} height={18} playing={playing === v.id} /></span>
                      )}
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {asset && (
                        <Tip label={playing === v.id ? 'Stop' : 'Play'}>
                          <button type="button" className={cx('icon-btn', playing === v.id && 'text-accent-bright')} onClick={() => play(v)}>{playing === v.id ? <Pause size={13} /> : <Play size={13} />}</button>
                        </Tip>
                      )}
                      <Tip label="New take">
                        <button type="button" className="icon-btn" onClick={() => void generate('voices', { lineId: v.id, emotion: v.emotion, voiceId: v.voiceId, speed: v.speed, pitch: v.pitch })}><RotateCcw size={13} /></button>
                      </Tip>
                      <Tip label={v.status === 'approved' ? 'Unapprove' : 'Approve'}>
                        <button type="button" className={cx('icon-btn', v.status === 'approved' && 'text-ok')} onClick={() => void update<VoiceLine>('voices', v.id, { status: v.status === 'approved' ? 'ready' : 'approved' } as Partial<VoiceLine>)}><Check size={13} /></button>
                      </Tip>
                      <Tip label="Reject"><button type="button" className="icon-btn hover:text-bad" onClick={() => void update<VoiceLine>('voices', v.id, { status: 'none', assetId: null } as Partial<VoiceLine>)}><X size={13} /></button></Tip>
                    </div>
                  </Card>
                );
              })}
            </div>

            <div className="mt-5"><StageNote tone="warn" title="Scratch takes are labelled, never disguised">
              Without a voice provider the demo engine renders a syllable-timed scratch track — real audio at the right
              length, useful for timing a cut, and clearly marked <PrevisBadge label="SCRATCH TAKE" />. It is not speech and is
              never presented as such. Add an ElevenLabs or OpenAI key for real dialogue.
            </StageNote></div>
          </>
        )}
      </div>
    </StageFrame>
  );
}

export function Waveform({ peaks, height = 22, playing }: { peaks: number[]; height?: number; playing?: boolean }) {
  if (!peaks?.length) return <span className="block rounded bg-well" style={{ height }} />;
  const n = Math.min(peaks.length, 120);
  const step = peaks.length / n;
  return (
    <span className="flex items-center gap-px overflow-hidden rounded bg-well px-1" style={{ height }}>
      {Array.from({ length: n }).map((_, i) => {
        const v = peaks[Math.floor(i * step)] ?? 0;
        return <span key={i} className={cx('flex-1 rounded-sm', playing ? 'bg-accent-bright' : 'bg-accent/55')} style={{ height: `${Math.max(8, v * 100)}%` }} />;
      })}
    </span>
  );
}
