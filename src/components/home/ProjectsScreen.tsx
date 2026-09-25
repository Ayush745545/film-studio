'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Search, FolderOpen, Grid3x3, List, Trash2, Copy, ExternalLink, Clock, Film, MoreHorizontal } from 'lucide-react';
import { Button, Card, Badge, EmptyState, Skeleton, cx, Segmented } from '@/components/ui/primitives';
import { Popover, MenuItem, useConfirm } from '@/components/ui/overlays';
import { NewProjectModal } from './NewProjectModal';
import { get, del, post, describeError } from '@/lib/client/api';
import { useApp, useProjects } from '@/store/app';
import { PROJECT_TYPES, STAGES, STAGE_META, type Project, type ProjectType } from '@/types';

interface Row extends Project { /* list payload is the full project */ }

export function ProjectsScreen() {
  const router = useRouter();
  const toast = useApp(s => s.toast);
  const reload = useApp(s => s.reload);
  const [q, setQ] = React.useState('');
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [type, setType] = React.useState<ProjectType | ''>('');
  const [modal, setModal] = React.useState<{ open: boolean; type: ProjectType }>({ open: false, type: 'short-film' });
  const { confirm, node } = useConfirm();

  // Seed from the server-rendered payload so the list paints immediately,
  // then let React Query revalidate and handle searches.
  const hydrated = useProjects();
  const { data, isLoading } = useQuery({
    queryKey: ['projects', q],
    queryFn: () => get<{ projects: Row[] }>(`/api/projects${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    initialData: q ? undefined : { projects: hydrated as unknown as Row[] },
    placeholderData: q ? undefined : { projects: hydrated as unknown as Row[] }
  });
  const projects = data?.projects ?? (hydrated as unknown as Row[]);
  const filtered = type ? projects.filter(p => p.type === type) : projects;

  const remove = async (p: Row) => {
    const ok = await confirm({
      title: `Delete "${p.name}"?`, tone: 'danger', confirmLabel: 'Delete project', requireText: p.name,
      body: <>This removes the project, its {STAGES.length} stages of generated work, timeline, versions and every asset that belongs only to it. Generated media files are deleted from object storage. This cannot be undone.</>
    });
    if (!ok) return;
    try { await del(`/api/projects/${p.id}`); toast({ level: 'success', title: 'Project deleted' }); await reload('projects'); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  const duplicate = async (p: Row) => {
    try { const c = await post<Row>(`/api/projects/${p.id}/duplicate`, {}); toast({ level: 'success', title: 'Duplicated', body: c.name }); await reload('projects'); }
    catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="mx-auto w-full max-w-[1240px] px-6 py-8 lg:px-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[24px] font-semibold tracking-tight text-ink">Projects</h1>
            <p className="mt-1 text-[12.5px] text-ink2">{projects.length} project{projects.length === 1 ? '' : 's'} · every stage persisted, nothing lost between sessions.</p>
          </div>
          <Button variant="primary" onClick={() => setModal({ open: true, type: 'short-film' })}><Plus size={13} />New project</Button>
        </header>

        <div className="mb-5 flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink3" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, description or tag…" className="input pl-8" />
          </div>
          <select value={type} onChange={e => setType(e.target.value as ProjectType | '')} className="select w-[180px]">
            <option value="">All types</option>
            {PROJECT_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <Segmented value={view} onChange={setView} options={[{ value: 'grid', label: <Grid3x3 size={12} /> }, { value: 'list', label: <List size={12} /> }]} />
        </div>

        {isLoading && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[168px]" />)}
          </div>
        )}

        {!isLoading && !filtered.length && (
          <EmptyState icon={<FolderOpen size={17} />}
            title={q || type ? 'No projects match that filter' : 'No projects yet'}
            body={q || type ? 'Try a different search term or clear the type filter.' : 'Create your first project — an AI Short Film walks you through the full fifteen-stage pipeline, or start from New Video to edit your own footage.'}
            action={<Button variant="primary" size="sm" onClick={() => setModal({ open: true, type: 'short-film' })}><Plus size={12} />New project</Button>} />
        )}

        {view === 'grid' && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((p, i) => (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(0.02 * i, 0.2) }}>
                <Card className="group h-full overflow-hidden">
                  <button type="button" onClick={() => router.push(`/project/${p.id}`)} className="block w-full text-left">
                    <StageStrip p={p} />
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink">{p.name}</h3>
                        <Badge tone="mut" className="shrink-0 font-mono text-[9px]">r{p.rev}</Badge>
                      </div>
                      <p className="mt-1 line-clamp-2 min-h-[28px] text-[11px] leading-snug text-ink3">
                        {p.story?.logline || p.description || PROJECT_TYPES.find(t => t.id === p.type)?.blurb}
                      </p>
                      <div className="mt-2.5 flex items-center gap-2 text-[10px] text-ink3">
                        <Clock size={10} />{relative(p.updatedAt)}
                        <span className="ml-auto flex items-center gap-1"><Film size={10} />{STAGE_META[p.stage]?.label ?? p.stage}</span>
                      </div>
                    </div>
                  </button>
                  <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <Popover width={190} trigger={({ toggle }) => <button type="button" onClick={e => { e.stopPropagation(); toggle(); }} className="icon-btn h-6 w-6 bg-black/50 backdrop-blur"><MoreHorizontal size={13} /></button>}>
                      {close => (
                        <div onClick={e => e.stopPropagation()}>
                          <MenuItem icon={<ExternalLink size={13} />} label="Open project" onClick={() => { close(); router.push(`/project/${p.id}`); }} />
                          <MenuItem icon={<Film size={13} />} label="Open in editor" onClick={() => { close(); router.push(`/editor/${p.id}`); }} />
                          <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { close(); void duplicate(p); }} />
                          <div className="my-1 h-px bg-line-soft" />
                          <MenuItem tone="danger" icon={<Trash2 size={13} />} label="Delete" onClick={() => { close(); void remove(p); }} />
                        </div>
                      )}
                    </Popover>
                  </div>
                </Card>
              </motion.div>
            ))}
          </div>
        )}

        {view === 'list' && filtered.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr className="border-b border-line bg-well2 text-left">
                  {['Project', 'Type', 'Stage', 'Progress', 'Credits', 'Updated', ''].map(h => (
                    <th key={h} className="label px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => {
                  const states = (p.stageStates ?? {}) as Record<string, string>;
                  const done = Object.values(states).filter(s => s === 'ready' || s === 'approved').length;
                  return (
                    <tr key={p.id} className="cursor-pointer border-b border-line-soft/60 transition-colors last:border-0 hover:bg-white/[0.02]"
                      onClick={() => router.push(`/project/${p.id}`)}>
                      <td className="px-3 py-2">
                        <span className="block max-w-[240px] truncate font-medium text-ink">{p.name}</span>
                        <span className="block max-w-[240px] truncate text-[10.5px] text-ink3">{p.story?.logline ?? p.description ?? '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-ink2">{PROJECT_TYPES.find(t => t.id === p.type)?.label ?? p.type}</td>
                      <td className="px-3 py-2"><Badge tone="mut">{STAGE_META[p.stage]?.label ?? p.stage}</Badge></td>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2">
                          <span className="h-1 w-16 overflow-hidden rounded-full bg-card">
                            <span className="block h-full rounded-full bg-gradient-to-r from-accent-dim to-accent-bright" style={{ width: `${(done / STAGES.length) * 100}%` }} />
                          </span>
                          <span className="text-ink3 tnum">{done}/{STAGES.length}</span>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink2 tnum">{Math.round(p.creditsSpent ?? 0)}</td>
                      <td className="px-3 py-2 text-ink3">{relative(p.updatedAt)}</td>
                      <td className="px-3 py-1.5 text-right" onClick={e => e.stopPropagation()}>
                        <Popover width={180} trigger={({ toggle }) => <button type="button" onClick={toggle} className="icon-btn"><MoreHorizontal size={13} /></button>}>
                          {close => (<>
                            <MenuItem icon={<Copy size={13} />} label="Duplicate" onClick={() => { close(); void duplicate(p); }} />
                            <MenuItem tone="danger" icon={<Trash2 size={13} />} label="Delete" onClick={() => { close(); void remove(p); }} />
                          </>)}
                        </Popover>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <NewProjectModal open={modal.open} type={modal.type} onClose={() => setModal(m => ({ ...m, open: false }))} />
      {node}
    </div>
  );
}

/**
 * Project card artwork.
 *
 * Uses a real frame from the production when one exists — a storyboard plate,
 * character look or environment — and falls back to a cinematic gradient for
 * brand-new projects. The stage strip overlays the bottom edge either way.
 */
export function StageStrip({ p }: { p: { stageStates?: Record<string, string>; coverUrl?: string | null; name?: string } }) {
  const states = (p.stageStates ?? {}) as Record<string, string>;
  const [failed, setFailed] = React.useState(false);
  const cover = p.coverUrl && !failed ? p.coverUrl : null;
  return (
    <div className="relative h-[104px] overflow-hidden border-b border-line-soft bg-well">
      {cover ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cover} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}
            className="absolute inset-0 h-full w-full scale-[1.02] object-cover transition-transform duration-500 ease-cine group-hover:scale-[1.07]" />
          <div className="absolute inset-0 bg-gradient-to-t from-deep via-deep/35 to-transparent" />
        </>
      ) : (
        <>
          <div className="absolute inset-0 bg-gradient-to-br from-card via-well2 to-deep" />
          <div className="absolute inset-0 opacity-70" style={{ background: 'radial-gradient(70% 100% at 22% 0%, rgba(217,154,50,0.15), transparent 62%)' }} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="font-cine text-[15px] tracking-[0.18em] text-ink3/45 uppercase">{(p.name ?? 'untitled').slice(0, 18)}</span>
          </div>
        </>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-[3px] px-3 pb-2.5">
        {STAGES.map(s => {
          const st = states[s] ?? 'empty';
          return (
            <span key={s} title={`${STAGE_META[s].label}: ${st}`}
              className={cx('h-1 flex-1 rounded-full transition-colors',
                st === 'approved' ? 'bg-ok' : st === 'ready' ? 'bg-ok/55' : st === 'generating' ? 'animate-pulseDot bg-accent' : st === 'error' ? 'bg-bad' : cover ? 'bg-white/20' : 'bg-white/[0.07]')} />
          );
        })}
      </div>
    </div>
  );
}

export function relative(iso: string): string {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
