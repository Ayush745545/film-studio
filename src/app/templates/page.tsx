import { AppShell } from '@/components/shell/AppShell';
import { TemplatesScreen } from '@/components/home/TemplatesScreen';
export const dynamic = 'force-dynamic';
export default function TemplatesPage() {
  return <AppShell><TemplatesScreen /></AppShell>;
}
