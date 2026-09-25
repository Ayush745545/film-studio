import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('scenes', {
  writable: ['index','heading','intExt','locationName','timeOfDay','locationId','durationSec','characterIds','emotion','lighting','props','dialogue','action','shotIds','colorPalette','music','approved']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
