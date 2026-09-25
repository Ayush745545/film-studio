import { api } from '@/lib/api';
import { listAssets, storageUsage } from '@/lib/assets';
import type { AssetKind } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = api(async ({ user, query }) => {
  const projectId = query().get('projectId');
  const kinds = query().get('kinds')?.split(',').filter(Boolean) as AssetKind[] | undefined;
  const q = query().get('q') ?? undefined;
  const scope = query().get('scope') ?? 'project';
  const assets = await listAssets(user.id, { projectId: scope === 'all' ? undefined : (projectId ?? undefined), kinds, q, take: 800 });
  return { assets, usage: await storageUsage(user.id) };
});
