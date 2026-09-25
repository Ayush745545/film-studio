import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('shots', {
  writable: ['index','size','lens','move','angle','durationSec','description','dialogue','lighting','prompt','negativePrompt','seed','frameAssetId','videoAssetId','frameStatus','videoStatus','variations','take','notes']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
