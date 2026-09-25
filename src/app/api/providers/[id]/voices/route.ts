import { api, notFound } from '@/lib/api';
import { getDb } from '@/lib/db';
import { resolveCredential } from '@/lib/ai/credentials';
import { http } from '@/lib/ai/adapters/http';
import { DEFAULT_VOICES } from '@/lib/ai/adapters/elevenlabs';
import type { Provider } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Voice catalogue for the Voice stage — live where the provider supports it. */
export const GET = api(async ({ user, params }) => {
  const db = await getDb();
  const provider = await db.repo('providers').findUnique(params.id) as unknown as Provider | null;
  if (!provider) throw notFound('Provider not found');
  if (provider.id === 'elevenlabs') {
    const cred = await resolveCredential(provider, user.id);
    if (cred.apiKey) {
      try {
        const r = await http(`${(cred.baseUrl || 'https://api.elevenlabs.io').replace(/\/$/, '')}/v1/voices`, { headers: { 'xi-api-key': cred.apiKey }, timeoutMs: 15_000 });
        if (r.status < 400 && Array.isArray(r.body?.voices)) {
          return { voices: r.body.voices.map((v: any) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels ?? {} })), source: 'live' };
        }
      } catch { /* fall through to defaults */ }
    }
    return { voices: DEFAULT_VOICES, source: 'defaults' };
  }
  if (provider.driver === 'openai-compatible') {
    const cred = await resolveCredential(provider, user.id);
    const voices = ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'].map(id => ({ id, name: id, category: 'built-in' }));
    return { voices, source: cred.apiKey ? 'provider-default' : 'provider-default', baseUrl: cred.baseUrl };
  }
  return { voices: DEFAULT_VOICES, source: 'fallback' };
});
