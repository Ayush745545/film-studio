'use client';
import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { Wand2, Sparkles, Image as ImageIcon, Video, Mic2, Music, Zap, Upload, X, Shuffle, Lock, Loader2, Download, Trash2 } from 'lucide-react';
import { Button, Badge, Card, EmptyState, cx, Tip, PrevisBadge, Segmented } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Slider } from '@/components/ui/inputs';
import { AssetThumb } from '@/components/stages/AssetThumb';
import { useApp, useBoot } from '@/store/app';
import { post, get, patch as patchApi, upload, del, describeError } from '@/lib/client/api';
import { IMAGE_PRESETS, MOTION_PRESETS, CAMERA_PRESETS } from '@/lib/ai/registry';
import { hashSeedish } from '@/lib/client/hash';
import type { Asset, GenKind, GenerationJob } from '@/types';

const KINDS: { id: GenKind; label: string; icon: React.ReactNode }[] = [
  { id: 'image', label: 'Image', icon: <ImageIcon size={13} /> },
  { id: 'video', label: 'Video', icon: <Video size={13} /> },
  { id: 'voice', label: 'Voice', icon: <Mic2 size={13} /> },
  { id: 'music', label: 'Music', icon: <Music size={13} /> },
  { id: 'sfx', label: 'Sound effect', icon: <Wand2 size={13} /> },
  { id: 'text', label: 'Text', icon: <Sparkles size={13} /> }
];

interface RouteEstimate {
  credits: number;
  model: string;
  provider: string;
  providerId: string;
  demo: boolean;
  breakdown: string;
  strategy: string;
  reason: string;
  credentialSource: 'user' | 'env' | 'none';
  fallbacks: { model: string; provider: string; providerId: string }[];
}

/** The unified AI generator — every input the platform exposes, one screen. */
export function GenerateScreen() {
  const search = useSearchParams();
  const boot = useBoot();
  const toast = useApp(s => s.toast);
  const credits = useApp(s => s.credits);
  const recent = useApp(s => s.recentAssets);

  const [kind, setKind] = React.useState<GenKind>((search?.get('kind') as GenKind) || 'image');
  const [prompt, setPrompt] = React.useState('');
  const [negative, setNegative] = React.useState('watermark, text, logo, deformed hands, extra limbs, blurry');
  const [preset, setPreset] = React.useState('cinematic-realism');
  const [modelId, setModelId] = React.useState(search?.get('model') ?? '');
  const [aspect, setAspect] = React.useState('16:9');
  const [resolution, setResolution] = React.useState('1080p');
  const [duration, setDuration] = React.useState(5);
  const [seed, setSeed] = React.useState(0);
  const [lockSeed, setLockSeed] = React.useState(false);
  const [steps, setSteps] = React.useState(30);
  const [guidance, setGuidance] = React.useState(6);
  const [count, setCount] = React.useState(1);
  const [motion, setMotion] = React.useState('Cinematic');
  const [camera, setCamera] = React.useState('Dolly');
  const [voiceId, setVoiceId] = React.useState('alloy');
  const [emotion, setEmotion] = React.useState('neutral');
  const [speed, setSpeed] = React.useState(1);
  const [pitch, setPitch] = React.useState(0);
  const [audioPreset, setAudioPreset] = React.useState('score-warm');
  const [bpm, setBpm] = React.useState(90);
  const [refs, setRefs] = React.useState<Asset[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [job, setJob] = React.useState<GenerationJob | null>(null);
  const [results, setResults] = React.useState<Asset[]>([]);
  const [textOut, setTextOut] = React.useState('');
  const [estimate, setEstimate] = React.useState<RouteEstimate | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const providers = boot?.providers ?? [];
  const providerById = React.useMemo(() => new Map(providers.map(provider => [provider.id, provider])), [providers]);
  const models = React.useMemo(() => (boot?.models ?? []).filter(model => {
    const provider = providerById.get(model.providerId);
    const connected = Boolean(provider?.enabled && (provider.credentialStatus === 'connected' || provider.credentialStatus === 'env'));
    return model.enabled && connected && (model.kind === kind || model.capabilities.includes(kind as never));
  }), [boot?.models, providerById, kind]);

  React.useEffect(() => {
    if (modelId && !models.some(model => model.id === modelId)) setModelId('');
  }, [modelId, models]);
  const activePreset = IMAGE_PRESETS.find(p => p.id === preset) ?? IMAGE_PRESETS[0];

  // re-estimate whenever the request shape changes
  React.useEffect(() => {
    if (!prompt.trim() && kind !== 'text') { setEstimate(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await post<{ estimate: RouteEstimate }>('/api/generate', {
          kind, prompt, dryRun: true, modelId: modelId || null, count, durationSec: duration,
          aspectRatio: aspect, resolution
        });
        setEstimate(r.estimate);
      } catch { setEstimate(null); }
    }, 320);
    return () => clearTimeout(t);
  }, [kind, prompt, modelId, count, duration, aspect, resolution]);

  // poll the running job for live progress
  React.useEffect(() => {
    if (!jobId) return;
    let alive = true;
    const tick = async () => {
      try {
        const j = await get<GenerationJob>(`/api/jobs/${jobId}`);
        if (!alive) return;
        setJob(j);
        if (['succeeded', 'failed', 'cancelled'].includes(j.status)) {
          setBusy(false); setJobId(null);
          if (j.status === 'succeeded') {
            const ids = j.assetIds ?? [];
            if (ids.length) {
              const fetched = await Promise.all(ids.map(id => get<Asset>(`/api/assets/${id}`).catch(() => null)));
              setResults(fetched.filter(Boolean) as Asset[]);
            }
            const out = (j.output ?? {}) as { text?: string };
            if (out.text) setTextOut(out.text);
            toast({ level: 'success', title: 'Generation complete', body: j.demo ? 'Built-in Studio Engine — previsualisation media.' : `${ids.length} asset(s) added to the library.` });
          } else {
            toast({ level: 'error', title: j.error?.message ?? 'Generation failed', body: j.error?.suggestion, ttl: 12000 });
          }
          return;
        }
      } catch { /* transient */ }
      setTimeout(tick, 700);
    };
    void tick();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const applyPreset = (id: string) => {
    const p = IMAGE_PRESETS.find(x => x.id === id);
    if (!p) return;
    setPreset(id); setSteps(p.steps); setGuidance(p.guidance);
    if (!negative.includes(p.negative.slice(0, 18))) setNegative(p.negative);
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const fd = new FormData();
      for (const f of Array.from(files)) fd.append('files', f);
      const r = await upload<{ assets: Asset[] }>('/api/uploads', fd);
      setRefs(prev => [...prev, ...r.assets].slice(0, 6));
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { if (fileRef.current) fileRef.current.value = ''; }
  };

  const generate = async (n: number) => {
    if (!prompt.trim() && kind !== 'text') { toast({ level: 'warn', title: 'Write a prompt first' }); return; }
    setBusy(true); setTextOut(''); setResults([]);
    const useSeed = lockSeed && seed ? seed : hashSeedish(prompt + Date.now());
    if (!lockSeed) setSeed(useSeed);
    try {
      const r = await post<{ job: GenerationJob }>('/api/generate', {
        kind, prompt, negativePrompt: negative, projectId: null,
        modelId: modelId || null, count: kind === 'image' ? n : 1,
        durationSec: kind === 'video' ? duration : kind === 'music' ? duration * 6 : kind === 'sfx' ? Math.min(20, duration) : undefined,
        aspectRatio: aspect, resolution, seed: useSeed,
        name: prompt.slice(0, 48) || `${kind} generation`,
        voice: kind === 'voice' ? { voiceId, language: 'en', emotion, speed, pitch, stability: 0.6, clarity: 0.78 } : undefined,
        audio: kind === 'music' || kind === 'sfx' ? { preset: audioPreset, bpm } : undefined,
        referenceImages: refs.map(a => ({ key: a.storageKey, url: a.url, mime: a.mimeType, name: a.name })),
        text: kind === 'text' ? { temperature: 0.85, maxTokens: 2000 } : undefined
      });
      setJobId(r.job.id);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body, ttl: 12000 });
      setBusy(false);
    }
  };

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-vignette opacity-60" />
      <div className="relative mx-auto w-full max-w-[1360px] px-6 py-7 lg:px-10">
        <header className="mb-5">
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight text-ink"><Wand2 size={18} className="text-accent" />AI Generator</h1>
          <p className="mt-1 max-w-[86ch] text-[12.5px] leading-relaxed text-ink2">
            One interface for every capability. The model router resolves your selection against the providers you have
            configured, falls back automatically on failure, and everything you generate lands in the asset library.
          </p>
        </header>

        <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
          {/* controls */}
          <div className="space-y-3">
            <Card hover={false} className="p-3.5">
              <Segmented className="w-full" value={kind} onChange={v => { setKind(v as GenKind); setModelId(''); setResults([]); setTextOut(''); }}
                options={KINDS.map(k => ({ value: k.id, label: <span className="flex items-center gap-1">{k.icon}{k.label}</span> }))} />
            </Card>

            <Card hover={false} className="space-y-3 p-3.5">
              <Field label="Prompt" required>
                <TextArea rows={kind === 'text' ? 8 : 5} value={prompt} onChange={e => setPrompt(e.target.value)}
                  placeholder={kind === 'image' ? 'A rain-soaked alley at night, neon reflecting in puddles, steam rising, 35mm anamorphic'
                    : kind === 'video' ? 'Slow dolly through the alley, camera keeps level, puddles ripple as it passes'
                    : kind === 'voice' ? 'The line of dialogue to speak.'
                    : kind === 'music' ? 'Low sustained strings with a slow pulse, no melody'
                    : kind === 'sfx' ? 'Interior door opens, handle mechanism, closes with a soft latch'
                    : 'Write a logline for a neo-noir short about a sound archivist…'} />
              </Field>

              {kind !== 'text' && kind !== 'voice' && (
                <Field label="Negative prompt"><TextArea rows={2} value={negative} onChange={e => setNegative(e.target.value)} /></Field>
              )}

              {kind === 'image' && (
                <Field label="Style preset">
                  <Select value={preset} onChange={applyPreset} options={IMAGE_PRESETS.map(p => ({ value: p.id, label: p.label }))} />
                  <p className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-ink3">{activePreset.prompt}</p>
                </Field>
              )}

              <Field label="Model" hint="Empty lets the router pick by capability, quality and availability.">
                <Select value={modelId} onChange={setModelId} placeholder="Router decides"
                  options={models.map(m => ({ value: m.id, label: m.name, sub: `${m.costPerUnit} cr/${m.unit}`, group: m.demo ? 'Built-in engine' : providerName(boot?.providers ?? [], m.providerId), badge: m.demo ? <PrevisBadge /> : m.isDefault ? <Badge tone="accent">default</Badge> : undefined }))} />
              </Field>

              {(kind === 'image' || kind === 'video') && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Aspect ratio"><Select value={aspect} onChange={setAspect} options={['16:9', '9:16', '1:1', '4:5', '2.39:1', '4:3', '21:9']} /></Field>
                  <Field label="Resolution"><Select value={resolution} onChange={setResolution} options={['480p', '720p', '1080p', '1440p', '4k']} /></Field>
                </div>
              )}

              {(kind === 'video' || kind === 'music') && (
                <Field label={kind === 'video' ? 'Duration' : 'Duration (music)'}>
                  <Slider value={duration} min={kind === 'video' ? 1 : 5} max={kind === 'video' ? 12 : 60} step={kind === 'video' ? 1 : 5} onChange={setDuration} unit="s" />
                </Field>
              )}
              {kind === 'sfx' && <Field label="Duration"><Slider value={duration} min={1} max={20} step={0.5} onChange={setDuration} unit="s" /></Field>}

              {kind === 'video' && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Motion"><Select value={motion} onChange={setMotion} options={[...MOTION_PRESETS]} /></Field>
                  <Field label="Camera"><Select value={camera} onChange={setCamera} options={[...CAMERA_PRESETS]} /></Field>
                </div>
              )}

              {kind === 'voice' && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Voice"><Select value={voiceId} onChange={setVoiceId} options={['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse']} /></Field>
                    <Field label="Emotion"><Select value={emotion} onChange={setEmotion} options={['neutral', 'anxious', 'angry', 'sad', 'joyful', 'fearful', 'whisper', 'authoritative', 'tender', 'exhausted', 'excited', 'flat']} /></Field>
                  </div>
                  <Slider label="Speed" min={0.6} max={1.6} step={0.05} value={speed} onChange={setSpeed} format={v => `${v.toFixed(2)}×`} />
                  <Slider label="Pitch" bipolar min={-12} max={12} step={1} value={pitch} onChange={setPitch} format={v => `${v > 0 ? '+' : ''}${v} st`} />
                </>
              )}

              {(kind === 'music' || kind === 'sfx') && (
                <div className="grid grid-cols-2 gap-2.5">
                  <Field label="Synth / style preset">
                    <Select value={audioPreset} onChange={setAudioPreset}
                      options={['score-tension', 'score-warm', 'score-epic', 'score-melancholy', 'score-drive', 'rain', 'storm', 'wind', 'city-traffic', 'room-tone', 'forest', 'ocean', 'crowd', 'footsteps', 'door', 'impact', 'whoosh', 'riser', 'server-hum', 'fire', 'clock', 'heartbeat']} />
                  </Field>
                  <Field label="BPM"><TextInput type="number" min={40} max={200} value={bpm} onChange={e => setBpm(Number(e.target.value))} /></Field>
                </div>
              )}

              {kind === 'image' && (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Steps"><Slider value={steps} min={8} max={60} step={1} onChange={setSteps} /></Field>
                    <Field label="Guidance"><Slider value={guidance} min={1} max={20} step={0.5} onChange={setGuidance} /></Field>
                  </div>
                  <Field label="Variations">
                    <Segmented className="w-full" value={String(count)} onChange={v => setCount(Number(v))}
                      options={[{ value: '1', label: '1' }, { value: '4', label: '4' }, { value: '8', label: '8' }]} />
                  </Field>
                </>
              )}

              <div className="rounded-md border border-line-soft bg-well p-2.5">
                <div className="flex items-center gap-2">
                  <Field label="Seed" className="flex-1">
                    <TextInput type="number" value={seed} onChange={e => setSeed(Number(e.target.value))} className="mono tnum" />
                  </Field>
                  <div className="flex gap-1 pb-0.5">
                    <Tip label={lockSeed ? 'Seed locked — reuse for consistency' : 'Lock this seed'}>
                      <button type="button" className="icon-btn" data-on={lockSeed} onClick={() => setLockSeed(v => !v)}>{lockSeed ? <Lock size={12} /> : <Shuffle size={12} />}</button>
                    </Tip>
                    <Tip label="Randomise"><button type="button" className="icon-btn" onClick={() => { setSeed(hashSeedish(prompt + Math.random())); setLockSeed(false); }}><Shuffle size={12} /></button></Tip>
                  </div>
                </div>
              </div>

              {(kind === 'image' || kind === 'video') && (
                <div>
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="field-label mb-0">Reference images {refs.length > 0 && <span className="text-ink3">({refs.length})</span>}</span>
                    <Button size="xs" variant="ghost" onClick={() => fileRef.current?.click()}><Upload size={11} />Upload</Button>
                    <input ref={fileRef} type="file" multiple accept="image/*" className="hidden" onChange={e => void onUpload(e.target.files)} />
                  </div>
                  {refs.length ? (
                    <div className="grid grid-cols-4 gap-1.5">
                      {refs.map(a => (
                        <div key={a.id} className="group relative">
                          <AssetThumb asset={a} ratio="1/1" animate="none" />
                          <button type="button" className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded bg-black/70 text-ink2 opacity-0 transition-opacity hover:text-bad group-hover:opacity-100"
                            onClick={() => setRefs(r => r.filter(x => x.id !== a.id))}><X size={9} /></button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-line px-2.5 py-2 text-[10px] leading-relaxed text-ink3">
                      Attach references for character or style consistency. Only sent to models that support them — the
                      adapter drops them gracefully otherwise.
                    </p>
                  )}
                </div>
              )}
            </Card>

            <Card hover={false} className="space-y-2.5 p-3.5">
              {estimate && (
                <div className={cx('rounded-md border px-2.5 py-2', estimate.credits > credits ? 'border-bad/35 bg-bad/[0.07]' : estimate.demo ? 'border-line-soft bg-well' : 'border-accent/30 bg-accent/[0.07]')}>
                  <div className="flex items-center gap-2">
                    <Zap size={12} className={estimate.credits > 0 ? 'text-accent' : 'text-ok'} />
                    <span className="text-[12px] font-semibold text-ink tnum">{estimate.credits > 0 ? `${estimate.credits} credits` : 'Free'}</span>
                    {estimate.demo && <PrevisBadge className="ml-auto" />}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-ink3">{estimate.breakdown}</p>
                  <div className="mt-2 border-t border-line-soft pt-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-medium text-ink2">Route</span>
                      <Badge tone="mut">{estimate.strategy}</Badge>
                    </div>
                    <p className="mt-1 text-[10.5px] text-ink2">{estimate.model} <span className="text-ink3">via {estimate.provider}</span></p>
                    <p className="mt-0.5 text-[10px] text-ink3">Key: {estimate.credentialSource === 'user' ? 'your API key' : estimate.credentialSource === 'env' ? 'platform API key' : 'no key required'}</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-ink3">{estimate.reason}</p>
                    <p className="mt-1 text-[10px] text-ink3">
                      Fallbacks: {estimate.fallbacks.length ? estimate.fallbacks.map(fallback => `${fallback.model} (${fallback.provider})`).join(' → ') : 'none'}
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-3 gap-1.5">
                <Button variant="primary" loading={busy} disabled={!prompt.trim() && kind !== 'text'} onClick={() => void generate(kind === 'image' ? count : 1)}>
                  <Sparkles size={12} />Generate{kind === 'image' && count > 1 ? ` ${count}` : ''}
                </Button>
                {kind === 'image' && <Button disabled={busy || !prompt.trim()} onClick={() => void generate(4)}>4</Button>}
                {kind === 'image' && <Button disabled={busy || !prompt.trim()} onClick={() => void generate(8)}>8</Button>}
              </div>
              <p className="text-center text-[10px] text-ink3">Balance {Math.round(credits).toLocaleString()} credits · charged on success, refunded on failure</p>
            </Card>
          </div>

          {/* results */}
          <div className="space-y-3">
            {busy && job && (
              <Card hover={false} className="p-4">
                <div className="flex items-center gap-2.5">
                  <Loader2 size={14} className="animate-spin text-accent-bright" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">{job.label}</p>
                    <p className="truncate text-[10.5px] text-ink3">{job.providerId ? `${job.providerId} · ` : ''}{Math.round(job.progress * 100)}%</p>
                  </div>
                  <Button size="xs" variant="ghost" onClick={async () => { await patchApi(`/api/jobs/${job.id}`, { action: 'cancel' }); setBusy(false); setJobId(null); }}>Cancel</Button>
                </div>
                <div className="mt-2.5 h-1.5"><div className="progress-track h-full"><div className="progress-fill" style={{ width: `${job.progress * 100}%` }} /></div></div>
                {(job.logs ?? []).length > 0 && (
                  <div className="scroll-thin mt-2.5 max-h-28 overflow-y-auto rounded-md border border-line-soft bg-deep p-2">
                    {job.logs.slice(-8).map((l, i) => <p key={i} className={cx('mono text-[9.5px]', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-accent-bright' : 'text-ink3')}>{l.msg}</p>)}
                  </div>
                )}
              </Card>
            )}

            {results.length > 0 && (
              <>
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-ink">Result{results.length > 1 ? 's' : ''}</h2>
                  <Badge tone="mut">{results.length}</Badge>
                  <div className="flex-1" />
                  <Button size="xs" variant="ghost" onClick={() => void generate(kind === 'image' ? count : 1)}><Shuffle size={11} />Regenerate</Button>
                </div>
                <div className={cx('grid gap-2.5', results.length === 1 ? 'sm:grid-cols-2' : results.length <= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-3 xl:grid-cols-4')}>
                  {results.map(a => (
                    <Card key={a.id} hover className="group overflow-hidden">
                      <AssetThumb asset={a} ratio={kind === 'video' ? '16/9' : '16/9'} animate="hover" className="rounded-none border-0 border-b border-line-soft" />
                      <div className="space-y-1 p-2">
                        <AssetMeta asset={a} />
                        <div className="flex gap-1">
                          <a className="btn btn-xs flex-1" href={a.url} download={a.name} target="_blank" rel="noreferrer"><Download size={10} />Save</a>
                          <Tip label="Use as reference"><button type="button" className="btn btn-xs" onClick={() => setRefs(r => [...r, a].slice(0, 6))}><Upload size={10} /></button></Tip>
                          <Tip label="Delete"><button type="button" className="btn btn-xs" onClick={async () => { await del(`/api/assets/${a.id}`); setResults(rs => rs.filter(x => x.id !== a.id)); }}><Trash2 size={10} /></button></Tip>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </>
            )}

            {textOut && (
              <Card hover={false} className="p-4">
                <div className="label mb-2">Model output</div>
                <pre className="scroll-thin max-h-[52vh] overflow-auto whitespace-pre-wrap font-sans text-[12.5px] leading-relaxed text-ink2">{textOut}</pre>
                <div className="mt-3 flex gap-1.5">
                  <Button size="xs" onClick={() => { void navigator.clipboard?.writeText(textOut); toast({ level: 'success', title: 'Copied' }); }}><Sparkles size={11} />Copy</Button>
                  <Button size="xs" variant="ghost" onClick={() => void generate(1)}><Shuffle size={11} />Regenerate</Button>
                </div>
              </Card>
            )}

            {!busy && !results.length && !textOut && (
              <EmptyState icon={<Wand2 size={17} />} title="Nothing generated yet"
                body={<>Write a prompt and pick a capability. Estimates are computed against the real router, so the credit
                  figure you see is what the job will reserve. Generated media is saved to the asset library and can be
                  dragged onto any timeline.</>}
                action={<div className="flex flex-wrap justify-center gap-1.5">{IMAGE_PRESETS.slice(0, 5).map(p => (
                  <button key={p.id} type="button" onClick={() => { applyPreset(p.id); setPrompt(p.prompt.split(',')[0]); }}
                    className="rounded-full border border-line bg-pop px-2.5 py-1 text-[10.5px] text-ink3 transition-colors hover:border-accent/35 hover:text-accent-bright">{p.label}</button>))}</div>} />
            )}

            {recent.length > 0 && (
              <Card hover={false} className="overflow-hidden">
                <div className="border-b border-line-soft px-3.5 py-2.5"><div className="label">Recently generated</div></div>
                <div className="grid grid-cols-4 gap-1.5 p-2.5 sm:grid-cols-6 lg:grid-cols-8">
                  {dedupe(recent).slice(0, 16).map(a => <AssetThumb key={a.id} asset={a} ratio="1/1" animate="hover" />)}
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Defensive: never render two children with the same key. */
function dedupe(list: Asset[]): Asset[] {
  const seen = new Set<string>();
  return list.filter(a => (seen.has(a.id) ? false : (seen.add(a.id), true)));
}

function AssetMeta({ asset }: { asset: Asset }) {
  return (
    <div className="space-y-0.5">
      <p className="truncate text-[10.5px] font-medium text-ink2">{asset.name}</p>
      <div className="flex flex-wrap items-center gap-1 text-[9px] text-ink3">
        <span className="mono">seed {asset.seed}</span>
        {asset.width ? <span className="tnum">{asset.width}×{asset.height}</span> : null}
        {asset.durationSec ? <span className="tnum">{asset.durationSec.toFixed(1)}s</span> : null}
        {asset.demo && <PrevisBadge />}
      </div>
    </div>
  );
}
function providerName(providers: { id: string; name: string }[], id: string) { return providers.find(p => p.id === id)?.name ?? id; }
