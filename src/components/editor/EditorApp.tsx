'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, FolderX, PanelRightClose, PanelRight, PanelLeftClose, PanelLeft } from 'lucide-react';
import { EditorToolbar } from './Toolbar';
import { MediaPanel } from './MediaPanel';
import { Preview } from './Preview';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { Button, EmptyState, cx, Tip } from '@/components/ui/primitives';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';
import { get } from '@/lib/client/api';
import type { Timeline as TL } from '@/types';

/**
 * The non-linear editor.
 *
 * Four-pane professional layout (media / preview+inspector / timeline) with a
 * draggable splitter. State lives in one store so AI edits, automation and
 * manual edits all resolve through the same undoable op path.
 */
export function EditorApp({ projectId, embedded }: { projectId: string; embedded?: boolean }) {
  const router = useRouter();
  const load = useProject(s => s.load);
  const project = useProject(s => s.project);
  const loading = useProject(s => s.loading);
  const error = useProject(s => s.error);
  const tl = useProject(s => s.timeline);
  const init = useEditor(s => s.init);
  const reset = useEditor(s => s.reset);
  const editorTl = useEditor(s => s.timeline);
  const [leftW, setLeftW] = React.useState(258);
  const [rightW, setRightW] = React.useState(308);
  const [bottomH, setBottomH] = React.useState(300);
  const [showLeft, setShowLeft] = React.useState(true);
  const [showRight, setShowRight] = React.useState(true);
  const dragging = React.useRef<null | 'left' | 'right' | 'bottom'>(null);

  React.useEffect(() => { void load(projectId); }, [projectId, load]);
  React.useEffect(() => {
    if (tl && (!editorTl || editorTl.id !== tl.id || editorTl.updatedAt !== tl.updatedAt)) init(tl, projectId);
  }, [tl, projectId, init, editorTl]);
  React.useEffect(() => () => { reset(); }, [reset]);

  // splitter drag
  React.useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      if (dragging.current === 'left') setLeftW(Math.max(190, Math.min(460, e.clientX - (document.querySelector('nav')?.getBoundingClientRect().right ?? 0))));
      if (dragging.current === 'right') setRightW(Math.max(240, Math.min(520, window.innerWidth - e.clientX)));
      if (dragging.current === 'bottom') setBottomH(Math.max(150, Math.min(620, window.innerHeight - e.clientY)));
      document.body.classList.add('grabbing');
    };
    const up = () => { dragging.current = null; document.body.classList.remove('grabbing'); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, []);

  if (loading || (!project && !error)) {
    return <div className="flex h-full items-center justify-center gap-2 text-[12px] text-ink3"><Loader2 size={14} className="animate-spin text-accent" />Loading editor…</div>;
  }
  if (error || !project) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState icon={<FolderX size={17} />} title="Editor could not open" body={error ?? 'Project not found.'}
          action={<Button size="sm" variant="primary" onClick={() => router.push('/projects')}>Back to projects</Button>} />
      </div>
    );
  }
  if (!tl) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState icon={<FolderX size={17} />} title="This project has no timeline yet"
          body="Assemble one from your generated shots, or create an empty sequence to cut your own footage."
          action={<Button size="sm" variant="primary" onClick={async () => { const r = await get<TL>(`/api/projects/${projectId}/timeline`).catch(() => null); if (r) { init(r, projectId); } else { await useProject.getState().generate('assemble', {}); } }}>Open timeline</Button>} />
      </div>
    );
  }

  const Splitter = ({ which, horizontal }: { which: 'left' | 'right' | 'bottom'; horizontal?: boolean }) => (
    <div onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); dragging.current = which; }}
      className={cx('group relative z-20 shrink-0 bg-line/60 transition-colors hover:bg-accent/60',
        horizontal ? 'h-[3px] w-full cursor-row-resize' : 'w-[3px] cursor-col-resize')}>
      <span className={cx('absolute inset-0', horizontal ? '-inset-y-1' : '-inset-x-1')} />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <EditorToolbar compact={embedded} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {showLeft && <div style={{ width: leftW }} className="min-w-0 shrink-0"><MediaPanel /></div>}
        {showLeft && <Splitter which="left" />}

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="min-w-0 flex-1 overflow-hidden" style={{ minHeight: 200 }}><Preview /></div>
            {showRight && <Splitter which="right" />}
            {showRight && <div style={{ width: rightW }} className="min-w-0 shrink-0"><Inspector /></div>}
          </div>
          <Splitter which="bottom" horizontal />
          <div style={{ height: bottomH, minHeight: 180 }} className="min-h-0 shrink-0"><Timeline /></div>
        </div>

        {/* panel toggles */}
        <div className="absolute right-2 top-[62px] z-30 flex flex-col gap-1">
          <Tip label={showLeft ? 'Hide media panel' : 'Show media panel'} side="left">
            <button type="button" className="icon-btn border border-line bg-panel/90 backdrop-blur" onClick={() => setShowLeft(v => !v)}>
              {showLeft ? <PanelLeftClose size={13} /> : <PanelLeft size={13} />}
            </button>
          </Tip>
          <Tip label={showRight ? 'Hide inspector' : 'Show inspector'} side="left">
            <button type="button" className="icon-btn border border-line bg-panel/90 backdrop-blur" onClick={() => setShowRight(v => !v)}>
              {showRight ? <PanelRightClose size={13} /> : <PanelRight size={13} />}
            </button>
          </Tip>
        </div>
      </div>
    </div>
  );
}
