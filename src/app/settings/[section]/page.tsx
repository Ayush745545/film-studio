import { AppShell } from '@/components/shell/AppShell';
import { SettingsScreen } from '@/components/system/SettingsScreen';
export const dynamic = 'force-dynamic';
export default async function SettingsPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <AppShell><SettingsScreen section={section} /></AppShell>;
}
