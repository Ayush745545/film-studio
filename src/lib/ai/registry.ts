import type { AspectRatio, Capability, GenKind, Provider, ProviderDriver, Resolution } from '@/types';

/**
 * Model catalogue.
 *
 * Everything the UI can offer is data, not code: providers and models are
 * seeded into the database from this catalogue and can then be edited,
 * disabled, re-priced or extended ("Add custom model") without a deploy.
 * A new vendor only needs an adapter in src/lib/ai/adapters plus rows here.
 *
 * Credits are an internal unit: 100 credits ≈ $1.00 of provider spend.
 */

export interface ProviderSeed {
  id: string; name: string; driver: ProviderDriver; baseUrl: string | null;
  capabilities: Capability[]; docsUrl: string | null; envKeyVar: string | null;
  notes: string; priority: number; builtIn?: boolean;
}

export interface ModelSeed {
  id: string; providerId: string; name: string; driverModel: string; kind: GenKind;
  capabilities: Capability[]; quality: 1|2|3|4|5; speed: 1|2|3|4|5;
  costPerUnit: number; unit: string; features?: string[];
  ratios?: AspectRatio[]; resolutions?: Resolution[]; maxDurationSec?: number;
  contextWindow?: number; demo?: boolean; config?: Record<string, unknown>; enabled?: boolean;
}

export const PROVIDERS: ProviderSeed[] = [
  { id: 'demo', name: 'Studio Engine', driver: 'demo', baseUrl: null,
    capabilities: ['text','image','video','voice','music','sound','upscale','editing','vision'],
    docsUrl: null, envKeyVar: null, priority: 1000, builtIn: true,
    notes: 'Built-in offline engine. Renders real previsualisation media — SVG plates, synthesised WAV audio and procedural motion — so every workflow runs with zero keys and zero spend. Output is marked PREVIS so it is never mistaken for model output.' },

  { id: 'openai', name: 'OpenAI', driver: 'openai-compatible', baseUrl: 'https://api.openai.com/v1',
    capabilities: ['text','image','voice','vision','editing'], docsUrl: 'https://platform.openai.com/docs/api-reference',
    envKeyVar: 'OPENAI_API_KEY', priority: 10, notes: 'Chat/completions, gpt-image-1 and TTS. Works with any OpenAI-compatible gateway via Base URL.' },

  { id: 'openrouter', name: 'OpenRouter', driver: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1',
    capabilities: ['text','vision','editing'], docsUrl: 'https://openrouter.ai/docs',
    envKeyVar: 'OPENROUTER_API_KEY', priority: 11, notes: 'One API key for text and vision models from multiple providers. Add your OpenRouter key, then discover or register the models available to your account.' },

  { id: 'anthropic', name: 'Anthropic', driver: 'anthropic', baseUrl: 'https://api.anthropic.com',
    capabilities: ['text','vision','editing'], docsUrl: 'https://docs.anthropic.com', envKeyVar: 'ANTHROPIC_API_KEY', priority: 12,
    notes: 'Strong long-form writing for story, screenplay and edit reasoning.' },

  { id: 'replicate', name: 'Replicate', driver: 'replicate', baseUrl: 'https://api.replicate.com/v1',
    capabilities: ['image','video','upscale','lipsync'], docsUrl: 'https://replicate.com/docs', envKeyVar: 'REPLICATE_API_TOKEN', priority: 20,
    notes: 'Thousands of community image/video models behind one API, billed per second.' },

  { id: 'fal', name: 'fal.ai', driver: 'fal', baseUrl: 'https://queue.fal.run',
    capabilities: ['image','video','upscale','voice','lipsync'], docsUrl: 'https://docs.fal.ai', envKeyVar: 'FAL_KEY', priority: 22,
    notes: 'Fast hosted inference queues for FLUX, Kling, Veo, MiniMax and Real-ESRGAN.' },

  { id: 'elevenlabs', name: 'ElevenLabs', driver: 'elevenlabs', baseUrl: 'https://api.elevenlabs.io',
    capabilities: ['voice','sound','music'], docsUrl: 'https://elevenlabs.io/docs', envKeyVar: 'ELEVENLABS_API_KEY', priority: 30,
    notes: 'Dialogue voices with emotion control, sound effects generation and music.' },

  { id: 'comfyui', name: 'ComfyUI (local)', driver: 'comfyui', baseUrl: 'http://127.0.0.1:8188',
    capabilities: ['image','video','upscale'], docsUrl: 'https://docs.comfy.org', envKeyVar: 'COMFYUI_URL', priority: 40,
    notes: 'Runs your own workflow JSON against a local or hosted ComfyUI server. Node-graph agnostic: the adapter maps prompt/seed/size into your workflow template.' },

  { id: 'ollama', name: 'Ollama (local)', driver: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1',
    capabilities: ['text','vision'], docsUrl: 'https://github.com/ollama/ollama', envKeyVar: 'OLLAMA_BASE_URL', priority: 42,
    notes: 'Local models over the OpenAI-compatible endpoint. No key required.' },

  { id: 'lmstudio', name: 'LM Studio (local)', driver: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1',
    capabilities: ['text','vision'], docsUrl: 'https://lmstudio.ai/docs', envKeyVar: null, priority: 44,
    notes: 'Local OpenAI-compatible server. No key required.' },

  { id: 'custom', name: 'Custom HTTP API', driver: 'custom-http', baseUrl: null,
    capabilities: ['text','image','video','voice','music','sound','upscale'], docsUrl: null, envKeyVar: null, priority: 900,
    notes: 'Bring any REST API. Define request/response mapping in the model config — no code changes needed.' }
];

const ALL_RATIOS: AspectRatio[] = ['16:9','9:16','1:1','4:5','2.39:1','4:3','21:9'];
const ALL_RES: Resolution[] = ['480p','720p','1080p','1440p','4k'];

export const MODELS: ModelSeed[] = [
  /* ── demo (always available, zero cost, clearly labelled) ───────── */
  { id: 'demo-text', providerId: 'demo', name: 'Studio Story Engine', driverModel: 'demo/storyteller-v1', kind: 'text',
    capabilities: ['text','editing'], quality: 3, speed: 5, costPerUnit: 0, unit: 'request',
    features: ['structured-json','offline','deterministic'], contextWindow: 32000, demo: true },
  { id: 'demo-image', providerId: 'demo', name: 'Studio Plate Renderer', driverModel: 'demo/plate-v1', kind: 'image',
    capabilities: ['image'], quality: 2, speed: 5, costPerUnit: 0, unit: 'image',
    features: ['svg','deterministic','seeded'], ratios: ALL_RATIOS, resolutions: ALL_RES, demo: true },
  { id: 'demo-video', providerId: 'demo', name: 'Studio Motion Plate', driverModel: 'demo/motion-v1', kind: 'video',
    capabilities: ['video'], quality: 2, speed: 5, costPerUnit: 0, unit: 'second',
    features: ['canvas-motion','start-end-frame','offline'], ratios: ALL_RATIOS, resolutions: ALL_RES, maxDurationSec: 12, demo: true },
  { id: 'demo-voice', providerId: 'demo', name: 'Scratch Voice', driverModel: 'demo/scratch-voice-v1', kind: 'voice',
    capabilities: ['voice'], quality: 1, speed: 5, costPerUnit: 0, unit: 'line',
    features: ['timing-scratch','not-speech'], demo: true },
  { id: 'demo-music', providerId: 'demo', name: 'Score Synth', driverModel: 'demo/score-v1', kind: 'music',
    capabilities: ['music'], quality: 3, speed: 5, costPerUnit: 0, unit: 'second',
    features: ['additive-synth','mood-presets','stereo'], demo: true },
  { id: 'demo-sfx', providerId: 'demo', name: 'SFX Synth', driverModel: 'demo/sfx-v1', kind: 'sfx',
    capabilities: ['sound'], quality: 3, speed: 5, costPerUnit: 0, unit: 'cue',
    features: ['dsp','ambience','foley'], demo: true },
  { id: 'demo-upscale', providerId: 'demo', name: 'Vector Upscale', driverModel: 'demo/upscale-v1', kind: 'upscale',
    capabilities: ['upscale'], quality: 2, speed: 5, costPerUnit: 0, unit: 'image', features: ['svg-rescale'], demo: true },

  /* ── OpenAI ─────────────────────────────────────────────────────── */
  { id: 'gpt-4-1', providerId: 'openai', name: 'GPT-4.1', driverModel: 'gpt-4.1', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 5, speed: 3, costPerUnit: 1.4, unit: '1k tokens',
    features: ['json-mode','tools','vision'], contextWindow: 1000000 },
  { id: 'gpt-4o', providerId: 'openai', name: 'GPT-4o', driverModel: 'gpt-4o', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 4, speed: 4, costPerUnit: 0.9, unit: '1k tokens',
    features: ['json-mode','vision'], contextWindow: 128000 },
  { id: 'gpt-4o-mini', providerId: 'openai', name: 'GPT-4o mini', driverModel: 'gpt-4o-mini', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 3, speed: 5, costPerUnit: 0.12, unit: '1k tokens',
    features: ['json-mode','vision','cheap'], contextWindow: 128000 },
  { id: 'o3-mini', providerId: 'openai', name: 'o3-mini', driverModel: 'o3-mini', kind: 'text',
    capabilities: ['text','editing'], quality: 5, speed: 2, costPerUnit: 1.1, unit: '1k tokens',
    features: ['reasoning','json-mode'], contextWindow: 200000 },
  { id: 'gpt-image-1', providerId: 'openai', name: 'GPT Image 1', driverModel: 'gpt-image-1', kind: 'image',
    capabilities: ['image'], quality: 4, speed: 3, costPerUnit: 4.2, unit: 'image',
    features: ['reference-images','text-rendering','masking'], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'] },
  { id: 'openai-tts-hd', providerId: 'openai', name: 'OpenAI TTS HD', driverModel: 'gpt-4o-mini-tts', kind: 'voice',
    capabilities: ['voice'], quality: 4, speed: 4, costPerUnit: 1.5, unit: '1k chars',
    features: ['emotion-instructions','multi-voice'], config: { voices: ['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer','verse'] } },
  { id: 'openai-tts', providerId: 'openai', name: 'OpenAI TTS', driverModel: 'tts-1', kind: 'voice',
    capabilities: ['voice'], quality: 3, speed: 5, costPerUnit: 1.0, unit: '1k chars',
    features: ['multi-voice'], config: { voices: ['alloy','echo','fable','onyx','nova','shimmer'] } },

  { id: 'openrouter-gpt-4o-mini', providerId: 'openrouter', name: 'OpenRouter · GPT-4o mini', driverModel: 'openai/gpt-4o-mini', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 3, speed: 5, costPerUnit: 0.15, unit: '1k tokens',
    features: ['json-mode','vision','cheap'], contextWindow: 128000 },
  { id: 'openrouter-claude-sonnet', providerId: 'openrouter', name: 'OpenRouter · Claude Sonnet', driverModel: 'anthropic/claude-sonnet-4.5', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 5, speed: 4, costPerUnit: 0.7, unit: '1k tokens',
    features: ['long-form','json-mode','vision'], contextWindow: 200000 },
  { id: 'openrouter-gemini-flash', providerId: 'openrouter', name: 'OpenRouter · Gemini Flash', driverModel: 'google/gemini-2.5-flash', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 4, speed: 5, costPerUnit: 0.25, unit: '1k tokens',
    features: ['json-mode','vision','fast'], contextWindow: 1000000 },

  /* ── Anthropic ──────────────────────────────────────────────────── */
  { id: 'claude-opus-4-1', providerId: 'anthropic', name: 'Claude Opus 4.1', driverModel: 'claude-opus-4-1-20250805', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 5, speed: 2, costPerUnit: 2.2, unit: '1k tokens',
    features: ['long-form','json-mode','vision'], contextWindow: 200000 },
  { id: 'claude-sonnet-4-5', providerId: 'anthropic', name: 'Claude Sonnet 4.5', driverModel: 'claude-sonnet-4-5-20250929', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 5, speed: 4, costPerUnit: 0.7, unit: '1k tokens',
    features: ['long-form','json-mode','vision','agent'], contextWindow: 200000 },
  { id: 'claude-haiku-4-5', providerId: 'anthropic', name: 'Claude Haiku 4.5', driverModel: 'claude-haiku-4-5-20251001', kind: 'text',
    capabilities: ['text','vision','editing'], quality: 4, speed: 5, costPerUnit: 0.18, unit: '1k tokens',
    features: ['json-mode','vision','cheap','fast'], contextWindow: 200000 },

  /* ── Replicate ──────────────────────────────────────────────────── */
  { id: 'rep-flux-1-1-pro', providerId: 'replicate', name: 'FLUX 1.1 Pro', driverModel: 'black-forest-labs/flux-1.1-pro', kind: 'image',
    capabilities: ['image'], quality: 5, speed: 3, costPerUnit: 4.0, unit: 'image',
    features: ['photoreal','prompt-adherence'], ratios: ALL_RATIOS, resolutions: ['720p','1080p','1440p','4k'] },
  { id: 'rep-flux-dev', providerId: 'replicate', name: 'FLUX.1 [dev]', driverModel: 'black-forest-labs/flux-dev', kind: 'image',
    capabilities: ['image'], quality: 4, speed: 3, costPerUnit: 2.5, unit: 'image',
    features: ['img2img','controlnet'], ratios: ALL_RATIOS, resolutions: ['720p','1080p','1440p'] },
  { id: 'rep-sdxl', providerId: 'replicate', name: 'SDXL', driverModel: 'stability-ai/sdxl', kind: 'image',
    capabilities: ['image'], quality: 3, speed: 4, costPerUnit: 0.8, unit: 'image',
    features: ['img2img','cheap'], ratios: ALL_RATIOS, resolutions: ['720p','1080p'] },
  { id: 'rep-veo-3', providerId: 'replicate', name: 'Veo 3', driverModel: 'google/veo-3', kind: 'video',
    capabilities: ['video'], quality: 5, speed: 1, costPerUnit: 35, unit: 'second',
    features: ['native-audio','start-frame','prompt-to-video'], ratios: ['16:9','9:16'], resolutions: ['720p','1080p'], maxDurationSec: 8 },
  { id: 'rep-kling-2-1', providerId: 'replicate', name: 'Kling 2.1', driverModel: 'kwaivgi/kling-v2.1', kind: 'video',
    capabilities: ['video'], quality: 5, speed: 2, costPerUnit: 14, unit: 'second',
    features: ['start-frame','end-frame','camera-control','motion-brush'], ratios: ['16:9','9:16','1:1'], resolutions: ['720p','1080p'], maxDurationSec: 10 },
  { id: 'rep-hunyuan-video', providerId: 'replicate', name: 'Hunyuan Video', driverModel: 'tencent/hunyuan-video', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 2, costPerUnit: 9, unit: 'second',
    features: ['start-frame'], ratios: ['16:9','9:16'], resolutions: ['720p','1080p'], maxDurationSec: 5 },
  { id: 'rep-minimax', providerId: 'replicate', name: 'MiniMax Video-01', driverModel: 'minimax/video-01', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 2, costPerUnit: 8, unit: 'second',
    features: ['start-frame','end-frame'], ratios: ['16:9','9:16'], resolutions: ['720p'], maxDurationSec: 10 },
  { id: 'rep-wan-2-2', providerId: 'replicate', name: 'Wan 2.2', driverModel: 'wan-video/wan-2.2-i2v-a14b', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 3, costPerUnit: 6, unit: 'second',
    features: ['start-frame','end-frame','open-weights'], ratios: ['16:9','9:16'], resolutions: ['480p','720p'], maxDurationSec: 5 },
  { id: 'rep-realesrgan', providerId: 'replicate', name: 'Real-ESRGAN 4x', driverModel: 'nightmareai/real-esrgan', kind: 'upscale',
    capabilities: ['upscale'], quality: 4, speed: 4, costPerUnit: 0.5, unit: 'image', features: ['face-restore'] },
  { id: 'rep-latentsync', providerId: 'replicate', name: 'LatentSync', driverModel: 'bytedance/latentsync', kind: 'video',
    capabilities: ['lipsync'], quality: 4, speed: 2, costPerUnit: 12, unit: 'second', features: ['lipsync'] },

  /* ── fal.ai ─────────────────────────────────────────────────────── */
  { id: 'fal-flux-pro', providerId: 'fal', name: 'FLUX1.1 [pro]', driverModel: 'fal-ai/flux-pro/v1.1-ultra', kind: 'image',
    capabilities: ['image'], quality: 5, speed: 3, costPerUnit: 5.0, unit: 'image',
    features: ['photoreal','reference-images'], ratios: ALL_RATIOS, resolutions: ['720p','1080p','1440p','4k'] },
  { id: 'fal-flux-kontext', providerId: 'fal', name: 'FLUX.1 Kontext [pro]', driverModel: 'fal-ai/flux-pro/kontext', kind: 'image',
    capabilities: ['image','editing'], quality: 5, speed: 3, costPerUnit: 4.5, unit: 'image',
    features: ['character-consistency','reference-images','instruction-edit'], ratios: ALL_RATIOS, resolutions: ['720p','1080p'] },
  { id: 'fal-kling', providerId: 'fal', name: 'Kling 2.1 Standard', driverModel: 'fal-ai/kling-video/v2.1/standard', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 3, costPerUnit: 10, unit: 'second',
    features: ['start-frame','end-frame'], ratios: ['16:9','9:16'], resolutions: ['720p','1080p'], maxDurationSec: 10 },
  { id: 'fal-veo3', providerId: 'fal', name: 'Veo 3 (fast)', driverModel: 'fal-ai/veo3/fast', kind: 'video',
    capabilities: ['video'], quality: 5, speed: 2, costPerUnit: 25, unit: 'second',
    features: ['native-audio','start-frame'], ratios: ['16:9','9:16'], resolutions: ['720p','1080p'], maxDurationSec: 8 },
  { id: 'fal-minimax', providerId: 'fal', name: 'MiniMax Hailuo-02', driverModel: 'fal-ai/minimax/hailuo-02/standard/image-to-video', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 3, costPerUnit: 7, unit: 'second',
    features: ['start-frame'], ratios: ['16:9','9:16'], resolutions: ['720p','1080p'], maxDurationSec: 6 },
  { id: 'fal-wan', providerId: 'fal', name: 'Wan 2.2 i2v', driverModel: 'fal-ai/wan-i2v', kind: 'video',
    capabilities: ['video'], quality: 3, speed: 4, costPerUnit: 4, unit: 'second',
    features: ['start-frame','end-frame','cheap'], ratios: ['16:9','9:16'], resolutions: ['480p','720p'], maxDurationSec: 5 },
  { id: 'fal-esrgan', providerId: 'fal', name: 'Real-ESRGAN (fal)', driverModel: 'fal-ai/real-esrgan/v4/2x', kind: 'upscale',
    capabilities: ['upscale'], quality: 4, speed: 5, costPerUnit: 0.4, unit: 'image', features: ['2x','4x'] },
  { id: 'fal-playai-tts', providerId: 'fal', name: 'PlayAI TTS v2', driverModel: 'fal-ai/playai/tts/v2', kind: 'voice',
    capabilities: ['voice'], quality: 4, speed: 4, costPerUnit: 1.2, unit: '1k chars', features: ['emotion','multi-voice'] },

  /* ── ElevenLabs ─────────────────────────────────────────────────── */
  { id: 'el-multilingual-v2', providerId: 'elevenlabs', name: 'Eleven v3 (alpha)', driverModel: 'eleven_v3', kind: 'voice',
    capabilities: ['voice'], quality: 5, speed: 3, costPerUnit: 3.0, unit: '1k chars',
    features: ['emotion','multi-language','sfx-tags'], config: { voices: [] } },
  { id: 'el-turbo', providerId: 'elevenlabs', name: 'Eleven Turbo v2.5', driverModel: 'eleven_turbo_v2_5', kind: 'voice',
    capabilities: ['voice'], quality: 4, speed: 5, costPerUnit: 1.0, unit: '1k chars',
    features: ['low-latency','multi-language'], config: { voices: [] } },
  { id: 'el-sfx', providerId: 'elevenlabs', name: 'ElevenLabs Sound Effects', driverModel: 'sound-generation', kind: 'sfx',
    capabilities: ['sound'], quality: 5, speed: 4, costPerUnit: 2.0, unit: 'cue',
    features: ['text-to-sfx','duration-control'] },
  { id: 'el-music', providerId: 'elevenlabs', name: 'ElevenLabs Music', driverModel: 'music', kind: 'music',
    capabilities: ['music'], quality: 4, speed: 3, costPerUnit: 6.0, unit: 'track', features: ['lyrics','instrumental'] },

  /* ── ComfyUI ────────────────────────────────────────────────────── */
  { id: 'comfy-image', providerId: 'comfyui', name: 'ComfyUI Workflow (image)', driverModel: 'workflow:image', kind: 'image',
    capabilities: ['image'], quality: 5, speed: 3, costPerUnit: 0, unit: 'image',
    features: ['local','custom-workflow','controlnet'], ratios: ALL_RATIOS, resolutions: ALL_RES,
    config: { workflowJson: null, promptNode: '6', seedNode: '3', widthNode: '5', heightNode: '5', negativeNode: '7' } },
  { id: 'comfy-video', providerId: 'comfyui', name: 'ComfyUI Workflow (video)', driverModel: 'workflow:video', kind: 'video',
    capabilities: ['video'], quality: 4, speed: 2, costPerUnit: 0, unit: 'second',
    features: ['local','custom-workflow','animatediff','start-frame'], ratios: ALL_RATIOS, resolutions: ['480p','720p','1080p'], maxDurationSec: 10,
    config: { workflowJson: null, promptNode: '6', seedNode: '3', startFrameNode: '10' } },
  { id: 'comfy-upscale', providerId: 'comfyui', name: 'ComfyUI Workflow (upscale)', driverModel: 'workflow:upscale', kind: 'upscale',
    capabilities: ['upscale'], quality: 5, speed: 3, costPerUnit: 0, unit: 'image',
    features: ['local','custom-workflow'], config: { workflowJson: null, imageNode: '10', upscaleNode: '17' } },

  /* ── Local (Ollama / LM Studio) ─────────────────────────────────── */
  { id: 'ollama-llama31', providerId: 'ollama', name: 'Llama 3.1 8B (local)', driverModel: 'llama3.1:8b', kind: 'text',
    capabilities: ['text'], quality: 3, speed: 4, costPerUnit: 0, unit: 'request', features: ['local','free','json-mode'], contextWindow: 32000 },
  { id: 'ollama-qwen', providerId: 'ollama', name: 'Qwen 2.5 32B (local)', driverModel: 'qwen2.5:32b', kind: 'text',
    capabilities: ['text'], quality: 4, speed: 2, costPerUnit: 0, unit: 'request', features: ['local','free','long-form'], contextWindow: 32000 },
  { id: 'ollama-llava', providerId: 'ollama', name: 'LLaVA (local vision)', driverModel: 'llava:13b', kind: 'text',
    capabilities: ['text','vision'], quality: 3, speed: 3, costPerUnit: 0, unit: 'request', features: ['local','vision'], contextWindow: 8000 },
  { id: 'lms-local', providerId: 'lmstudio', name: 'LM Studio loaded model', driverModel: 'local-model', kind: 'text',
    capabilities: ['text','vision'], quality: 3, speed: 4, costPerUnit: 0, unit: 'request', features: ['local','free'], contextWindow: 32000 },

  /* ── Custom ─────────────────────────────────────────────────────── */
  { id: 'custom-generic', providerId: 'custom', name: 'Custom endpoint model', driverModel: 'custom', kind: 'text',
    capabilities: ['text'], quality: 3, speed: 3, costPerUnit: 0, unit: 'request',
    features: ['custom','configurable'], enabled: false,
    config: { method: 'POST', path: '/generate', bodyTemplate: '{"prompt":"{{prompt}}"}', resultPath: 'output.text' } }
];

export const IMAGE_PRESETS: { id: string; label: string; prompt: string; negative: string; steps: number; guidance: number }[] = [
  { id: 'cinematic-realism', label: 'Cinematic Realism', prompt: 'cinematic film still, shot on ARRI Alexa, anamorphic lens flare, natural volumetric lighting, photoreal, 35mm grain, shallow depth of field, colour graded teal and amber', negative: 'cartoon, illustration, 3d render, plastic skin, oversaturated, watermark, text, logo, deformed hands', steps: 32, guidance: 5.5 },
  { id: 'hollywood', label: 'Hollywood', prompt: 'big-budget Hollywood production still, dramatic key light, deep contrast, filmic halation, meticulous production design, IMAX quality', negative: 'amateur, flat lighting, low budget, watermark, text', steps: 36, guidance: 6 },
  { id: 'anime', label: 'Anime', prompt: 'high-detail anime key visual, cel shading, expressive linework, cinematic composition, studio-quality background art', negative: 'photorealistic, 3d, western cartoon, watermark, text', steps: 28, guidance: 7 },
  { id: 'stylized', label: 'Stylized', prompt: 'stylised painterly illustration, bold shapes, limited palette, graphic composition, art-directed', negative: 'photorealistic, noise, watermark, text', steps: 28, guidance: 6.5 },
  { id: 'dark-horror', label: 'Dark Horror', prompt: 'dread-filled horror still, near-black shadows, single practical light source, desaturated, unsettling negative space, 16mm grain', negative: 'bright, cheerful, saturated, watermark, text', steps: 32, guidance: 6 },
  { id: 'sci-fi', label: 'Sci-Fi', prompt: 'hard science-fiction still, believable technology, atmospheric haze, cold industrial palette, practical effects look', negative: 'fantasy, cartoon, watermark, text', steps: 32, guidance: 5.5 },
  { id: 'fantasy', label: 'Fantasy', prompt: 'epic fantasy matte painting quality, mythic scale, golden-hour god rays, rich detail, cinematic composition', negative: 'modern, photo, watermark, text', steps: 32, guidance: 6.5 },
  { id: 'documentary', label: 'Documentary', prompt: 'observational documentary still, available light, handheld realism, unposed, natural colour, 16mm texture', negative: 'studio lighting, glam, staged, watermark, text', steps: 26, guidance: 4.5 },
  { id: 'commercial', label: 'Commercial', prompt: 'premium commercial photography, crisp product lighting, immaculate surfaces, high-key, advertising polish', negative: 'grime, noise, watermark, text, clutter', steps: 30, guidance: 6 },
  { id: 'product', label: 'Product Photography', prompt: 'studio product photography, softbox reflections, seamless backdrop, macro sharpness, colour-accurate', negative: 'people, clutter, watermark, text', steps: 30, guidance: 6 },
  { id: 'portrait', label: 'Portrait', prompt: 'cinematic portrait, 85mm, shallow depth of field, soft key with rim light, authentic skin texture', negative: 'airbrushed, plastic, deformed, watermark, text', steps: 30, guidance: 5.5 },
  { id: 'architecture', label: 'Architecture', prompt: 'architectural photography, corrected verticals, natural light, geometric composition, high dynamic range', negative: 'people, distortion, watermark, text', steps: 28, guidance: 5 },
  { id: 'concept', label: 'Concept Art', prompt: 'production concept art, matte painting, value study, painterly brushwork, cinematic lighting design', negative: 'photo, 3d render, watermark, text', steps: 30, guidance: 6 }
];

export const MOTION_PRESETS = ['Subtle','Cinematic','Dynamic','Handheld','Slow','Dreamlike','Action'] as const;
export const CAMERA_PRESETS = ['Static','Dolly In','Dolly Out','Pan Left','Pan Right','Tilt Up','Tilt Down','Orbit','Crane Up','Handheld','Zoom In','Whip Pan','Truck Left','Aerial'] as const;

export { IMAGE_PRESETS as PRESETS };
export function providerById(id: string): ProviderSeed | undefined { return PROVIDERS.find(p => p.id === id); }
export function modelsForProvider(id: string): ModelSeed[] { return MODELS.filter(m => m.providerId === id); }
export function modelById(id: string): ModelSeed | undefined { return MODELS.find(m => m.id === id); }

export type { Provider };
