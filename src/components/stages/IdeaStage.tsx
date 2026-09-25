'use client';
import * as React from 'react';
import { Lightbulb, Wand2, Moon, Heart, Zap, Maximize2, Minimize2, Shuffle, History, Check, RotateCcw, Sparkles, Compass } from 'lucide-react';
import { StageFrame, StageNote, MetaRow } from './StageFrame';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, cx, Tip, EmptyState, Collapsible, PrevisBadge } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select } from '@/components/ui/inputs';
import { useConfirm } from '@/components/ui/overlays';
import { useProject } from '@/store/project';
import { useApp, useDemoMode } from '@/store/app';
import { useTextJob } from '@/hooks/useTextJob';
import { describeError } from '@/lib/client/api';
import type { Idea } from '@/types';
import { EMPTY_IDEA } from '@/types';

const FIELDS: { key: keyof Idea; label: string; placeholder: string; long?: boolean; options?: string[] }[] = [
  { key: 'text', label: 'Idea', placeholder: 'A sound archivist restoring a damaged tape hears a conversation that was never recorded…', long: true },
  { key: 'genre', label: 'Genre', placeholder: 'Neo-noir thriller', options: ['Drama', 'Thriller', 'Horror', 'Sci-Fi', 'Fantasy', 'Romance', 'Comedy', 'Documentary', 'Action', 'Mystery', 'Western', 'Musical'] },
  { key: 'tone', label: 'Tone', placeholder: 'Restrained, dread underneath', options: ['Restrained', 'Feverish', 'Melancholic', 'Wry', 'Operatic', 'Clinical', 'Warm', 'Bleak', 'Playful'] },
  { key: 'theme', label: 'Theme', placeholder: 'Memory as a form of debt' },
  { key: 'setting', label: 'Setting', placeholder: 'A coastal city in winter' },
  { key: 'conflict', label: 'Conflict', placeholder: 'What she wants cannot coexist with what she is responsible for' },
  { key: 'characters', label: 'Characters', placeholder: 'One per line, or describe the cast', long: true },
  { key: 'visualStyle', label: 'Visual style', placeholder: 'Long lenses, practical sources only, negative fill' },
  { key: 'timePeriod', label: 'Time period', placeholder: 'Contemporary', options: ['Contemporary', 'Near future', '1980s', '1960s', 'Post-war', 'Victorian', 'Medieval', 'Far future', 'Timeless'] },
  { key: 'audience', label: 'Audience', placeholder: 'Adult festival audience', options: ['Festival', 'Adult', 'Young adult', 'Family', 'Genre fans', 'Broadcast', 'Brand / commercial'] },
  { key: 'duration', label: 'Duration', placeholder: '3 minutes' },
  { key: 'ending', label: 'Ending', placeholder: 'She gets what she asked for and understands too late what it cost', long: true },
  { key: 'pacing', label: 'Pacing', placeholder: 'Deliberate, two accelerations', options: ['Deliberate', 'Slow burn', 'Steady', 'Propulsive', 'Frenetic', 'Episodic'] }
];

const ACTIONS = [
  { id: 'improve', label: 'Improve idea', icon: <Wand2 size={12} />, instruction: 'Sharpen this idea without changing its subject. Make the central conflict more specific and more filmable, replace abstractions with concrete images, and remove anything generic. Keep the same length and voice.' },
  { id: 'darker', label: 'Make darker', icon: <Moon size={12} />, instruction: 'Push this idea materially darker. Raise the stakes, make the cost of the central choice physical and moral, remove any unearned comfort, and add one detail that will be uncomfortable to watch.' },
  { id: 'emotional', label: 'Make emotional', icon: <Heart size={12} />, instruction: 'Deepen the emotional register. Give the protagonist a specific grief or longing, replace plot description with feeling, and make at least one moment land as intimacy rather than information.' },
  { id: 'twist', label: 'Add twist', icon: <Zap size={12} />, instruction: 'Introduce a genuine reversal that recontextualises the whole premise. It must be fair — set up by information already implied — and it must change what the audience thinks the film is about.' },
  { id: 'expand', label: 'Expand', icon: <Maximize2 size={12} />, instruction: 'Expand this idea to roughly three times its length with concrete, filmable detail: who, where, what is at stake, and what it looks like. Do not pad — every sentence must add something shootable.' },
  { id: 'shorten', label: 'Shorten', icon: <Minimize2 size={12} />, instruction: 'Cut this idea to its strongest two sentences. Keep the protagonist, the want and the obstacle. Remove everything else.' },
  { id: 'ending', label: 'Alternative ending', icon: <Shuffle size={12} />, instruction: 'Propose a different but equally earned ending. Change the outcome, not the theme. Give two options, clearly separated.' }
] as const;

export function IdeaStage() {
  const project = useProject(s => s.project);
  const idea = useProject(s => s.project?.idea) ?? EMPTY_IDEA;
  const saveIdea = useProject(s => s.saveIdea);
  const generate = useProject(s => s.generate);
  const versions = useProject(s => s.versions);
  const restore = useProject(s => s.restoreVersion);
  const setStage = useProject(s => s.setStage);
  const toast = useApp(s => s.toast);
  const demo = useDemoMode();
  const { run, busy } = useTextJob(project?.id);
  const { confirm, node } = useConfirm();
  const [history, setHistory] = React.useState<{ at: number; idea: Idea; label: string }[]>([]);
  const [working, setWorking] = React.useState<string | null>(null);

  const set = (key: keyof Idea, value: string) => saveIdea({ [key]: value } as Partial<Idea>);
  const filled = FIELDS.filter(f => String(idea[f.key] ?? '').trim()).length;

  const applyAction = async (action: (typeof ACTIONS)[number]) => {
    if (!project) return;
    if (!idea.text.trim() && filled < 3) {
      toast({ level: 'warn', title: 'Write a little first', body: 'Give the AI at least an idea or a few fields to work from.' });
      return;
    }
    setWorking(action.id);
    const snapshot = { ...idea };
    setHistory(h => [{ at: Date.now(), idea: snapshot, label: action.label }, ...h].slice(0, 12));
    const brief = FIELDS.map(f => `${f.label}: ${idea[f.key] || '(unset)'}`).join('\n');
    const res = await run({
      label: action.label,
      system: 'You are a development executive and screenwriter. You improve film ideas. Reply with ONLY the revised idea text — no preamble, no headings, no markdown.',
      prompt: `Here is a film idea in development.\n\n${brief}\n\nTASK\n${action.instruction}\n\nReturn only the revised IDEA paragraph (and, if the task asks for options, clearly separated alternatives). Do not restate the other fields.`,
      temperature: 0.9, maxTokens: 1200
    });
    setWorking(null);
    if (!res?.text) return;
    const text = res.text.trim();
    await saveIdea({ text });
    toast({ level: 'success', title: `${action.label} applied`, body: res.demo ? 'Built-in engine — review before building on it.' : 'The previous version is in the undo list below.' });
  };

  const revert = async (h: { idea: Idea; label: string }) => {
    await saveIdea(h.idea);
    toast({ level: 'info', title: `Reverted to before "${h.label}"` });
  };

  const startStory = async () => {
    if (!project) return;
    const ok = await confirm({
      title: 'Generate the story?',
      confirmLabel: 'Generate story',
      body: <>The story will be built from your idea and the fields you filled in. Your current idea is saved as a revision first, so nothing is lost.</>,
      details: [
        { label: 'Source', value: `${filled}/${FIELDS.length} fields` },
        { label: 'Project', value: project.name },
        { label: 'Model preset', value: project.settings.presetId ? 'from preset' : 'router decides' }
      ]
    });
    if (!ok) return;
    try {
      await generate('story', { idea, snapshot: true });
      setStage('story');
      toast({ level: 'success', title: 'Story generation queued', body: 'Watch progress in the queue (⌘J). The stage switches automatically when it lands.' });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <StageFrame
      icon={<Lightbulb size={15} />}
      title="Idea"
      subtitle="Seed the film. Everything downstream — story, screenplay, cast, coverage — is derived from this."
      headerRight={
        <>
          <Badge tone={filled > 6 ? 'ok' : filled > 2 ? 'accent' : 'mut'}>{filled}/{FIELDS.length} fields</Badge>
          {demo && <PrevisBadge label="STUDIO ENGINE" />}
          <Button size="sm" variant="primary" loading={busy} onClick={startStory} icon={<Sparkles size={12} />}>Generate Story</Button>
        </>
      }
      asideTitle="AI tools & history"
      aside={
        <div className="space-y-3 p-3">
          <div>
            <div className="label mb-2">Rewrite</div>
            <div className="grid grid-cols-2 gap-1.5">
              {ACTIONS.map(a => (
                <Button key={a.id} size="xs" variant="ghost" loading={working === a.id} disabled={Boolean(working) || busy}
                  onClick={() => void applyAction(a)} className="justify-start">
                  {a.icon}{a.label}
                </Button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink3">
              Each rewrite replaces the Idea field only. The previous text is kept in Session history below so you can
              step back without touching your saved revisions.
            </p>
          </div>

          {history.length > 0 && (
            <div>
              <div className="label mb-1.5 flex items-center gap-1.5"><History size={10} />Session history</div>
              <ul className="space-y-1">
                {history.map((h, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-md border border-line-soft bg-well2 px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] text-ink2">{h.label}</span>
                      <span className="block text-[9.5px] text-ink3">{new Date(h.at).toLocaleTimeString()}</span>
                    </span>
                    <Tip label="Restore this version"><button type="button" className="icon-btn h-6 w-6" onClick={() => void revert(h)}><RotateCcw size={11} /></button></Tip>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="label mb-1.5">Project revisions</div>
            {versions.length === 0 ? (
              <p className="text-[10.5px] leading-relaxed text-ink3">Revisions are created automatically before every major generation. You can restore any of them from here.</p>
            ) : (
              <ul className="space-y-1">
                {versions.slice(0, 6).map(v => (
                  <li key={v.id} className="flex items-center gap-2 rounded-md border border-line-soft bg-well2 px-2 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[10.5px] text-ink2">{v.label}</span>
                      <span className="block truncate text-[9.5px] text-ink3">{v.reason}</span>
                    </span>
                    <Tip label="Restore"><button type="button" className="icon-btn h-6 w-6" onClick={async () => { const ok = await confirm({ title: `Restore ${v.label}?`, body: <>Current state is saved as a new revision first.</>, confirmLabel: 'Restore', tone: 'danger' }); if (ok) { await restore(v.id); toast({ level: 'success', title: `Restored ${v.label}` }); } }}><Check size={11} /></button></Tip>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      }
      footer={
        <ReviewBar approved={false} next="story" nextLabel="Next: Story"
          note={idea.text.trim()
            ? <span className="flex items-center gap-1.5"><Compass size={11} className="text-accent/70" />Ready — generate the story, or keep refining the idea.</span>
            : 'Write an idea, or fill a few fields and let the AI build from them. Nothing is generated until you ask.'} />
      }>
      {node}
      <div className="mx-auto w-full max-w-[1000px] space-y-4 p-4 xl:p-6">
        <Card hover={false} className="overflow-hidden">
          <div className="border-b border-line-soft px-4 py-2.5">
            <div className="label">The idea</div>
          </div>
          <div className="p-4">
            <TextArea rows={6} value={idea.text} onChange={e => set('text', e.target.value)}
              placeholder={FIELDS[0].placeholder}
              className="text-[13px] leading-relaxed" />
            <div className="mt-2 flex items-center gap-2 text-[10.5px] text-ink3">
              <span className="tnum">{idea.text.trim().split(/\s+/).filter(Boolean).length} words</span>
              <span>·</span>
              <span>Autosaved as you type</span>
            </div>
          </div>
        </Card>

        <Card hover={false}>
          <div className="border-b border-line-soft px-4 py-2.5">
            <div className="label">Development fields</div>
          </div>
          <div className="grid gap-x-4 gap-y-3.5 p-4 sm:grid-cols-2">
            {FIELDS.filter(f => f.key !== 'text').map(f => (
              <div key={f.key} className={cx(f.long && 'sm:col-span-2')}>
                <Field label={f.label}>
                  {f.options ? (
                    <Select value={String(idea[f.key] ?? '')} onChange={v => set(f.key, v)} placeholder={f.placeholder} options={f.options} />
                  ) : f.long ? (
                    <TextArea rows={2} value={String(idea[f.key] ?? '')} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
                  ) : (
                    <TextInput value={String(idea[f.key] ?? '')} onChange={e => set(f.key, e.target.value)} placeholder={f.placeholder} />
                  )}
                </Field>
              </div>
            ))}
          </div>
        </Card>

        <Collapsible title="Project defaults applied to every generation" defaultOpen={false}>
          <div className="space-y-1">
            <MetaRow label="Type">{project?.type}</MetaRow>
            <MetaRow label="Format">{project?.settings.format} · {project?.settings.fps}fps</MetaRow>
            <MetaRow label="Target duration">{project?.settings.durationSec}s</MetaRow>
            <MetaRow label="Visual style">{project?.settings.style}</MetaRow>
            <MetaRow label="Master seed" mono>{project?.settings.seed || 'random per generation'}</MetaRow>
            <MetaRow label="Negative prompt">{project?.settings.negativePrompt || '—'}</MetaRow>
          </div>
          <Button size="xs" variant="ghost" className="mt-2" onClick={() => setStage('idea')}>Change in Settings</Button>
        </Collapsible>

        <StageNote tone="info" title="How this stage feeds the rest of the pipeline">
          Genre, tone and conflict shape the story beats. Setting and time period shape locations and the world bible.
          Visual style becomes the default image preset for every storyboard frame. Characters named here are matched
          against the screenplay during extraction so their identity tokens stay consistent all the way to video.
        </StageNote>
      </div>
    </StageFrame>
  );
}
