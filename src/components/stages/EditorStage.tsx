'use client';
import * as React from 'react';
import { Scissors, Maximize2, Wand2, Download } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { EditorApp } from '@/components/editor/EditorApp';
import { useProject } from '@/store/project';
import { Button, Badge, Tip } from '@/components/ui/primitives';
import { timecode } from '@/lib/timeline/factory';
import { useEditor } from '@/store/editor';

/** Stage 13 — the full NLE, embedded in the production workflow. */
export function EditorStage() {
  const project = useProject(s => s.project);
  const loading = useProject(s => s.loading);
  const error = useProject(s => s.error);
  const router = useRouter();
  const editorTl = useEditor(s => s.timeline);
  const projectTl = useProject(s => s.timeline);
  const timeline = editorTl ?? projectTl;
  const playhead = useEditor(s => s.playhead);
  const clips = timeline?.tracks.reduce((a, t) => a + t.clips.length, 0) ?? 0;

  if (!project || loading || error) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel-grad px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-ink"><Scissors size={13} className="text-accent" />Pro Editor</span>
        <Badge tone="mut" className="tnum">{clips} clips</Badge>
        <Badge tone="mut" className="mono tnum">{timecode(playhead, timeline?.fps ?? 24)}</Badge>
        <Badge tone="mut" className="tnum">{(timeline?.durationSec ?? 0).toFixed(1)}s</Badge>
        <div className="flex-1" />
        <Tip label="AI copilot knows this timeline">
          <Button size="xs" variant="ghost" onClick={() => useProject.getState().setStage('aiedit')}><Wand2 size={11} />AI Edit</Button>
        </Tip>
        <Button size="xs" variant="ghost" onClick={() => useProject.getState().setStage('color')}>Color</Button>
        <Button size="xs" variant="ghost" onClick={() => useProject.getState().setStage('export')}><Download size={11} />Export</Button>
        <Button size="xs" variant="primary" onClick={() => router.push(`/editor/${project.id}`)}>
          <Maximize2 size={11} />Full screen editor
        </Button>
      </div>
      <div className="relative min-h-0 flex-1">
        <EditorApp projectId={project.id} embedded />
      </div>
    </div>
  );
}
