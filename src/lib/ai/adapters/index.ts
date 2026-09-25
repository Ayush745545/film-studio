import type { ProviderAdapter } from '../types';
import { ProviderError } from '../types';
import { demoAdapter } from './demo';
import { openaiCompatible } from './openai-compatible';
import { anthropic } from './anthropic';
import { replicate } from './replicate';
import { fal } from './fal';
import { elevenlabs } from './elevenlabs';
import { comfyui } from './comfyui';
import { customHttp } from './custom-http';

const ADAPTERS: Record<string, ProviderAdapter> = {
  'demo': demoAdapter,
  'openai-compatible': openaiCompatible,
  'anthropic': anthropic,
  'replicate': replicate,
  'fal': fal,
  'elevenlabs': elevenlabs,
  'comfyui': comfyui,
  'custom-http': customHttp,
  // Aliases so provider rows can name their driver naturally.
  'openai': openaiCompatible,
  'ollama': openaiCompatible,
  'lmstudio': openaiCompatible,
  'local-ffmpeg': demoAdapter
};

export function canonicalDriver(driver: string): string {
  if (driver === 'openai' || driver === 'ollama' || driver === 'lmstudio') return 'openai-compatible';
  if (driver === 'local-ffmpeg') return 'demo';
  return driver;
}

export function adapterFor(driver: string): ProviderAdapter {
  const a = ADAPTERS[driver];
  if (!a) {
    throw new ProviderError(`No adapter registered for driver "${driver}"`, {
      code: 'no_adapter', retryable: false,
      suggestion: 'Add an adapter in src/lib/ai/adapters and register it here — the rest of the app is driver-agnostic.'
    });
  }
  return a;
}
export const registeredDrivers = () => Object.keys(ADAPTERS);
export { demoAdapter };
