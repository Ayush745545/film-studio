import { AppShell } from '@/components/shell/AppShell';
import { StageNav } from '@/components/shell/StageNav';
import { ProjectWorkspace } from '@/components/project/ProjectWorkspace';
export const dynamic = 'force-dynamic';
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  return <ProjectRoute params={params} />;
}
async function ProjectRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <AppShell stageNav={<StageNav />}>
      <ProjectWorkspace projectId={id} />
    </AppShell>
  );
}
