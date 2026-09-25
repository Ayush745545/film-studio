import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('locations', {
  writable: ['name','description','architecture','timeOfDay','lighting','weather','palette','props','identityPrompt','locked','approved','referenceAssetIds','assetId','scenes','token']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
