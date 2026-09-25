import { entityRoutes } from '@/lib/api-entity';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const r = entityRoutes('voices', {
  writable: ['speaker','text','voiceId','language','emotion','speed','pitch','stability','clarity','assetId','status','take','durationSec','modelId','sceneId','characterId']
});
export const GET = r.GET; export const PATCH = r.PATCH; export const DELETE = r.DELETE;
