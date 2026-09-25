import { EditorApp } from '@/components/editor/EditorApp';
export const dynamic = 'force-dynamic';
export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="h-full w-full"><EditorApp projectId={id} /></div>;
}
