import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('sounds', {
  writable: ['kind','name','description','prompt','startSec','durationSec','volume','loop','assetId','status','modelId','autoDetected','tags','sceneId']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
