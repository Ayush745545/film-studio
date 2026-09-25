'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Sparkles, Clapperboard } from 'lucide-react';
import { Modal } from '@/components/ui/overlays';
import { Button, Badge, cx } from '@/components/ui/primitives';
import { Field, TextInput, Select, TextArea, Toggle } from '@/components/ui/inputs';
import { Tip } from '@/components/ui/primitives';
import { useApp, useBoot } from '@/store/app';
import { post, describeError } from '@/lib/client/api';
import { PROJECT_TYPES, type AspectRatio, type ProjectSettings, type ProjectType, type Fps, type Resolution } from '@/types';

const STYLES = ['Cinematic', 'Hollywood', 'Anime', 'Stylized', 'Dark Horror', 'Sci-Fi', 'Fantasy', 'Documentary', 'Commercial', 'Noir', 'Vintage'];
const DURATIONS = [
  { value: '15', label: '15 seconds — social spot' }, { value: '30', label: '30 seconds — ad/social' },
  { value: '60', label: '60 seconds — short' }, { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' }, { value: '600', label: '10 minutes' },
  { value: '1800', label: '30 minutes — episode' }
];
const FORMATS: { value: AspectRatio; label: string; hint: string }[] = [
  { value: '16:9', label: '16:9 Landscape', hint: 'Film, YouTube, broadcast' },
  { value: '2.39:1', label: '2.39:1 Scope', hint: 'Cinemascope feature look' },
  { value: '9:16', label: '9:16 Vertical', hint: 'Reels, Shorts, TikTok' },
  { value: '1:1', label: '1:1 Square', hint: 'Feed posts' },
  { value: '4:5', label: '4:5 Portrait', hint: 'Feed, maximised height' },
  { value: '4:3', label: '4:3 Classic', hint: 'Period / archival' },
  { value: '21:9', label: '21:9 Ultrawide', hint: 'Desktop hero' }
];

const TYPE_DEFAULTS: Partial<Record<ProjectType, Partial<ProjectSettings>>> = {
  'new-video': { format: '16:9', durationSec: 120, fps: 30, style: 'Cinematic' },
  'short-film': { format: '2.39:1', durationSec: 180, fps: 24, style: 'Cinematic' },
  'feature-film': { format: '2.39:1', durationSec: 5400, fps: 24, style: 'Hollywood' },
  drama: { format: '16:9', durationSec: 1800, fps: 24, style: 'Cinematic' },
  series: { format: '16:9', durationSec: 1800, fps: 24, style: 'Cinematic' },
  'music-video': { format: '16:9', durationSec: 210, fps: 24, style: 'Stylized' },
  commercial: { format: '16:9', durationSec: 30, fps: 25, style: 'Commercial' },
  documentary: { format: '16:9', durationSec: 1800, fps: 25, style: 'Documentary' },
  trailer: { format: '2.39:1', durationSec: 90, fps: 24, style: 'Hollywood' },
  youtube: { format: '16:9', durationSec: 600, fps: 30, style: 'Documentary' },
  'social-short': { format: '9:16', durationSec: 30, fps: 30, style: 'Cinematic' },
  explainer: { format: '16:9', durationSec: 90, fps: 30, style: 'Stylized' },
  animation: { format: '16:9', durationSec: 180, fps: 24, style: 'Anime' }
};

export function NewProjectModal({ open, type, onClose }: { open: boolean; type: ProjectType; onClose: () => void }) {
  const router = useRouter();
  const boot = useBoot();
  const toast = useApp(s => s.toast);
  const presets = boot?.presets ?? [];
  const [name, setName] = React.useState('');
  const [ptype, setType] = React.useState<ProjectType>(type);
  const [format, setFormat] = React.useState<AspectRatio>('16:9');
  const [duration, setDuration] = React.useState('60');
  const [style, setStyle] = React.useState('Cinematic');
  const [presetId, setPresetId] = React.useState('');
  const [advanced, setAdvanced] = React.useState(false);
  const [fps, setFps] = React.useState<Fps>(24);
  const [resolution, setResolution] = React.useState<Resolution>('1080p');
  const [language, setLanguage] = React.useState('en');
  const [negative, setNegative] = React.useState('watermark, text, logo, subtitles, deformed hands, extra limbs, blurry, low quality');
  const [seed, setSeed] = React.useState(0);
  const [idea, setIdea] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setType(type);
    const d = TYPE_DEFAULTS[type] ?? {};
    setFormat((d.format ?? '16:9') as AspectRatio);
    setDuration(String(d.durationSec ?? 60));
    setStyle(d.style ?? 'Cinematic');
    setFps((d.fps ?? 24) as Fps);
    setSeed(Math.floor(Math.random() * 1_000_000));
    const demo = presets.find(p => p.name.startsWith('Demo')) ?? presets[0];
    setPresetId(boot?.demoMode && demo ? demo.id : (presets.find(p => p.name === 'Cinematic Pro')?.id ?? ''));
    setName(type === 'new-video' ? 'Untitled edit' : '');
  }, [open, type, presets, boot?.demoMode]);

  const create = async () => {
    const finalName = name.trim() || (idea.trim().split(/\s+/).slice(0, 5).join(' ') || defaultName(ptype));
    setBusy(true);
    try {
      const p = await post<{ id: string }>('/api/projects', {
        name: finalName, type: ptype,
        settings: {
          type: ptype, format, durationSec: Number(duration), style, presetId: presetId || null,
          fps, resolution, language, seed, negativePrompt: negative, motionStyle: 'Cinematic', autoApprove: false
        } as Partial<ProjectSettings>,
        idea: idea.trim() ? { text: idea.trim() } : undefined,
        description: idea.trim().slice(0, 200)
      });
      toast({ level: 'success', title: 'Project created', body: ptype === 'new-video' ? 'Opening the editor.' : 'Start with the Idea stage.' });
      onClose();
      router.push(ptype === 'new-video' ? `/editor/${p.id}` : `/project/${p.id}?stage=idea`);
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body });
    } finally { setBusy(false); }
  };

  const fmt = FORMATS.find(f => f.value === format);

  return (
    <Modal open={open} onClose={onClose} width={620} icon={<Clapperboard size={14} />}
      title="New project" sub="Everything you choose here becomes the project's default for every generation stage."
      footer={
        <>
          <span className="mr-auto text-[10.5px] text-ink3">Created with an empty timeline and full version history.</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={create} iconRight={<Sparkles size={12} />}>Create project</Button>
        </>
      }>
      <div className="space-y-3.5">
        <Field label="Project name" required>
          <TextInput autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="My next film" maxLength={120} />
        </Field>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Project type">
            <Select value={ptype} onChange={v => setType(v as ProjectType)}
              options={PROJECT_TYPES.map(t => ({ value: t.id, label: t.label }))} />
          </Field>
          <Field label="Format" hint={fmt?.hint}>
            <Select value={format} onChange={v => setFormat(v as AspectRatio)} options={FORMATS.map(f => ({ value: f.value, label: f.label }))} />
          </Field>
          <Field label="Duration">
            <Select value={duration} onChange={setDuration} options={DURATIONS} />
          </Field>
          <Field label="Style">
            <Select value={style} onChange={setStyle} options={STYLES} />
          </Field>
        </div>

        <Field label="AI model preset" hint="Decides which model serves each capability. You can override per generation later.">
          <Select value={presetId} onChange={setPresetId} placeholder="Router decides (best quality)"
            options={presets.map(p => ({ value: p.id, label: p.name, group: p.builtIn ? 'Built-in' : 'Yours' }))} />
          {presetId && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone="mut">{presets.find(p => p.id === presetId)?.description.slice(0, 90) ?? ''}</Badge>
            </div>
          )}
        </Field>

        {ptype !== 'new-video' && (
          <Field label="Idea (optional — you can write it properly in the Idea stage)"
            hint="A sentence or two is enough to seed story generation.">
            <TextArea rows={3} value={idea} onChange={e => setIdea(e.target.value)}
              placeholder="A sound archivist discovers that a tape she restored contains a conversation that never happened…" />
          </Field>
        )}

        <button type="button" onClick={() => setAdvanced(a => !a)}
          className="flex w-full items-center gap-1.5 rounded-md border border-line-soft bg-well2 px-3 py-2 text-[11px] font-medium text-ink2 transition-colors hover:text-ink">
          <ChevronDown size={12} className={cx('transition-transform duration-200', advanced && 'rotate-180')} />
          Advanced settings
          <span className="ml-auto text-ink3">frame rate, resolution, seed, negative prompt</span>
        </button>

        {advanced && (
          <div className="space-y-3.5 rounded-lg border border-line-soft bg-well p-3">
            <div className="grid gap-3.5 sm:grid-cols-2">
              <Field label="Frame rate">
                <Select value={String(fps)} onChange={v => setFps(Number(v) as Fps)}
                  options={[24, 25, 30, 50, 60].map(f => ({ value: String(f), label: `${f} fps${f === 24 ? ' — film' : f === 25 ? ' — PAL' : f === 30 ? ' — web/NTSC' : ' — motion'}` }))} />
              </Field>
              <Field label="Resolution">
                <Select value={resolution} onChange={v => setResolution(v as Resolution)}
                  options={['720p', '1080p', '1440p', '4k'].map(r => ({ value: r, label: r.toUpperCase() }))} />
              </Field>
              <Field label="Language">
                <Select value={language} onChange={setLanguage}
                  options={[['en', 'English'], ['es', 'Spanish'], ['fr', 'French'], ['de', 'German'], ['it', 'Italian'], ['pt', 'Portuguese'], ['ja', 'Japanese'], ['ko', 'Korean'], ['hi', 'Hindi'], ['ar', 'Arabic'], ['zh', 'Chinese']].map(([v, l]) => ({ value: v, label: l }))} />
              </Field>
              <Field label="Master seed" hint="0 = random per generation">
                <div className="flex gap-1.5">
                  <TextInput type="number" value={seed} min={0} onChange={e => setSeed(Math.max(0, Number(e.target.value)))} className="tnum" />
                  <Tip label="New random seed"><Button size="sm" onClick={() => setSeed(Math.floor(Math.random() * 1_000_000))}>↻</Button></Tip>
                </div>
              </Field>
            </div>
            <Field label="Global negative prompt" hint="Appended to every image and video generation in this project.">
              <TextArea rows={2} value={negative} onChange={e => setNegative(e.target.value)} />
            </Field>
          </div>
        )}

        <div className="rounded-md border border-line-soft bg-well px-3 py-2.5">
          <Toggle checked={ptype === 'new-video'} onChange={() => {}} disabled
            label="Open the editor immediately"
            hint={ptype === 'new-video' ? 'New Video projects skip straight to the timeline.' : 'AI projects open at the Idea stage; the editor is stage 13.'} />
        </div>
      </div>
    </Modal>
  );
}

function defaultName(t: ProjectType): string {
  const base = PROJECT_TYPES.find(x => x.id === t)?.label ?? 'Project';
  return `${base} ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
