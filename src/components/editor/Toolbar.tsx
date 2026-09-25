'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  MousePointer2, Scissors, Hand, MoveHorizontal, Undo2, Redo2, Magnet, Download, Save,
  ArrowLeft, Wand2, Palette, Sparkles, Layers, Clock, Check
} from 'lucide-react';
import { cx, Tip, Badge, Button } from '@/components/ui/primitives';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { timecode } from '@/lib/timeline/factory';
import type { Tool } from '@/store/editor';

const TOOLS: { id: Tool; label: string; icon: React.ReactNode; key: string }[] = [
  { id: 'select', label: 'Selection', icon: <MousePointer2 size={14} />, key: 'V' },
  { id: 'trim', label: 'Trim', icon: <MoveHorizontal size={14} />, key: 'T' },
  { id: 'razor', label: 'Razor — click a clip to split it', icon: <Scissors size={14} />, key: 'C' },
  { id: 'hand', label: 'Hand / pan', icon: <Hand size={14} />, key: 'H' }
];

export function EditorToolbar({ onExport, compact }: { onExport?: () => void; compact?: boolean }) {
  const tool = useEditor(s => s.tool);
  const setTool = useEditor(s => s.setTool);
  const snap = useEditor(s => s.snap);
  const set = useEditor(s => s.set);
  const undo = useEditor(s => s.undo);
  const redo = useEditor(s => s.redo);
  const past = useEditor(s => s.past);
  const future = useEditor(s => s.future);
  const saving = useEditor(s => s.saving);
  const dirty = useEditor(s => s.dirty);
  const tl = useEditor(s => s.timeline);
  const project = useProject(s => s.project);
  const setStage = useProject(s => s.setStage);
  const setUi = useApp(s => s.setUi);
  const router = useRouter();

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel-grad px-2 py-1.5">
      {!compact && (
        <>
          <Tip label="Back to project stages">
            <button type="button" className="icon-btn" onClick={() => router.push(`/project/${project?.id}?stage=editor`)}><ArrowLeft size={14} /></button>
          </Tip>
          <div className="mr-1 min-w-0">
            <p className="max-w-[180px] truncate text-[11.5px] font-semibold leading-tight text-ink">{project?.name ?? 'Editor'}</p>
            <p className="truncate text-[9.5px] text-ink3">{tl?.name ?? 'No sequence'} · {tl ? `${tl.width}×${tl.height} @${tl.fps}` : '—'}</p>
          </div>
          <div className="vdivider mx-1 self-stretch" />
        </>
      )}

      <div className="flex items-center gap-0.5 rounded-md border border-line bg-well p-0.5">
        {TOOLS.map(t => (
          <Tip key={t.id} label={`${t.label} (${t.key})`}>
            <button type="button" className={cx('icon-btn h-[24px] w-[24px]', tool === t.id && 'border-accent/35 bg-accent/15 text-accent-bright')}
              data-on={tool === t.id} onClick={() => setTool(t.id)} aria-label={t.label}>{t.icon}</button>
          </Tip>
        ))}
      </div>

      <div className="vdivider mx-1 self-stretch" />
      <Tip label="Undo (⌘Z)"><button type="button" className="icon-btn" disabled={!past.length} onClick={undo}><Undo2 size={14} /></button></Tip>
      <Tip label="Redo (⇧⌘Z)"><button type="button" className="icon-btn" disabled={!future.length} onClick={redo}><Redo2 size={14} /></button></Tip>
      <Tip label={snap ? 'Snapping on (N)' : 'Snapping off (N)'}>
        <button type="button" className="icon-btn" data-on={snap} onClick={() => set({ snap: !snap })}><Magnet size={14} /></button>
      </Tip>
      <Tip label="Split at playhead (S)"><button type="button" className="icon-btn" onClick={() => useEditor.getState().splitAtPlayhead()}><Scissors size={14} /></button></Tip>
      <Tip label="Add marker (M)"><button type="button" className="icon-btn" onClick={() => useEditor.getState().addMarker()}><Clock size={14} /></button></Tip>

      <div className="vdivider mx-1 self-stretch" />
      <Tip label="Save now (⌘S)">
        <button type="button" className="icon-btn" data-on={dirty} onClick={() => void useEditor.getState().flush()}>
          {saving ? <span className="animate-pulseDot"><Save size={14} /></span> : dirty ? <Save size={14} className="text-accent-bright" /> : <Check size={14} className="text-ok" />}
        </button>
      </Tip>
      <span className="mono ml-0.5 text-[10px] text-ink3">{saving ? 'saving…' : dirty ? 'unsaved' : 'saved'}</span>

      <div className="flex-1" />

      {!compact && (
        <>
          <Badge tone="mut" className="tnum">{timecode(useEditor.getState().playhead, tl?.fps ?? 24)}</Badge>
          <Tip label="AI copilot (⌘.)"><button type="button" className="icon-btn" onClick={() => setUi('copilot', true)}><Sparkles size={14} /></button></Tip>
          <Button size="sm" variant="ghost" onClick={() => setStage('aiedit')}><Wand2 size={12} />AI Edit</Button>
          <Button size="sm" variant="ghost" onClick={() => setStage('color')}><Palette size={12} />Color</Button>
          <Button size="sm" variant="ghost" onClick={() => setUi('queue', true)}><Layers size={12} />Queue</Button>
          <Button size="sm" variant="primary" onClick={onExport ?? (() => setStage('export'))}><Download size={12} />Export</Button>
        </>
      )}
    </div>
  );
}
