'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, FolderX } from 'lucide-react';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { Button, EmptyState } from '@/components/ui/primitives';
import { IdeaStage } from '@/components/stages/IdeaStage';
import { StoryStage } from '@/components/stages/StoryStage';
import { ScriptStage } from '@/components/stages/ScriptStage';
import { CharactersStage } from '@/components/stages/CharactersStage';
import { WorldStage } from '@/components/stages/WorldStage';
import { ScenesStage } from '@/components/stages/ScenesStage';
import { StoryboardStage } from '@/components/stages/StoryboardStage';
import { ShotsStage } from '@/components/stages/ShotsStage';
import { VideoStage } from '@/components/stages/VideoStage';
import { VoiceStage } from '@/components/stages/VoiceStage';
import { SoundStage } from '@/components/stages/SoundStage';
import { AiEditStage } from '@/components/stages/AiEditStage';
import { EditorStage } from '@/components/stages/EditorStage';
import { ColorStage } from '@/components/stages/ColorStage';
import { ExportStage } from '@/components/stages/ExportStage';

const VIEW: Record<string, React.ComponentType> = {
  idea: IdeaStage, story: StoryStage, script: ScriptStage, characters: CharactersStage,
  world: WorldStage, scenes: ScenesStage, storyboard: StoryboardStage, shots: ShotsStage,
  video: VideoStage, voice: VoiceStage, sound: SoundStage, aiedit: AiEditStage,
  editor: EditorStage, color: ColorStage, export: ExportStage
};

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  // One selector per value: destructuring the whole store re-renders on every
  // unrelated state change and defeats the shallow-compare default.
  const load = useProject(s => s.load);
  const unload = useProject(s => s.unload);
  const loading = useProject(s => s.loading);
  const error = useProject(s => s.error);
  const project = useProject(s => s.project);
  const stage = useProject(s => s.stage);
  const booting = useApp(s => s.booting);

  const Stage = VIEW[stage] ?? IdeaStage;

  React.useEffect(() => {
    const sp = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
    void load(projectId, (sp?.get('stage') as never) ?? undefined);
    return () => { unload(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  if (booting || loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <Loader2 size={18} className="animate-spin text-accent" />
        <p className="text-[12px] text-ink3">Loading project workspace…</p>
      </div>
    );
  }
  if (error || !project) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <EmptyState icon={<FolderX size={17} />} title="This project could not be opened"
          body={<>{error ?? 'It may have been deleted, or it belongs to another profile.'}<br /><span className="text-ink3">Nothing you generated is lost if the project still exists — check the Projects list.</span></>}
          action={<Button variant="primary" size="sm" onClick={() => router.push('/projects')}>Back to projects</Button>} />
      </div>
    );
  }

  return (
    <div key={stage} className="h-full min-h-0">
      <Stage key={stage} />
    </div>
  );
}
