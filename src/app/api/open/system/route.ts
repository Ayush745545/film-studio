export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { openApi } from '@/lib/open-api';
import { registeredDrivers } from '@/lib/ai/adapters';
import { KEY_SCOPES } from '@/lib/security/api-keys';
import { config } from '@/lib/config';

/**
 * Liveness and capability probe. The cheapest way to check that a key works
 * before building anything on top of it.
 */
export const GET = openApi(async ({ scopes, keyName }) => ({
  ok: true,
  version: '1.0.0',
  authenticatedAs: keyName,
  scopes: scopes.length ? scopes : KEY_SCOPES,
  capabilities: {
    generationKinds: ['image', 'video', 'voice', 'music', 'sfx', 'upscale', 'lipsync', 'text'],
    aspectRatios: ['16:9', '9:16', '1:1', '4:5', '4:3', '2.39:1', '21:9'],
    resolutions: ['480p', '720p', '1080p', '1440p', '4k'],
    drivers: registeredDrivers()
  },
  authMode: config.authMode
}), { scope: 'system' });
