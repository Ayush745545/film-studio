'use client';
import * as React from 'react';
import { BookOpen, Sparkles, RefreshCw, Moon, Heart, Film, Gauge, Shuffle, Pencil, Check, X, Plus, Trash2, GripVertical } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, PrevisBadge } from '@/components/ui/primitives';
import { TextInput, TextArea } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { uid } from '@/lib/client/ids';
import type { Story, StoryAct, StoryBeat } from '@/types';

interface Mod { id: string; label: string; icon: React.ReactNode; mods: Record<string, boolean>; note?: string }
const MODS: Mod[] = [
  { id: 'rewrite', label: 'Rewrite', icon: <RefreshCw size={12} />, mods: {}, note: 'Same brief, fresh take.' },
  { id: 'darker', label: 'Darker', icon: <Moon size={12} />, mods: { darker: true } },
  { id: 'emotional', label: 'Emotional', icon: <Heart size={12} />, mods: { emotional: true } },
  { id: 'cinematic', label: 'More cinematic', icon: <Film size={12} />, mods: { cinematic: true } },
  { id: 'pacing', label: 'Improve pacing', icon: <Gauge size={12} />, mods: { pacing: true } },
  { id: 'twist', label: 'Add twist', icon: <Sparkles size={12} />, mods: { twist: true } },
  { id: 'ending', label: 'Alternate ending', icon: <Shuffle size={12} />, mods: { alternateEnding: true } }
];

export function StoryStage() {
  const story = useProject(s => s.story);
  const project = useProject(s => s.project);
  const saveStory = useProject(s => s.saveStory);
  const generate = useProject(s => s.generate);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const state = useProject(s => s.project?.stageStates?.story);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [approved, setApproved] = React.useState(false);

  const generating = jobs.some(j => j.stage === 'story' && (j.status === 'queued' || j.status === 'running'));

  const startEdit = (key: string, value: string) => { setEditing(key); setDraft(value); };
  const commit = async (path: string, value: string) => {
    setEditing(null);
    if (!story) return;
    if (path === 'title' || path === 'logline' || path === 'premise' || path === 'ending' || path === 'tone' || path === 'genre') {
      await saveStory({ [path]: value } as Partial<Story>);
    }
  };

  const patchBeat = async (ai: number, bi: number, patch: Partial<StoryBeat>) => {
    if (!story) return;
    const acts = story.acts.map((a, i) => i !== ai ? a : { ...a, beats: a.beats.map((b, j) => j !== bi ? b : { ...b, ...patch }) });
    await saveStory({ acts });
  };
  const removeBeat = async (ai: number, bi: number) => {
    if (!story) return;
    const acts = story.acts.map((a, i) => i !== ai ? a : { ...a, beats: a.beats.filter((_, j) => j !== bi) });
    await saveStory({ acts });
  };
  const addBeat = async (ai: number) => {
    if (!story) return;
    const acts = story.acts.map((a, i) => i !== ai ? a : { ...a, beats: [...a.beats, { id: uid('beat'), text: '', emotion: '', location: '' }] });
    await saveStory({ acts });
  };
  const moveBeat = async (ai: number, bi: number, dir: -1 | 1) => {
    if (!story) return;
    const acts = story.acts.map((a, i) => {
      if (i !== ai) return a;
      const beats = a.beats.slice();
      const j = bi + dir;
      if (j < 0 || j >= beats.length) return a;
      [beats[bi], beats[j]] = [beats[j], beats[bi]];
      return { ...a, beats };
    });
    await saveStory({ acts });
  };

  const regen = async (mods: Record<string, boolean>, label: string) => {
    if (!project) return;
    await takeSnapshot(`Before ${label}`);
    try {
      await generate('story', { mods, idea: project.idea, snapshot: false });
    } catch (err) { toast({ level: 'error', title: (err as Error).message }); }
  };

  const approve = async () => {
    setApproved(true);
    useProject.getState().markStage('story', 'approved');
    await takeSnapshot('Story approved');
    toast({ level: 'success', title: 'Story approved', body: 'The screenplay will be written from these beats.' });
  };

  return (
    <StageFrame
      icon={<BookOpen size={15} />}
      title="Story"
      subtitle={story ? `${story.title} · ${story.genre || project?.idea.genre || 'unspecified genre'} · ${story.acts.reduce((a, b) => a + b.beats.length, 0)} beats` : 'Three-act structure with a logline, premise and filmable beats'}
      headerRight={
        <>
          {story?.tone && <Badge tone="mut">{story.tone}</Badge>}
          <GenerateBar config={{ action: 'story', label: 'Regenerate story', params: { idea: project?.idea, mods: {} } }} modelKind="text" label="Regenerate" size="sm" />
        </>
      }
      asideTitle="AI tools"
      aside={
        <div className="space-y-3 p-3">
          <div>
            <div className="label mb-2">Rewrite this story</div>
            <div className="space-y-1">
              {MODS.map(m => (
                <button key={m.id} type="button" disabled={generating} onClick={() => void regen({ ...m.mods }, m.label)}
                  className={cx('flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[11.5px] text-ink2 transition-colors hover:border-line-soft hover:bg-white/[0.03] hover:text-ink disabled:opacity-40')}>
                  <span className="text-accent/80">{m.icon}</span>{m.label}
                  {m.note && <span className="ml-auto text-[9.5px] text-ink3">{m.note}</span>}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-ink3">
              Every rewrite snapshots the current story first, so you can restore any version from the Idea stage.
            </p>
          </div>
          <div>
            <div className="label mb-1.5">Source</div>
            <dl className="space-y-1 text-[11px]">
              <div className="flex justify-between gap-2"><dt className="text-ink3">Genre</dt><dd className="truncate text-ink2">{story?.genre || project?.idea.genre || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink3">Tone</dt><dd className="truncate text-ink2">{story?.tone || project?.idea.tone || '—'}</dd></div>
              <div className="flex justify-between gap-2"><dt className="text-ink3">Target</dt><dd className="truncate text-ink2">{project?.settings.durationSec}s</dd></div>
            </dl>
          </div>
          {story?.themes?.length ? (
            <div>
              <div className="label mb-1.5">Themes</div>
              <div className="flex flex-wrap gap-1">{story.themes.map(t => <Badge key={t} tone="accent">{t}</Badge>)}</div>
            </div>
          ) : null}
        </div>
      }
      footer={
        story ? (
          <ReviewBar approved={approved} onApprove={approve} onRegenerate={() => void regen({}, 'regeneration')} onEdit={() => startEdit('premise', story.premise)}
            next="script" note="Approving locks this structure as the source for the screenplay. You can still regenerate afterwards." />
        ) : undefined
      }>
      <div className="mx-auto w-full max-w-[900px] p-4 xl:p-6">
        {!story && generating && (
          <div className="space-y-3">
            <Skeleton className="h-8 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-24 w-full" />
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        )}

        {!story && !generating && (
          <EmptyState icon={<BookOpen size={17} />} title="No story yet"
            body={<>Generate a three-act structure from your idea. You'll get a title, logline, premise and nine filmable beats — all editable, with rewrites for darker, more emotional, better paced or an alternate ending.</>}
            action={<GenerateBar config={{ action: 'story', label: 'Generate story', params: { idea: project?.idea } }} modelKind="text" label="Generate story" />} />
        )}

        {story && (
          <div className="space-y-5">
            {/* title */}
            <div>
              {editing === 'title' ? (
                <div className="flex items-center gap-2">
                  <TextInput autoFocus value={draft} onChange={e => setDraft(e.target.value)} className="text-[24px] font-semibold"
                    onKeyDown={e => { if (e.key === 'Enter') void commit('title', draft); if (e.key === 'Escape') setEditing(null); }} />
                  <Tip label="Save"><button type="button" className="icon-btn" onClick={() => void commit('title', draft)}><Check size={13} /></button></Tip>
                  <Tip label="Cancel"><button type="button" className="icon-btn" onClick={() => setEditing(null)}><X size={13} /></button></Tip>
                </div>
              ) : (
                <h1 className="group flex cursor-text items-center gap-2 font-cine text-[28px] font-semibold leading-tight tracking-tight text-ink" onClick={() => startEdit('title', story.title)}>
                  {story.title}
                  <Pencil size={12} className="opacity-0 transition-opacity group-hover:opacity-60" />
                </h1>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {story.genre && <Badge tone="accent">{story.genre}</Badge>}
                {story.tone && <Badge tone="mut">{story.tone}</Badge>}
                {state === 'ready' && <Badge tone="info">new — not yet approved</Badge>}
              </div>
            </div>

            {/* logline */}
            <Card hover={false} className="p-4">
              <div className="label mb-2">Logline</div>
              {editing === 'logline' ? (
                <TextArea autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit('logline', draft)} className="text-[13.5px]" />
              ) : (
                <p className="cursor-text font-cine text-[15px] leading-relaxed text-ink" onClick={() => startEdit('logline', story.logline)}>
                  {story.logline || <span className="text-ink3">No logline — click to write one.</span>}
                </p>
              )}
            </Card>

            {/* premise */}
            <Card hover={false} className="p-4">
              <div className="label mb-2">Premise</div>
              {editing === 'premise' ? (
                <TextArea autoFocus rows={6} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit('premise', draft)} className="text-[12.5px] leading-relaxed" />
              ) : (
                <p className="cursor-text whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink2" onClick={() => startEdit('premise', story.premise)}>
                  {story.premise || <span className="text-ink3">No premise — click to write one.</span>}
                </p>
              )}
            </Card>

            {/* acts */}
            <div className="space-y-3">
              {story.acts.map((act: StoryAct, ai) => (
                <Card key={act.id} hover={false} className="overflow-hidden">
                  <div className="flex items-center gap-2 border-b border-line-soft bg-well2 px-4 py-2">
                    <span className="font-mono text-[11px] font-bold tracking-[0.16em] text-accent-bright">{act.name}</span>
                    <span className="text-[10.5px] text-ink3">{act.beats.length} beats</span>
                    <div className="flex-1" />
                    <Tip label="Add beat"><button type="button" className="icon-btn h-6 w-6" onClick={() => void addBeat(ai)}><Plus size={12} /></button></Tip>
                  </div>
                  <ul className="divide-y divide-line-soft/60">
                    {act.beats.map((b, bi) => (
                      <li key={b.id} className="group flex items-start gap-2.5 px-4 py-2.5 transition-colors hover:bg-white/[0.015]">
                        <span className="mt-1 flex flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                          <button type="button" className="text-ink3 hover:text-ink disabled:opacity-30" disabled={bi === 0} onClick={() => void moveBeat(ai, bi, -1)} aria-label="Move up"><GripVertical size={11} className="rotate-90" /></button>
                          <button type="button" className="text-ink3 hover:text-ink disabled:opacity-30" disabled={bi === act.beats.length - 1} onClick={() => void moveBeat(ai, bi, 1)} aria-label="Move down"><GripVertical size={11} className="rotate-90" /></button>
                        </span>
                        <span className="mt-[3px] font-mono text-[10px] text-ink3 tnum">{String(bi + 1).padStart(2, '0')}</span>
                        <div className="min-w-0 flex-1">
                          {editing === `beat-${ai}-${bi}` ? (
                            <TextArea autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)}
                              onBlur={async () => { setEditing(null); await patchBeat(ai, bi, { text: draft }); }} className="text-[12.5px]" />
                          ) : (
                            <p className="cursor-text text-[12.5px] leading-relaxed text-ink2 hover:text-ink" onClick={() => startEdit(`beat-${ai}-${bi}`, b.text)}>
                              {b.text || <span className="text-ink3 italic">Empty beat — click to write</span>}
                            </p>
                          )}
                          {(b.emotion || b.location) && (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink3">
                              {b.emotion && <Badge tone="mut">{b.emotion}</Badge>}
                              {b.location && <span className="flex items-center gap-1">📍 {b.location}</span>}
                            </div>
                          )}
                        </div>
                        <button type="button" className="icon-btn h-6 w-6 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 hover:text-bad"
                          onClick={() => void removeBeat(ai, bi)} aria-label="Delete beat"><Trash2 size={11} /></button>
                      </li>
                    ))}
                    {!act.beats.length && <li className="px-4 py-4 text-center text-[11.5px] text-ink3">No beats in this act.</li>}
                  </ul>
                </Card>
              ))}
            </div>

            {/* ending */}
            <Card hover={false} className="p-4">
              <div className="label mb-2">Ending</div>
              {editing === 'ending' ? (
                <TextArea autoFocus rows={3} value={draft} onChange={e => setDraft(e.target.value)} onBlur={() => void commit('ending', draft)} className="text-[12.5px]" />
              ) : (
                <p className="cursor-text text-[12.5px] leading-relaxed text-ink2" onClick={() => startEdit('ending', story.ending)}>
                  {story.ending || <span className="text-ink3">No ending written.</span>}
                </p>
              )}
            </Card>

            <StageNote tone="info" title="Beats become scenes">
              The scene breakdown reads these beats plus the screenplay slug lines. Beat locations seed the location
              extraction, and beat emotions drive shot coverage — tense beats get handheld close-ups, tender beats get
              slow pushes. Everything stays editable afterwards.
            </StageNote>
          </div>
        )}
      </div>
    </StageFrame>
  );
}
