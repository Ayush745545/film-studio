import { AppShell } from '@/components/shell/AppShell';
import { ProjectsScreen } from '@/components/home/ProjectsScreen';
export const dynamic = 'force-dynamic';
export default function ProjectsPage() {
  return <AppShell><ProjectsScreen /></AppShell>;
}
