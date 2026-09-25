'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Users, MapPin, Film, Clapperboard, Images, MessageSquare, Wand2, FolderOpen, Loader2, ArrowRight } from 'lucide-react';
import { cx, Kbd, Badge } from '@/components/ui/primitives';
import { get } from '@/lib/client/api';
import { useApp } from '@/store/app';
import { useProject } from '@/store/project';
import type { SearchHit, StageId } from '@/types';

const KIND_META: Record<SearchHit['kind'], { label: string; icon: React.ReactNode; stage: StageId | null }> = {
  project: { label: 'Project', icon: <FolderOpen size={13} />, stage: null },
  character: { label: 'Character', icon: <Users size={13} />, stage: 'characters' },
  location: { label: 'Location', icon: <MapPin size={13} />, stage: 'world' },
  scene: { label: 'Scene', icon: <Film size={13} />, stage: 'scenes' },
  shot: { label: 'Shot', icon: <Clapperboard size={13} />, stage: 'shots' },
  asset: { label: 'Asset', icon: <Images size={13} />, stage: null },
  dialogue: { label: 'Dialogue', icon: <MessageSquare size={13} />, stage: 'voice' },
  prompt: { label: 'Prompt', icon: <Wand2 size={13} />, stage: null },
  generation: { label: 'Generation', icon: <Wand2 size={13} />, stage: null },
  clip: { label: 'Clip', icon: <Clapperboard size={13} />, stage: 'editor' },
  voice: { label: 'Voice', icon: <MessageSquare size={13} />, stage: 'voice' },
  command: { label: 'Command', icon: <ArrowRight size={13} />, stage: null }
};

/** Project-wide search: characters, scenes, shots, dialogue, prompts, assets. */
export function GlobalSearch() {
  const open = useApp(s => s.ui.search);
  const setUi = useApp(s => s.setUi);
  const project = useProject(s => s.project);
  const setStage = useProject(s => s.setStage);
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [hits, setHits] = React.useState<SearchHit[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [cursor, setCursor] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => { if (open) { setTimeout(() => inputRef.current?.focus(), 30); } else { setQ(''); setHits([]); } }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const needle = q.trim();
    if (needle.length < 2) { setHits([]); return; }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const url = project ? `/api/projects/${project.id}/search?q=${encodeURIComponent(needle)}` : `/api/search?q=${encodeURIComponent(needle)}`;
        const r = await get<{ hits: SearchHit[] }>(url, { signal: ctrl.signal });
        setHits(r.hits); setCursor(0);
      } catch { /* aborted */ } finally { setLoading(false); }
    }, 180);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open, project]);

  const openHit = (h: SearchHit) => {
    setUi('search', false);
    if (h.kind === 'project' && h.projectId) { router.push(`/project/${h.projectId}`); return; }
    if (h.kind === 'asset') { router.push('/assets'); return; }
    if (project && h.stage) { setStage(h.stage); if (project.id !== h.projectId && h.projectId) router.push(`/project/${h.projectId}?stage=${h.stage}`); }
    else if (h.projectId) router.push(`/project/${h.projectId}`);
  };

  const grouped = React.useMemo(() => {
    const out: Map<string, SearchHit[]> = new Map();
    for (const h of hits) {
      const arr = out.get(h.kind) ?? []; arr.push(h); out.set(h.kind, arr);
    }
    return [...out.entries()];
  }, [hits]);

  let idx = -1;

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[250] flex items-start justify-center p-4 pt-[10vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="modal-backdrop absolute inset-0" onClick={() => setUi('search', false)} />
          <motion.div initial={{ opacity: 0, y: -8, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="relative z-10 w-full max-w-[640px] overflow-hidden rounded-xl border border-line bg-well2 shadow-pop">
            <div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
              {loading ? <Loader2 size={15} className="animate-spin text-accent" /> : <Search size={15} className="text-ink3" />}
              <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(hits.length - 1, c + 1)); }
                  else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)); }
                  else if (e.key === 'Enter') { const h = hits[cursor]; if (h) openHit(h); }
                  else if (e.key === 'Escape') setUi('search', false);
                }}
                placeholder={project ? `Search "${project.name}" — characters, scenes, shots, dialogue, prompts…` : 'Search projects and assets…'}
                className="flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-ink3" />
              <Kbd>esc</Kbd>
            </div>
            <div className="scroll-thin max-h-[54vh] min-h-[120px] overflow-y-auto p-1.5">
              {q.trim().length < 2 && (
                <div className="px-4 py-10 text-center">
                  <p className="text-[12.5px] text-ink2">Type at least two characters.</p>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink3">
                    {project ? <>Try a character name like <Badge tone="mut" className="mx-0.5">Alex</Badge>, a location, a line of dialogue, or part of an image prompt.</>
                      : 'Search finds projects by name, description, logline and tags, plus every asset you have generated.'}
                  </p>
                </div>
              )}
              {q.trim().length >= 2 && !loading && !hits.length && (
                <div className="px-4 py-10 text-center">
                  <p className="text-[12.5px] text-ink2">No results for “{q}”.</p>
                  <p className="mt-1 text-[11px] text-ink3">Search covers characters, locations, scenes, shots, dialogue, prompts, assets and generations.</p>
                </div>
              )}
              {grouped.map(([kind, items]) => (
                <div key={kind} className="mb-1">
                  <div className="label flex items-center gap-1.5 px-2.5 pb-1 pt-2">
                    {KIND_META[kind as SearchHit['kind']]?.icon}{kind}s
                    <span className="ml-auto text-ink3/60">{items.length}</span>
                  </div>
                  {items.map(h => {
                    idx++; const i = idx;
                    return (
                      <button key={`${h.kind}-${h.id}`} type="button" data-idx={i}
                        onMouseEnter={() => setCursor(i)} onClick={() => openHit(h)}
                        className={cx('flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                          cursor === i ? 'bg-accent/12' : 'hover:bg-white/[0.035]')}>
                        <span className="min-w-0 flex-1">
                          <span className={cx('block truncate text-[12.5px]', cursor === i ? 'text-ink' : 'text-ink2')}>{h.title}</span>
                          <span className="block truncate text-[10.5px] text-ink3">{h.subtitle}</span>
                        </span>
                        {cursor === i && <ArrowRight size={12} className="shrink-0 text-accent-bright" />}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
