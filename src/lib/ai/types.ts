import type { AspectRatio, Capability, DemoMotion, GenKind, Resolution } from '@/types';

export interface ImageRef {
  /** One of: object-storage key, absolute URL, or base64 data URL. */
  key?: string; url?: string; dataUrl?: string; mime?: string; name?: string;
}

export interface VoiceParams {
  voiceId: string; language: string; emotion: string;
  speed: number; pitch: number; stability: number; clarity: number;
}

export interface GenerationRequest {
  kind: GenKind;
  modelId: string;
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: AspectRatio;
  resolution?: Resolution;
  durationSec?: number;
  seed?: number;
  steps?: number;
  guidance?: number;
  motion?: string;
  camera?: string;
  count?: number;
  referenceImages?: ImageRef[];
  startFrame?: ImageRef;
  endFrame?: ImageRef;
  voice?: VoiceParams;
  audio?: { preset?: string; bpm?: number; intensity?: number; words?: string[]; loop?: boolean };
  text?: { system?: string; temperature?: number; maxTokens?: number; responseFormat?: 'text' | 'json' | 'json-schema'; schema?: unknown };
  upscale?: { factor?: 2 | 4 };
  meta?: Record<string, unknown>;
}

export interface GeneratedImage { data: Uint8Array; mime: string; seed: number; width?: number; height?: number; revisedPrompt?: string }
export interface GeneratedAudio { data: Uint8Array; mime: string; durationSec: number; label?: string; scratch?: boolean }
export interface GeneratedVideo {
  data?: Uint8Array; mime?: string; url?: string; durationSec: number;
  width?: number; height?: number;
  /** Demo Mode: a real, playable motion plate rendered client-side from generated stills. */
  motion?: DemoMotion;
}

export interface GenerationResult {
  ok: boolean;
  images?: GeneratedImage[];
  text?: string;
  json?: unknown;
  audio?: GeneratedAudio[];
  video?: GeneratedVideo[];
  usage?: { inputTokens?: number; outputTokens?: number; unit?: string; units?: number };
  providerJobId?: string;
  modelId: string;
  providerId: string;
  demo: boolean;
  error?: { message: string; code?: string; providerMessage?: string; retryable: boolean; suggestion?: string };
}

export interface ProviderEvent {
  progress?: number;
  stage?: string;
  log?: { level: 'info' | 'warn' | 'error'; msg: string };
}

export interface ProviderContext {
  apiKey: string | null;
  baseUrl: string | null;
  extra: Record<string, string>;
  jobId: string;
  signal: AbortSignal;
  /** Resolve an ImageRef to raw bytes (adapters must not touch the filesystem directly). */
  fetchRef(ref: ImageRef): Promise<{ data: Uint8Array; mime: string } | null>;
  log(level: 'info' | 'warn' | 'error', msg: string): void;
  platformKey?: string;
}

/**
 * The single contract every vendor implements. Adding a provider means adding
 * one adapter + catalog rows — no UI, queue or storage changes.
 */
export interface ProviderAdapter {
  readonly driver: string;
  capabilities(): Capability[];
  estimateCost(req: GenerationRequest, model?: { costPerUnit: number; unit: string }): { credits: number; breakdown: string };
  generate(req: GenerationRequest, ctx: ProviderContext): AsyncGenerator<ProviderEvent, GenerationResult>;
  testConnection?(ctx: ProviderContext): Promise<{ ok: boolean; message: string; detail?: string }>;
  getStatus?(providerJobId: string, ctx: ProviderContext): Promise<{ status: string; progress?: number; result?: GenerationResult }>;
  cancel?(providerJobId: string, ctx: ProviderContext): Promise<boolean>;
}

/** Thrown for user-actionable failures — surfaced with a suggestion, never a stack trace. */
export class ProviderError extends Error {
  code: string; retryable: boolean; suggestion?: string; providerMessage?: string;
  constructor(message: string, opts: { code?: string; retryable?: boolean; suggestion?: string; providerMessage?: string } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = opts.code ?? 'provider_error';
    this.retryable = opts.retryable ?? false;
    this.suggestion = opts.suggestion;
    this.providerMessage = opts.providerMessage;
  }
}

export function classifyHttpError(status: number, body: string): ProviderError {
  const snip = body.slice(0, 400).replace(/\s+/g, ' ');
  if (status === 401 || status === 403) return new ProviderError('Provider rejected the API key', { code: 'unauthorized', retryable: false, suggestion: 'Check the key in Settings → AI Providers, or switch provider.', providerMessage: snip });
  if (status === 402) return new ProviderError('Provider account has no credit', { code: 'payment_required', retryable: false, suggestion: 'Top up the provider account, or switch to another provider.', providerMessage: snip });
  if (status === 404) return new ProviderError('Model or endpoint not found at this provider', { code: 'not_found', retryable: false, suggestion: 'Verify the model id and base URL.', providerMessage: snip });
  if (status === 413) return new ProviderError('Request payload too large', { code: 'payload_too_large', retryable: false, suggestion: 'Reduce reference image size or count.', providerMessage: snip });
  if (status === 422) return new ProviderError('Provider rejected the generation parameters', { code: 'unprocessable', retryable: false, suggestion: 'Adjust prompt, resolution or duration — this model may not support them.', providerMessage: snip });
  if (status === 429) return new ProviderError('Rate limit exceeded', { code: 'rate_limited', retryable: true, suggestion: 'Retry shortly, lower concurrency, or switch provider.', providerMessage: snip });
  if (status >= 500) return new ProviderError('Provider is unavailable', { code: 'upstream', retryable: true, suggestion: 'Retry — if it persists, switch to the fallback provider.', providerMessage: snip });
  return new ProviderError(`Provider returned HTTP ${status}`, { code: `http_${status}`, retryable: status >= 500, providerMessage: snip });
}

export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}
