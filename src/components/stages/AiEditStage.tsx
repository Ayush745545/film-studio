'use client';
import * as React from 'react';
import { Wand2, Send, Loader2, Check, Ban, AlertTriangle, Sparkles, Clock, Scissors, Film, ArrowRight } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Skeleton, cx, PrevisBadge } from '@/components/ui/primitives';
import { TextArea } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useEditor } from '@/store/editor';
import { useApp, useDemoMode } from '@/store/app';
import { get, post, describeError } from '@/lib/client/api';
import { humanTime } from './GenerateBar';
import type { EditProposal, GenerationJob } from '@/types';

const COMMANDS = [
  'Make this more cinematic', 'Remove slow shots', 'Make it faster', 'Create a trailer',
  'Create a 30 second version', 'Create a YouTube Short', 'Add subtitles', 'Add music',
  'Sync cuts to beat', 'Improve pacing', 'Create social version', 'Make scene 4 darker and more suspenseful'
];

/** AI Edit: natural-language notes become reviewable timeline operations. */
export function AiEditStage() {
  const project = useProject(s => s.project);
  const timeline = useProject(s => s.timeline);
  const setTimeline = useProject(s => s.setTimeline);
  const generate = useProject(s => s.generate);
  const setStage = useProject(s => s.setStage);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const demo = useDemoMode();
  const [command, setCommand] = React.useState('');
  const [proposals, setProposals] = React.useState<(EditProposal & { applied?: boolean })[]>([]);
  const [working, setWorking] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);

  const clipCount = timeline?.tracks.reduce((a, t) => a + t.clips.length, 0) ?? 0;
  const currentJob = jobs.find(j => j.id === jobId) ?? null;

  const ask = async (cmd: string) => {
    if (!project) return;
    if (!timeline || !clipCount) {
      toast({ level: 'warn', title: 'The timeline is empty', body: 'Assemble a cut first — the AI edit works on real clips, not on an idea of them.' });
      return;
    }
    setCommand(''); setWorking(true);
    try {
      const res = await post<{ jobs: { id: string }[] }>(`/api/projects/${project.id}/generate`, { action: 'edit-plan', params: { command: cmd } });
      const id = res.jobs?.[0]?.id;
      if (!id) throw new Error('No job created');
      setJobId(id);
      const job = await poll(id);
      const out = (job.output ?? {}) as { proposal?: EditProposal };
      if (out.proposal) setProposals(p => [out.proposal!, ...p].slice(0, 12));
      else toast({ level: 'warn', title: 'The model returned no operations', body: 'Try a more specific note, e.g. "trim every shot longer than 6 seconds by 20%".' });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setWorking(false); setJobId(null); }
  };

  const applyProposal = async (p: EditProposal) => {
    if (!project) return;
    try {
      const before = timeline;
      const res = await post<{ timeline: NonNullable<typeof timeline>; applied: number }>(`/api/projects/${project.id}/edit/apply`, { proposalId: p.id, reason: `AI edit: ${p.summary}` });
      if (res.timeline) setTimeline(res.timeline);
      // mirror into the editor store so the Pro Editor picks it up immediately
      if (useEditor.getState().timeline) useEditor.getState().init(res.timeline, project.id);
      setProposals(prev => prev.map(x => x.id === p.id ? { ...x, applied: true } : x));
      toast({ level: 'success', title: `${res.applied} operation(s) applied`, body: 'Saved as a new revision — undo in the Pro Editor with ⌘Z, or restore the revision.' });
      void before;
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <StageFrame
      icon={<Wand2 size={15} />}
      title="AI Edit"
      subtitle={clipCount ? `${clipCount} clips · ${timeline?.durationSec.toFixed(1)}s — describe the note, review the diff, then apply` : 'Natural-language editing on the real timeline'}
      headerRight={
        <>
          <Badge tone="mut" className="tnum">{clipCount} clips</Badge>
          <Button size="sm" variant="ghost" onClick={() => setStage('editor')}><Scissors size={12} />Open Pro Editor</Button>
        </>
      }
      asideTitle="How this works"
      aside={
        <div className="space-y-3 p-3">
          <StageNote tone="info" title="Proposals, not surprises">
            The model sees a precise JSON description of your timeline — every clip id, start, duration, speed and
            track. It returns operations against those ids. We validate every op against the real timeline before
            showing it to you, so it cannot invent clips or reference ids that do not exist.
          </StageNote>
          <div>
            <div className="label mb-1.5">Guarantees</div>
            <ul className="space-y-1 text-[10.5px] leading-relaxed text-ink3">
              <li>· A revision is saved before every apply.</li>
              <li>· Nothing is applied without an explicit click.</li>
              <li>· Risky ops (delete, ripple) are flagged.</li>
              <li>· Undo in the editor reverses the whole proposal.</li>
              <li>· Credits are shown before expensive ops run.</li>
            </ul>
          </div>
          <div>
            <div className="label mb-1.5">Try</div>
            <div className="flex flex-wrap gap-1">
              {COMMANDS.slice(0, 8).map(c => (
                <button key={c} type="button" disabled={working} onClick={() => void ask(c)}
                  className="rounded-full border border-line bg-pop px-2 py-0.5 text-[10px] text-ink3 transition-colors hover:border-accent/35 hover:text-accent-bright disabled:opacity-40">{c}</button>
              ))}
            </div>
          </div>
          <StageNote tone="warn" title="Built-in engine">
            {demo ? 'With no text provider configured, edit plans come from the built-in rule engine — real operations, simpler reasoning. Add a model for nuanced notes.' : 'Edit plans come from your configured text model.'}
          </StageNote>
        </div>
      }
      footer={<ReviewBar next="editor" note={clipCount ? 'Applied edits land on the same timeline the Pro Editor uses.' : 'Assemble a cut first.'} />}>
      <div className="mx-auto w-full max-w-[940px] space-y-4 p-4 xl:p-6">
        <Card hover={false} className="p-4">
          <div className="label mb-2">Editor's note</div>
          <div className="flex items-end gap-2">
            <TextArea rows={3} value={command} onChange={e => setCommand(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void ask(command); }}
              placeholder={clipCount ? 'e.g. Make the opening tighter and add a slow push into every close-up…' : 'The timeline is empty — assemble a cut first.'}
              className="flex-1 text-[12.5px]" disabled={!clipCount} />
            <Button variant="primary" loading={working} disabled={!command.trim() || !clipCount} onClick={() => void ask(command)}>
              <Send size={13} />Plan edit
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {COMMANDS.map(c => (
              <button key={c} type="button" disabled={working || !clipCount} onClick={() => void ask(c)}
                className="rounded-full border border-line bg-pop px-2 py-0.5 text-[10px] text-ink3 transition-colors hover:border-accent/35 hover:text-accent-bright disabled:opacity-40">{c}</button>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-ink3">⌘↵ to send · the plan is computed against the live timeline</p>
        </Card>

        {working && (
          <Card hover={false} className="p-4">
            <div className="flex items-center gap-2.5">
              <Loader2 size={14} className="animate-spin text-accent-bright" />
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-medium text-ink">Planning the edit…</p>
                <p className="truncate text-[10.5px] text-ink3">{currentJob ? `${Math.round(currentJob.progress * 100)}% · ${currentJob.sublabel || 'reading the timeline'}` : 'reading the timeline'}</p>
              </div>
              {currentJob && <Badge tone="info" className="font-mono">{currentJob.id.slice(0, 8)}</Badge>}
            </div>
            <div className="mt-3 space-y-1.5">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-3" />)}
            </div>
          </Card>
        )}

        {!working && !proposals.length && !clipCount && (
          <EmptyState icon={<Film size={17} />} title="Nothing to edit yet"
            body="Assemble your generated shots onto the timeline, then ask for edits in plain language. You can also cut manually in the Pro Editor and come back here."
            action={<GenerateBar config={{ action: 'assemble', label: 'Assemble timeline', params: { mode: 'full', grade: 'cinematic' } }} label="Assemble timeline" />}
            secondary={<Button size="sm" onClick={() => setStage('editor')}>Open Pro Editor</Button>} />
        )}

        <div className="space-y-2.5">
          {proposals.map(p => (
            <Card key={p.id} hover={false} className={cx('overflow-hidden', p.applied && 'opacity-70')}>
              <div className="flex items-start gap-2.5 border-b border-line-soft px-3.5 py-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.08] text-accent-bright"><Sparkles size={12} /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold text-ink">{p.summary}</p>
                  <p className="mt-0.5 text-[10.5px] text-ink3">“{p.command}”</p>
                </div>
                {p.risky && <Badge tone="bad" className="gap-1 shrink-0"><AlertTriangle size={9} />risky</Badge>}
                {p.credits > 0 && <Badge tone="accent" className="shrink-0 tnum">{p.credits} cr</Badge>}
                <Badge tone="mut" className="shrink-0 tnum">{p.ops.length} ops</Badge>
              </div>
              <div className="px-3.5 py-2.5">
                {p.rationale && <p className="mb-2.5 text-[11.5px] leading-relaxed text-ink2">{p.rationale}</p>}
                <ul className="space-y-1">
                  {p.changes.slice(0, 14).map((c, i) => (
                    <li key={i} className="flex items-start gap-2 rounded-md border border-line-soft bg-well px-2 py-1.5">
                      <ArrowRight size={11} className="mt-[2px] shrink-0 text-accent/70" />
                      <span className="min-w-0 flex-1 text-[11px] text-ink2">{c.label}</span>
                      <code className="mono shrink-0 text-[9px] text-ink3">{c.path}</code>
                    </li>
                  ))}
                  {p.changes.length > 14 && <li className="px-2 py-1 text-[10.5px] text-ink3">+{p.changes.length - 14} more</li>}
                </ul>
              </div>
              <div className="flex items-center gap-2 border-t border-line-soft bg-well2 px-3.5 py-2">
                <span className="flex items-center gap-1 text-[10px] text-ink3"><Clock size={10} />{humanTime(0)}</span>
                <div className="flex-1" />
                {p.applied ? (
                  <Badge tone="ok"><Check size={9} />Applied</Badge>
                ) : (
                  <>
                    <Button size="xs" variant="ghost" onClick={() => setProposals(prev => prev.filter(x => x.id !== p.id))}><Ban size={11} />Discard</Button>
                    <Button size="xs" variant="primary" onClick={() => void applyProposal(p)}><Check size={11} />Apply {p.ops.length} change{p.ops.length === 1 ? '' : 's'}</Button>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </StageFrame>
  );
}

async function poll(id: string, timeoutMs = 150_000): Promise<GenerationJob> {
  const started = Date.now();
  for (;;) {
    const j = await get<GenerationJob>(`/api/jobs/${id}`);
    if (j.status === 'succeeded') return j;
    if (j.status === 'failed' || j.status === 'cancelled') throw new Error(j.error?.message ?? `Job ${j.status}`);
    if (Date.now() - started > timeoutMs) throw new Error('Planning took too long');
    await new Promise(r => setTimeout(r, 450));
  }
}
