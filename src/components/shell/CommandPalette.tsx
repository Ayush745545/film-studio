'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Wand2, Image as ImageIcon, Video, Mic2, Music, Users, Map, Film, Clapperboard, Scissors,
  Palette, Download, Workflow, Boxes, KeyRound, Settings2, FolderOpen, Home, Sparkles,
  Search, CornerDownLeft, ArrowRight, Layers, Clock, Coins, ListChecks
} from 'lucide-react';
import { cx, Kbd } from '@/components/ui/primitives';
import { useApp, useBoot } from '@/store/app';
import { useProject } from '@/store/project';
import { useEditor } from '@/store/editor';
import { SHORTCUTS } from '@/hooks/useHotkeys';
import { STAGES, STAGE_META, type StageId } from '@/types';

interface Command {
  id: string; label: string; hint?: string; group: string; icon: React.ReactNode;
  run: () => void; keywords?: string; requires?: 'project' | 'timeline';
}

/**
 * Command palette (⌘K).
 *
 * Every meaningful action in the app is reachable by name: generation, stage
 * navigation, editor tools, settings and project commands — with fuzzy ranking
 * and recent-command memory.
 */
export function CommandPalette() {
  const open = useApp(s => s.ui.palette);
  const setUi = useApp(s => s.setUi);
  const toast = useApp(s => s.toast);
  const boot = useBoot();
  const project = useProject(s => s.project);
  const setStage = useProject(s => s.setStage);
  const generate = useProject(s => s.generate);
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [cursor, setCursor] = React.useState(0);
  const [recent, setRecent] = React.useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try { return JSON.parse(localStorage.getItem('afs.commands.recent') ?? '[]'); } catch { return []; }
  });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => { if (open) { setQ(''); setCursor(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const commands = React.useMemo<Command[]>(() => {
    const go = (path: string) => () => { setUi('palette', false); router.push(path); };
    const stage = (s: StageId) => () => { setUi('palette', false); setStage(s); };
    const gen = (action: string, label: string) => async () => {
      if (!project) { toast({ level: 'warn', title: 'Open a project first' }); return; }
      setUi('palette', false);
      try {
        await generate(action, {});
        toast({ level: 'success', title: `${label} queued`, body: 'Watch progress in the generation queue (⌘J).' });
        setUi('queue', true);
      } catch (err) { toast({ level: 'error', title: (err as Error).message }); }
    };
    const ed = (fn: () => void, label: string) => () => { setUi('palette', false); fn(); toast({ level: 'info', title: label }); };

    const list: Command[] = [
      { id: 'home', label: 'Go to Create screen', group: 'Navigate', icon: <Home size={14} />, run: go('/'), keywords: 'home create new start' },
      { id: 'projects', label: 'Open Projects', group: 'Navigate', icon: <FolderOpen size={14} />, run: go('/projects'), keywords: 'projects list all' },
      { id: 'assets', label: 'Open Asset Library', group: 'Navigate', icon: <Layers size={14} />, run: go('/assets'), keywords: 'assets library media files' },
      { id: 'models', label: 'Open Model Hub', group: 'Navigate', icon: <Boxes size={14} />, run: go('/models'), keywords: 'models providers hub registry' },
      { id: 'automation', label: 'Open Automation', group: 'Navigate', icon: <Workflow size={14} />, run: go('/automation'), keywords: 'automation workflow nodes pipeline' },
      { id: 'generate', label: 'Open AI Generator', group: 'Navigate', icon: <Wand2 size={14} />, run: go('/generate'), keywords: 'ai generator playground image video text' },
      { id: 'providers', label: 'Open API Providers', group: 'Navigate', icon: <KeyRound size={14} />, run: go('/settings/providers'), keywords: 'api keys providers secrets openai replicate fal comfyui ollama' },
      { id: 'presets', label: 'Open Model Presets', group: 'Navigate', icon: <Settings2 size={14} />, run: go('/settings/presets'), keywords: 'presets model preset cinematic' },
      { id: 'billing', label: 'Open Billing & Credits', group: 'Navigate', icon: <Coins size={14} />, run: go('/billing'), keywords: 'billing credits plan subscription invoices' },
      { id: 'settings', label: 'Open Settings', group: 'Navigate', icon: <Settings2 size={14} />, run: go('/settings/general'), keywords: 'settings preferences' },
      { id: 'queue', label: 'Open Generation Queue', group: 'Navigate', icon: <ListChecks size={14} />, run: () => { setUi('palette', false); setUi('queue', true); }, keywords: 'queue jobs progress' },
      { id: 'copilot', label: 'Ask the AI copilot', group: 'Navigate', icon: <Sparkles size={14} />, run: () => { setUi('palette', false); setUi('copilot', true); }, keywords: 'copilot assistant ai help' },
      { id: 'search', label: 'Search this project', group: 'Navigate', icon: <Search size={14} />, run: () => { setUi('palette', false); setUi('search', true); }, keywords: 'search find' },
      { id: 'shortcuts', label: 'Show keyboard shortcuts', group: 'Navigate', icon: <Clock size={14} />, run: () => { setUi('palette', false); setUi('shortcuts', true); }, keywords: 'shortcuts keys help' },
      { id: 'upgrade', label: 'Upgrade plan', group: 'Navigate', icon: <Coins size={14} />, run: () => { setUi('palette', false); setUi('upgrade', true); }, keywords: 'upgrade premium pricing plans' }
    ];

    STAGES.forEach(s => list.push({
      id: `stage-${s}`, label: `Go to ${STAGE_META[s].label}`, hint: STAGE_META[s].blurb, group: 'Stages',
      icon: <ArrowRight size={13} />, run: stage(s), requires: 'project', keywords: `stage ${s} ${STAGE_META[s].group}`
    }));

    list.push(
      { id: 'gen-story', label: 'Generate story', group: 'Generate', icon: <Sparkles size={14} />, run: () => void gen('story', 'Story generation')(), requires: 'project', keywords: 'story beats logline write' },
      { id: 'gen-script', label: 'Generate screenplay', group: 'Generate', icon: <Film size={14} />, run: () => void gen('script', 'Screenplay generation')(), requires: 'project', keywords: 'script screenplay dialogue' },
      { id: 'gen-cast', label: 'Extract characters', group: 'Generate', icon: <Users size={14} />, run: () => void gen('cast', 'Character extraction')(), requires: 'project', keywords: 'characters cast extract' },
      { id: 'gen-world', label: 'Extract locations & world', group: 'Generate', icon: <Map size={14} />, run: () => void gen('world', 'World generation')(), requires: 'project', keywords: 'locations world environment' },
      { id: 'gen-breakdown', label: 'Break script into scenes & shots', group: 'Generate', icon: <Clapperboard size={14} />, run: () => void gen('breakdown', 'Scene breakdown')(), requires: 'project', keywords: 'scenes shots breakdown coverage' },
      { id: 'gen-frames', label: 'Generate storyboard frames (all shots)', group: 'Generate', icon: <ImageIcon size={14} />, run: () => void gen('frames', 'Storyboard generation')(), requires: 'project', keywords: 'storyboard frames images' },
      { id: 'gen-videos', label: 'Generate video for all shots', group: 'Generate', icon: <Video size={14} />, run: () => void gen('videos', 'Video generation')(), requires: 'project', keywords: 'video motion shots' },
      { id: 'gen-voices', label: 'Generate dialogue audio', group: 'Generate', icon: <Mic2 size={14} />, run: () => void gen('voices', 'Voice generation')(), requires: 'project', keywords: 'voice dialogue tts' },
      { id: 'gen-sound', label: 'Design sound & generate cues', group: 'Generate', icon: <Music size={14} />, run: () => void gen('sound-design', 'Sound design')(), requires: 'project', keywords: 'sound sfx ambience score music' },
      { id: 'gen-assemble', label: 'Assemble the timeline', group: 'Generate', icon: <Scissors size={14} />, run: () => void gen('assemble', 'Assembly')(), requires: 'project', keywords: 'assemble timeline edit cut' },
      { id: 'gen-image', label: 'Generate image…', group: 'Generate', icon: <ImageIcon size={14} />, run: go('/generate?kind=image'), keywords: 'image picture frame' },
      { id: 'gen-video-free', label: 'Generate video…', group: 'Generate', icon: <Video size={14} />, run: go('/generate?kind=video'), keywords: 'video clip motion' },
      { id: 'gen-voice-free', label: 'Generate voice…', group: 'Generate', icon: <Mic2 size={14} />, run: go('/generate?kind=voice'), keywords: 'voice speech narration' }
    );

    if (project) {
      list.push(
        { id: 'editor', label: 'Open Pro Editor', group: 'Project', icon: <Scissors size={14} />, run: go(`/editor/${project.id}`), keywords: 'editor timeline nle cut' },
        { id: 'color', label: 'Open Color grading', group: 'Project', icon: <Palette size={14} />, run: stage('color'), keywords: 'color grade lut' },
        { id: 'export', label: 'Export project', group: 'Project', icon: <Download size={14} />, run: stage('export'), keywords: 'export render deliver' },
        { id: 'version', label: 'Save a version now', group: 'Project', icon: <Clock size={14} />, run: async () => { setUi('palette', false); await useProject.getState().takeSnapshot('Manual save from command palette'); toast({ level: 'success', title: 'Version saved' }); }, keywords: 'version save snapshot revision', requires: 'project' }
      );
    }

    const editorCmds: Command[] = [
      { id: 'split', label: 'Split at playhead', group: 'Editor', icon: <Scissors size={14} />, run: ed(() => useEditor.getState().splitAtPlayhead(), 'Split applied'), requires: 'timeline', keywords: 'split cut razor' },
      { id: 'delete', label: 'Delete selected clip', group: 'Editor', icon: <Scissors size={14} />, run: ed(() => useEditor.getState().deleteSelected(false), 'Clip deleted'), requires: 'timeline', keywords: 'delete remove' },
      { id: 'ripple', label: 'Ripple delete selected', group: 'Editor', icon: <Scissors size={14} />, run: ed(() => useEditor.getState().deleteSelected(true), 'Ripple delete applied'), requires: 'timeline', keywords: 'ripple delete close gap' },
      { id: 'marker', label: 'Add marker', group: 'Editor', icon: <ArrowRight size={14} />, run: ed(() => useEditor.getState().addMarker(), 'Marker added'), requires: 'timeline', keywords: 'marker' },
      { id: 'markin', label: 'Mark in', group: 'Editor', icon: <ArrowRight size={14} />, run: ed(() => useEditor.getState().markIn(), 'In point set'), requires: 'timeline', keywords: 'mark in' },
      { id: 'markout', label: 'Mark out', group: 'Editor', icon: <ArrowRight size={14} />, run: ed(() => useEditor.getState().markOut(), 'Out point set'), requires: 'timeline', keywords: 'mark out' },
      { id: 'vtrack', label: 'Add video track', group: 'Editor', icon: <Layers size={14} />, run: ed(() => useEditor.getState().addTrack('video'), 'Video track added'), requires: 'timeline', keywords: 'track video' },
      { id: 'atrack', label: 'Add audio track', group: 'Editor', icon: <Layers size={14} />, run: ed(() => useEditor.getState().addTrack('audio'), 'Audio track added'), requires: 'timeline', keywords: 'track audio' },
      { id: 'undo', label: 'Undo', group: 'Editor', icon: <Clock size={14} />, run: () => { setUi('palette', false); useEditor.getState().undo(); }, requires: 'timeline', keywords: 'undo' },
      { id: 'redo', label: 'Redo', group: 'Editor', icon: <Clock size={14} />, run: () => { setUi('palette', false); useEditor.getState().redo(); }, requires: 'timeline', keywords: 'redo' }
    ];
    list.push(...editorCmds);

    for (const s of SHORTCUTS.slice(0, 12)) {
      list.push({ id: `sc-${s.keys}`, label: s.label, hint: s.keys, group: 'Shortcuts', icon: <Clock size={13} />, run: () => { setUi('palette', false); setUi('shortcuts', true); }, keywords: `shortcut ${s.keys}` });
    }
    return list;
  }, [boot, generate, project, router, setStage, setUi, toast]);

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const usable = commands.filter(c => !c.requires || (c.requires === 'project' ? Boolean(project) : Boolean(useEditor.getState().timeline)));
    if (!needle) {
      const rec = recent.map(id => usable.find(c => c.id === id)).filter(Boolean) as Command[];
      return [...rec.slice(0, 4), ...usable.filter(c => !rec.includes(c))].slice(0, 40);
    }
    const scored = usable.map(c => {
      const hay = `${c.label} ${c.hint ?? ''} ${c.keywords ?? ''} ${c.group}`.toLowerCase();
      let s = 0;
      if (c.label.toLowerCase().startsWith(needle)) s = 100;
      else if (c.label.toLowerCase().includes(needle)) s = 70;
      else if (hay.includes(needle)) s = 40;
      else {
        // subsequence match
        let i = 0;
        for (const ch of c.label.toLowerCase()) { if (ch === needle[i]) i++; if (i === needle.length) break; }
        if (i === needle.length) s = 22;
      }
      if (recent.includes(c.id)) s += 6;
      return { c, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 24);
    return scored.map(x => x.c);
  }, [commands, q, recent, project]);

  React.useEffect(() => { setCursor(0); }, [q]);
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const run = React.useCallback((c: Command) => {
    setRecent(r => { const next = [c.id, ...r.filter(x => x !== c.id)].slice(0, 8); try { localStorage.setItem('afs.commands.recent', JSON.stringify(next)); } catch { /* storage disabled */ } return next; });
    c.run();
  }, []);

  const grouped = React.useMemo(() => {
    const out: { group: string; items: Command[] }[] = [];
    for (const c of filtered) {
      const last = out[out.length - 1];
      if (last && last.group === c.group) last.items.push(c);
      else out.push({ group: c.group, items: [c] });
    }
    return out;
  }, [filtered]);

  let idx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[250] flex items-start justify-center p-4 pt-[12vh]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <div className="modal-backdrop absolute inset-0" onClick={() => setUi('palette', false)} />
          <motion.div initial={{ opacity: 0, y: -10, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={{ duration: 0.16, ease: [0.22, 0.61, 0.36, 1] }}
            className="relative z-10 w-full max-w-[620px] overflow-hidden rounded-xl border border-line bg-well2 shadow-pop">
            <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
              <Search size={15} className="shrink-0 text-ink3" />
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(filtered.length - 1, c + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
                  else if (e.key === 'Enter') { e.preventDefault(); const c = filtered[cursor]; if (c) run(c); }
                  else if (e.key === 'Escape') setUi('palette', false);
                }}
                placeholder="Search commands… (generate image, open timeline, add character, export project)"
                className="flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink3" />
              <Kbd>esc</Kbd>
            </div>
            <div ref={listRef} className="scroll-thin max-h-[52vh] overflow-y-auto p-1.5">
              {!filtered.length && (
                <div className="px-4 py-10 text-center">
                  <p className="text-[12.5px] text-ink2">No command matches “{q}”.</p>
                  <p className="mt-1 text-[11px] text-ink3">Try “generate”, “export”, “storyboard”, “providers” or a stage name.</p>
                </div>
              )}
              {grouped.map(g => (
                <div key={g.group} className="mb-1">
                  <div className="label px-2.5 pb-1 pt-2">{g.group}</div>
                  {g.items.map(c => {
                    idx++;
                    const i = idx;
                    return (
                      <button key={c.id} type="button" data-idx={i} onMouseEnter={() => setCursor(i)} onClick={() => run(c)}
                        className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                          cursor === i ? 'bg-accent/12 text-ink' : 'text-ink2 hover:bg-white/[0.035]')}>
                        <span className={cx('shrink-0', cursor === i ? 'text-accent-bright' : 'text-ink3')}>{c.icon}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium">{c.label}</span>
                          {c.hint && <span className="block truncate text-[10.5px] text-ink3">{c.hint}</span>}
                        </span>
                        {cursor === i && <CornerDownLeft size={12} className="shrink-0 text-ink3" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-3 border-t border-line-soft bg-well2 px-4 py-2 text-[10px] text-ink3">
              <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
              <span className="flex items-center gap-1"><Kbd>↵</Kbd> run</span>
              <span className="ml-auto flex items-center gap-1.5">
                {project ? <span className="truncate">{project.name}</span> : <span>No project open</span>}
              </span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
