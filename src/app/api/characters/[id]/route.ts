import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('characters', {
  writable: ['name','role','age','description','personality','wardrobe','physical','voiceProfile','arc','identityPrompt','locked','approved','referenceAssetId','lookAssetId','looks','color','scenes','token']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
