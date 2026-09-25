'use client';
import * as React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Sparkles, Send, Pause, Check, X, RotateCcw, ChevronRight, ChevronDown, AlertTriangle,
  Wand2, Clapperboard, Palette, Scissors, Music4, Layers, ArrowDown, Zap, Eye, Cpu, Bot
} from 'lucide-react';
import { cx, Badge, Button, PrevisBadge, Tip } from '@/components/ui/primitives';
import { useApp } from '@/store/app';
import { useDemoMode } from '@/store/boot-accessors';
import { useProject } from '@/store/project';
import { useEditor } from '@/store/editor';
import { get, post, describeError } from '@/lib/client/api';
import { STAGE_META, type GenerationJob, type TimelineOp } from '@/types';

interface Msg {
  id: string; role: 'user' | 'ai'; text: string; at: number;
  willModify?: { target: string; change: string }[];
  ops?: TimelineOp[];
  stageOps?: { entity: string; id: string | null; patch: Record<string, unknown> }[];
  credits?: number; risky?: boolean; demo?: boolean; proposalId?: string;
  applied?: boolean; discarded?: boolean;
}

/** Stage-aware starting points — the suggestions change with where you are. */
const SUGGESTIONS: Record<string, string[]> = {
  idea: ['Make the idea darker', 'Add a twist', 'Sharpen the conflict', 'What genre suits this best?'],
  story: ['Improve the pacing', 'Make act two harder', 'Give me an alternate ending', 'Is the ending earned?'],
  script: ['Rewrite the dialogue', 'Add tension to scene 2', 'Make it more cinematic', 'Trim to 60 seconds'],
  characters: ['Design a look for the lead', 'Make the antagonist more human', 'Are these voices distinct?'],
  world: ['Generate environment plates', 'Unify the colour palette', 'Make every exterior rain'],
  scenes: ['Re-plan the coverage', 'Which scenes are too long?', 'Add an insert shot to scene 3'],
  storyboard: ['Regenerate the rejected frames', 'Make the night scenes darker', 'Widen shot 2'],
  shots: ['Tighten the shot list', 'Add a slow push to every close-up', 'Which shots need more time?'],
  video: ['Generate motion for approved frames', 'Make the camera moves calmer', 'Re-render shot 4'],
  voice: ['Give the lead a warmer voice', 'Slow the delivery down', 'Which lines need another take?'],
  sound: ['Design the sound', 'Add rain to every exterior', 'Duck the music under dialogue'],
  aiedit: ['Make this more cinematic', 'Cut a 30 second version', 'Create a vertical social cut', 'Improve the pacing'],
  editor: ['Split the longest clip', 'Add captions', 'Tighten the whole cut', 'Add a dip to black at the act break'],
  color: ['Give it a teal and orange look', 'Make it colder', 'Match scene 2 to scene 1', 'Add film grain'],
  export: ['Export a master', 'Export stems', 'Make a social version', 'What is missing before delivery?']
};

const QUICK_ACTIONS: { label: string; icon: React.ReactNode; prompt: string; stage?: string }[] = [
  { label: 'Cinematic pass', icon: <Palette size={11} />, prompt: 'Make this more cinematic — grade, pacing and transitions.' },
  { label: 'Tighten cut', icon: <Scissors size={11} />, prompt: 'Tighten the pacing: trim the long holds and remove shots that carry no new information.' },
  { label: 'Trailer', icon: <Clapperboard size={11} />, prompt: 'Cut a 75 second trailer with a hook, an escalation and a stop before the title.' },
  { label: 'Social cut', icon: <Layers size={11} />, prompt: 'Make a 9:16 social version, hook first, with burned-in captions.' },
  { label: 'Add score', icon: <Music4 size={11} />, prompt: 'Add a score bed that supports the emotion of each scene and ducks under dialogue.' },
  { label: 'Readiness check', icon: <Eye size={11} />, prompt: 'What is missing before this is ready to export? Be specific and concrete.' }
];

/**
 * AI copilot.
 *
 * Reads the real project — story, cast, locations, scenes and the live timeline —
 * and answers with a *proposal*: what changes, why, and what it costs. Nothing
 * is written until you apply it, and every applied change goes through the same
 * versioned timeline-op path as a manual edit, so it is always undoable.
 */
export function Copilot() {
  const open = useApp(s => s.ui.copilot);
  const setUi = useApp(s => s.setUi);
  const toast = useApp(s => s.toast);
  const demo = useDemoMode();
  const project = useProject(s => s.project);
  const stage = useProject(s => s.stage);
  const characters = useProject(s => s.characters);
  const scenes = useProject(s => s.scenes);
  const shots = useProject(s => s.shots);
  const assets = useProject(s => s.assets);
  const timeline = useProject(s => s.timeline);

  const [msgs, setMsgs] = React.useState<Msg[]>([]);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState(0);
  const [showContext, setShowContext] = React.useState(false);
  const [atBottom, setAtBottom] = React.useState(true);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const seeded = React.useRef(false);

  const clipCount = timeline?.tracks.reduce((a, t) => a + t.clips.length, 0) ?? 0;

  /* welcome message, rebuilt when the project changes */
  React.useEffect(() => {
    if (!open || seeded.current) return;
    seeded.current = true;
    setMsgs([{
      id: 'welcome', role: 'ai', at: Date.now(), demo,
      text: project
        ? `I'm reading **${project.name}** — ${scenes.length} scenes, ${shots.length} shots, ${characters.length} characters, ${assets.length} assets and ${clipCount} clips on the timeline.\n\nTell me what to change. I'll show you the exact diff and the credit cost before anything is applied.`
        : 'Open a project and I can see its story, cast, scenes, shots and timeline. Then ask me to change something.'
    }]);
  }, [open, project, scenes.length, shots.length, characters.length, assets.length, clipCount, demo]);

  React.useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    const onScroll = () => setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  React.useEffect(() => {
    if (atBottom) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs, busy, atBottom]);

  const send = async (text: string) => {
    const command = text.trim();
    if (!command || busy) return;
    if (!project) { toast({ level: 'warn', title: 'Open a project first', body: 'The copilot works on the project you have loaded.' }); return; }
    setInput('');
    setMsgs(m => [...m, { id: `u${Date.now()}`, role: 'user', text: command, at: Date.now() }]);
    setBusy(true); setProgress(0.05);
    const ticker = setInterval(() => setProgress(p => Math.min(0.92, p + 0.03)), 900);
    try {
      const res = await post<{ jobs: { id: string }[] }>(`/api/projects/${project.id}/generate`, {
        action: 'copilot',
        params: { command, history: msgs.slice(-6).map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.text })) }
      });
      const id = res.jobs?.[0]?.id;
      if (!id) throw new Error('No job created');
      const job = await poll(id, setProgress);
      const out = (job.output ?? {}) as Record<string, any>;
      setMsgs(m => [...m, {
        id: `a${Date.now()}`, role: 'ai', at: Date.now(),
        text: String(out.reply ?? 'Here is what I would change.'),
        willModify: out.willModify ?? [], ops: out.ops ?? [], stageOps: out.stageOps ?? [],
        credits: out.credits ?? 0, risky: Boolean(out.risky), demo: Boolean(out.demo ?? job.demo),
        proposalId: (out.proposal as { id?: string } | undefined)?.id
      }]);
    } catch (err) {
      const d = describeError(err);
      setMsgs(m => [...m, { id: `e${Date.now()}`, role: 'ai', at: Date.now(), text: `I couldn't complete that — **${d.title}**${d.body ? `\n\n${d.body}` : ''}` }]);
    } finally { clearInterval(ticker); setBusy(false); setProgress(0); }
  };

  const apply = async (m: Msg) => {
    if (!project) return;
    try {
      if (m.ops?.length) {
        if (useEditor.getState().timeline) {
          useEditor.getState().apply(m.ops, { label: `Copilot: ${m.text.slice(0, 40)}` });
        } else {
          await post(`/api/projects/${project.id}/edit/apply`, { ops: m.ops, reason: `Copilot: ${m.text.slice(0, 60)}` });
          await useProject.getState().refreshTimeline();
        }
      }
      for (const so of m.stageOps ?? []) {
        if (!so.id) continue;
        const route = ({ scene: 'scenes', character: 'characters', location: 'locations', shot: 'shots' } as Record<string, string>)[so.entity];
        if (route) await fetch(`/api/${route}/${so.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(so.patch) });
      }
      await useProject.getState().refresh();
      setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, applied: true } : x));
      toast({ level: 'success', title: 'Applied', body: m.ops?.length ? `${m.ops.length} timeline operation(s). Undo with ⌘Z.` : 'Project updated and versioned.' });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  const suggestions = SUGGESTIONS[stage] ?? SUGGESTIONS.aiedit;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-[180] bg-black/45 backdrop-blur-[2px] lg:hidden"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setUi('copilot', false)} />
          <motion.aside
            className="fixed right-0 top-0 z-[181] flex h-full w-full flex-col border-l border-line bg-panel-grad shadow-pop sm:w-[430px]"
            initial={{ x: 440, opacity: 0.4 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 440, opacity: 0.4 }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}>

            {/* ── header ─────────────────────────────────── */}
            <header className="relative shrink-0 overflow-hidden border-b border-line px-3.5 py-3">
              <span className="pointer-events-none absolute inset-0 bg-vignette opacity-80" />
              <div className="relative flex items-center gap-2.5">
                <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-gradient-to-b from-accent/20 to-transparent">
                  <Sparkles size={14} className="text-accent-bright" />
                  {busy && <span className="absolute inset-0 animate-ping rounded-lg border border-accent/40" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-1.5 text-[13px] font-semibold tracking-tight text-ink">
                    AI Copilot
                    {demo && <PrevisBadge label="BUILT-IN ENGINE" />}
                  </h2>
                  <p className="truncate text-[10.5px] text-ink3">
                    {project ? `${project.name} · ${STAGE_META[stage]?.label ?? stage}` : 'No project loaded'}
                  </p>
                </div>
                <Tip label="What the copilot can see">
                  <button type="button" className="icon-btn" data-on={showContext} onClick={() => setShowContext(v => !v)}><Cpu size={14} /></button>
                </Tip>
                <Tip label="Close (Esc)">
                  <button type="button" className="icon-btn" onClick={() => setUi('copilot', false)}><X size={15} /></button>
                </Tip>
              </div>

              <AnimatePresence initial={false}>
                {showContext && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    className="relative overflow-hidden">
                    <div className="mt-2.5 grid grid-cols-3 gap-1.5">
                      {[
                        ['Scenes', scenes.length], ['Shots', shots.length], ['Cast', characters.length],
                        ['Assets', assets.length], ['Clips', clipCount], ['Runtime', `${Math.round(timeline?.durationSec ?? 0)}s`]
                      ].map(([k, v]) => (
                        <div key={String(k)} className="rounded-md border border-line-soft bg-well px-2 py-1.5 text-center">
                          <p className="text-[13px] font-semibold text-ink tnum">{v}</p>
                          <p className="text-[9px] uppercase tracking-wider text-ink3">{k}</p>
                        </div>
                      ))}
                    </div>
                    <p className="mt-2 text-[10px] leading-relaxed text-ink3">
                      The copilot receives a precise JSON description of this state — including every clip id — so it can
                      only propose operations against things that actually exist.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>
            </header>

            {/* ── messages ───────────────────────────────── */}
            <div ref={scrollRef} className="scroll-thin relative min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
              {msgs.map(m => (
                <Bubble key={m.id} msg={m} onApply={() => apply(m)}
                  onDiscard={() => setMsgs(prev => prev.map(x => x.id === m.id ? { ...x, discarded: true } : x))} />
              ))}

              {busy && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-2">
                  <div className="flex items-start gap-2.5">
                    <Avatar kind="ai" thinking />
                    <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm border border-line bg-card px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {[0, 1, 2].map(i => (
                          <motion.span key={i} className="h-1.5 w-1.5 rounded-full bg-accent-bright"
                            animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
                            transition={{ repeat: Infinity, duration: 1.05, delay: i * 0.16, ease: 'easeInOut' }} />
                        ))}
                        <span className="ml-1.5 text-[11px] text-ink2">Reading the project…</span>
                      </div>
                      <div className="mt-2 h-1 overflow-hidden rounded-full bg-well">
                        <motion.div className="h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright"
                          animate={{ width: `${Math.round(progress * 100)}%` }} transition={{ duration: 0.4 }} />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </div>

            {!atBottom && (
              <button type="button" onClick={() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })}
                className="absolute bottom-[132px] left-1/2 z-10 flex h-7 w-7 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-pop text-ink2 shadow-pop transition-colors hover:text-accent-bright"
                aria-label="Scroll to latest">
                <ArrowDown size={13} />
              </button>
            )}

            {/* ── composer ───────────────────────────────── */}
            <div className="shrink-0 border-t border-line bg-well2/60 px-3 py-2.5">
              {msgs.filter(m => m.role === 'user').length === 0 && (
                <div className="mb-2">
                  <div className="label mb-1.5 flex items-center gap-1.5"><Zap size={9} className="text-accent" />Try one of these</div>
                  <div className="flex flex-wrap gap-1">
                    {suggestions.slice(0, 4).map(s => (
                      <button key={s} type="button" disabled={busy} onClick={() => void send(s)}
                        className="rounded-full border border-line bg-well px-2.5 py-1 text-[10.5px] text-ink2 transition-colors hover:border-accent/40 hover:text-accent-bright disabled:opacity-40">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mb-2 flex gap-1 overflow-x-auto no-scrollbar">
                {QUICK_ACTIONS.map(a => (
                  <Tip key={a.label} label={a.prompt} side="top">
                    <button type="button" disabled={busy} onClick={() => void send(a.prompt)}
                      className="flex shrink-0 items-center gap-1 rounded-md border border-line bg-well px-2 py-1 text-[10px] text-ink3 transition-colors hover:border-accent/35 hover:text-accent-bright disabled:opacity-40">
                      {a.icon}{a.label}
                    </button>
                  </Tip>
                ))}
              </div>

              <div className="flex items-end gap-1.5">
                <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
                  placeholder={project ? 'Ask me to change something… (⏎ send, ⇧⏎ newline)' : 'Open a project first'}
                  className="textarea min-h-[50px] flex-1 resize-none text-[12px]" />
                <Button variant="primary" className="h-[34px] w-[34px] shrink-0 p-0" disabled={busy || !input.trim()}
                  onClick={() => void send(input)} aria-label="Send">
                  {busy ? <Pause size={14} /> : <Send size={14} />}
                </Button>
              </div>
              <p className="mt-1.5 text-[9.5px] leading-snug text-ink3">
                Proposals are never applied without your approval. Timeline changes are versioned and undoable with ⌘Z.
              </p>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ── pieces ─────────────────────────────────────────────── */
function Avatar({ kind, thinking }: { kind: 'ai' | 'user'; thinking?: boolean }) {
  if (kind === 'user') {
    return <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line bg-elevated text-[9px] font-bold text-ink2">YOU</span>;
  }
  return (
    <span className={cx('relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/30 bg-gradient-to-b from-accent/20 to-transparent', thinking && 'shadow-[0_0_14px_-3px_rgba(217,154,50,.8)]')}>
      <Sparkles size={11} className={cx('text-accent-bright', thinking && 'animate-pulseDot')} />
    </span>
  );
}

function Bubble({ msg, onApply, onDiscard }: { msg: Msg; onApply: () => void; onDiscard: () => void }) {
  const [open, setOpen] = React.useState(true);
  if (msg.role === 'user') {
    return (
      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="flex items-start justify-end gap-2.5">
        <div className="max-w-[84%] rounded-xl rounded-tr-sm border border-accent/25 bg-accent/[0.09] px-3 py-2">
          <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink">{msg.text}</p>
          <p className="mt-1 text-right text-[9px] text-ink3">{time(msg.at)}</p>
        </div>
        <Avatar kind="user" />
      </motion.div>
    );
  }
  const actionable = Boolean((msg.ops?.length || msg.stageOps?.length) && !msg.applied && !msg.discarded);
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className="flex items-start gap-2.5">
      <Avatar kind="ai" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="rounded-xl rounded-tl-sm border border-line bg-card px-3 py-2.5">
          <div className="space-y-1.5 text-[12px] leading-relaxed text-ink2">
            {msg.text.split('\n').map((line, i) => <p key={i} className="whitespace-pre-wrap">{inline(line)}</p>)}
          </div>
          <p className="mt-1.5 text-[9px] text-ink3">{time(msg.at)}</p>
        </div>

        {(msg.willModify?.length || msg.ops?.length) ? (
          <div className={cx('overflow-hidden rounded-lg border bg-well transition-opacity', msg.discarded ? 'border-line-soft opacity-45' : 'border-line-soft')}>
            <button type="button" onClick={() => setOpen(o => !o)} className="flex w-full items-center gap-1.5 border-b border-line-soft px-2.5 py-1.5 text-left">
              {open ? <ChevronDown size={11} className="text-ink3" /> : <ChevronRight size={11} className="text-ink3" />}
              <span className="label-2">Proposed changes</span>
              <span className="ml-auto flex items-center gap-1.5">
                {msg.risky && <Badge tone="bad" className="gap-1"><AlertTriangle size={8} />risky</Badge>}
                {msg.credits ? <Badge tone="accent" className="tnum">{msg.credits} cr</Badge> : <Badge tone="ok">free</Badge>}
                <Badge tone="mut" className="tnum">{msg.ops?.length ?? 0} ops</Badge>
              </span>
            </button>
            <AnimatePresence initial={false}>
              {open && (
                <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                  <ul className="divide-y divide-line-soft/60">
                    {(msg.willModify ?? []).map((w, i) => (
                      <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                        <Wand2 size={11} className="mt-[2px] shrink-0 text-accent/70" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[11px] font-medium text-ink">{w.target}</span>
                          <span className="block text-[10.5px] leading-snug text-ink3">{w.change}</span>
                        </span>
                      </li>
                    ))}
                    {!msg.willModify?.length && (msg.ops ?? []).slice(0, 12).map((op, i) => (
                      <li key={i} className="flex items-start gap-2 px-2.5 py-1.5">
                        <Wand2 size={11} className="mt-[2px] shrink-0 text-accent/70" />
                        <span className="min-w-0 flex-1 text-[11px] text-ink2">{describeOp(op)}</span>
                      </li>
                    ))}
                  </ul>
                  {!msg.discarded && (
                    <div className="flex items-center gap-1.5 border-t border-line-soft bg-well2 px-2.5 py-2">
                      {msg.demo && <PrevisBadge label="BUILT-IN ENGINE" />}
                      <div className="flex-1" />
                      {actionable ? (
                        <>
                          <Button size="xs" variant="ghost" onClick={onDiscard}><X size={11} />Discard</Button>
                          <Button size="xs" variant="primary" onClick={onApply}><Check size={11} />Apply {msg.ops?.length ? `${msg.ops.length} change${msg.ops.length === 1 ? '' : 's'}` : ''}</Button>
                        </>
                      ) : msg.applied ? <Badge tone="ok"><Check size={9} />Applied</Badge> : <Badge tone="mut">Discarded</Badge>}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}

function describeOp(op: TimelineOp): string {
  const o = op as unknown as Record<string, unknown>;
  switch (op.op) {
    case 'trimClip': return o.duration != null ? `Trim clip to ${Number(o.duration).toFixed(2)}s` : `Trim clip start to ${Number(o.start).toFixed(2)}s`;
    case 'moveClip': return `Move clip to ${Number(o.start).toFixed(2)}s`;
    case 'removeClip': return 'Remove clip';
    case 'rippleDelete': return 'Ripple delete clip (closes the gap)';
    case 'splitClip': return `Split clip at ${Number(o.at).toFixed(2)}s`;
    case 'retime': return `Retime clip to ${Number(o.speed).toFixed(2)}×`;
    case 'setGrade': return `Adjust grade — ${Object.keys((o.grade as object) ?? {}).join(', ') || 'reset'}`;
    case 'addTransition': return `Add ${String(o.kind).replace('-', ' ')} transition (${Number(o.dur).toFixed(2)}s)`;
    case 'addMarker': return `Marker at ${Number(o.t).toFixed(2)}s — ${String(o.label ?? '')}`;
    case 'addTrack': return `Add ${String(o.kind)} track`;
    case 'addClip': return `Add clip at ${Number(o.start).toFixed(2)}s`;
    case 'updateClip': return `Update clip (${Object.keys((o.patch as object) ?? {}).join(', ')})`;
    default: return String(op.op);
  }
}

function inline(line: string) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>);
}

function time(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function poll(id: string, onProgress: (p: number) => void, timeoutMs = 150_000): Promise<GenerationJob> {
  const started = Date.now();
  for (;;) {
    const j = await get<GenerationJob>(`/api/jobs/${id}`);
    if (j.status === 'succeeded') return j;
    if (j.status === 'failed' || j.status === 'cancelled') throw new Error(j.error?.message ?? `Job ${j.status}`);
    onProgress(Math.max(0.05, j.progress));
    if (Date.now() - started > timeoutMs) throw new Error('The copilot took too long to respond');
    await new Promise(r => setTimeout(r, 420));
  }
}

