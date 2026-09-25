/* ═══════════════════════════════════════════════════════════════
   AI FILM STUDIO — domain types
   ═══════════════════════════════════════════════════════════════ */

export type ID = string;

/* ── production stages ───────────────────────────────────────── */
export const STAGES = [
  'idea', 'story', 'script', 'characters', 'world', 'scenes', 'storyboard', 'shots',
  'video', 'voice', 'sound', 'aiedit', 'editor', 'color', 'export'
] as const;
export type StageId = (typeof STAGES)[number];

export const STAGE_META: Record<StageId, { label: string; short: string; group: string; blurb: string }> = {
  idea:       { label: 'Idea',        short: 'Idea',   group: 'Develop',  blurb: 'Seed the film: genre, tone, theme, conflict.' },
  story:      { label: 'Story',       short: 'Story',  group: 'Develop',  blurb: 'Logline, premise and a three-act beat structure.' },
  script:     { label: 'Script',      short: 'Script', group: 'Develop',  blurb: 'Formatted screenplay with scenes and dialogue.' },
  characters: { label: 'Characters',  short: 'Cast',   group: 'Design',   blurb: 'Persistent identities, looks and voice profiles.' },
  world:      { label: 'World',       short: 'World',  group: 'Design',   blurb: 'Locations, architecture, lighting, palettes.' },
  scenes:     { label: 'Scenes',      short: 'Scenes', group: 'Design',   blurb: 'Production breakdown from the screenplay.' },
  storyboard: { label: 'Storyboard',  short: 'Board',  group: 'Generate', blurb: 'Visual frames per shot — approve or regenerate.' },
  shots:      { label: 'Shots',       short: 'Shots',  group: 'Generate', blurb: 'Camera, lens, movement and duration per shot.' },
  video:      { label: 'Video',       short: 'Video',  group: 'Generate', blurb: 'Generate motion from approved frames.' },
  voice:      { label: 'Voice',       short: 'Voice',  group: 'Audio',    blurb: 'Dialogue performance per character.' },
  sound:      { label: 'Sound',       short: 'Sound',  group: 'Audio',    blurb: 'SFX, ambience, foley and score.' },
  aiedit:     { label: 'AI Edit',     short: 'AI Edit',group: 'Finish',   blurb: 'Natural-language edits proposed on the timeline.' },
  editor:     { label: 'Pro Editor',  short: 'Editor', group: 'Finish',   blurb: 'Full non-linear editor: tracks, keys, effects.' },
  color:      { label: 'Color',       short: 'Color',  group: 'Finish',   blurb: 'Grade with wheels, curves, LUTs and HSL.' },
  export:     { label: 'Export',      short: 'Export', group: 'Finish',   blurb: 'Render deliverables, stems and project bundles.' }
};

export type StageState = 'empty' | 'pending' | 'generating' | 'ready' | 'approved' | 'error';

/* ── project ─────────────────────────────────────────────────── */
export type ProjectType =
  | 'new-video' | 'short-film' | 'feature-film' | 'drama' | 'series' | 'music-video'
  | 'commercial' | 'documentary' | 'trailer' | 'youtube' | 'social-short' | 'explainer'
  | 'animation' | 'custom';

export const PROJECT_TYPES: { id: ProjectType; label: string; blurb: string }[] = [
  { id: 'new-video',    label: 'New Video',      blurb: 'Professional editor, your footage' },
  { id: 'short-film',   label: 'AI Short Film',  blurb: 'Idea → story → script → film' },
  { id: 'feature-film', label: 'AI Feature Film',blurb: 'Long-form multi-act production' },
  { id: 'drama',        label: 'AI Drama',       blurb: 'Characters, continuity, episodes' },
  { id: 'series',       label: 'AI Series',      blurb: 'Episodic arcs across a season' },
  { id: 'music-video',  label: 'AI Music Video', blurb: 'Music → scenes → shots → edit' },
  { id: 'commercial',   label: 'AI Commercial',  blurb: 'Product → concept → storyboard → ad' },
  { id: 'documentary',  label: 'Documentary',    blurb: 'Research → script → interview → edit' },
  { id: 'trailer',      label: 'Trailer',        blurb: 'High-impact cut of existing material' },
  { id: 'youtube',      label: 'YouTube Video',  blurb: 'Long-form creator format' },
  { id: 'social-short', label: 'Social Short',   blurb: 'Vertical, fast, hook-first' },
  { id: 'explainer',    label: 'Explainer',      blurb: 'Concept-driven motion graphics' },
  { id: 'animation',    label: 'Animation',      blurb: 'Stylized animated production' },
  { id: 'custom',       label: 'Custom',         blurb: 'Blank production workspace' }
];

export type AspectRatio = '16:9' | '9:16' | '1:1' | '4:5' | '2.39:1' | '4:3' | '21:9';
export type Resolution = '480p' | '720p' | '1080p' | '1440p' | '4k';
export type Fps = 24 | 25 | 30 | 50 | 60;

export const ASPECT_DIMS: Record<AspectRatio, { w: number; h: number }> = {
  '16:9': { w: 16, h: 9 }, '9:16': { w: 9, h: 16 }, '1:1': { w: 1, h: 1 },
  '4:5': { w: 4, h: 5 }, '2.39:1': { w: 2.39, h: 1 }, '4:3': { w: 4, h: 3 }, '21:9': { w: 21, h: 9 }
};
export const RES_DIMS: Record<Resolution, number> = { '480p': 480, '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 };

export interface ProjectSettings {
  type: ProjectType;
  format: AspectRatio;
  durationSec: number;
  style: string;
  presetId: ID | null;
  fps: Fps;
  resolution: Resolution;
  language: string;
  seed: number;
  negativePrompt: string;
  motionStyle: string;
  autoApprove: boolean;
}

export interface Idea {
  text: string;
  genre: string;
  tone: string;
  theme: string;
  setting: string;
  conflict: string;
  characters: string;
  visualStyle: string;
  timePeriod: string;
  audience: string;
  duration: string;
  ending: string;
  pacing: string;
}
export const EMPTY_IDEA: Idea = {
  text: '', genre: '', tone: '', theme: '', setting: '', conflict: '', characters: '',
  visualStyle: '', timePeriod: '', audience: '', duration: '', ending: '', pacing: ''
};

export interface StoryBeat { id: ID; text: string; emotion?: string; location?: string }
export interface StoryAct { id: ID; name: string; beats: StoryBeat[] }
export interface Story {
  id: ID; title: string; logline: string; premise: string;
  acts: StoryAct[]; themes: string[]; ending: string;
  tone: string; genre: string;
}

/* ── screenplay ──────────────────────────────────────────────── */
export type ScriptElementType =
  | 'scene-heading' | 'action' | 'character' | 'dialogue' | 'parenthetical'
  | 'transition' | 'camera' | 'shot' | 'note';

export interface ScriptElement {
  id: ID; type: ScriptElementType; text: string;
  sceneId?: ID; characterId?: ID;
  meta?: { intExt?: 'INT.' | 'EXT.' | 'INT./EXT.'; location?: string; time?: string };
}
export interface Screenplay {
  id: ID; title: string; author: string; draft: number;
  elements: ScriptElement[]; logline: string;
  fadeIn?: string; fadeOut?: string;
}

/* ── characters & world ──────────────────────────────────────── */
export interface CharacterLook {
  id: ID; assetId: ID | null; prompt: string; seed: number;
  status: 'pending' | 'generating' | 'ready' | 'approved' | 'rejected';
  createdAt: string; notes?: string;
}
export interface Character {
  id: ID; projectId: ID; token: string;           // character_alex_01
  name: string; role: string; age: string;
  description: string; personality: string; wardrobe: string;
  physical: string; voiceProfile: string; arc: string;
  identityPrompt: string;                          // auto-injected into every prompt
  locked: boolean; approved: boolean;
  referenceAssetId: ID | null; lookAssetId: ID | null;
  looks: CharacterLook[]; color: string;
  scenes: ID[];
}
export interface Location {
  id: ID; projectId: ID; token: string;
  name: string; description: string; architecture: string;
  timeOfDay: string; lighting: string; weather: string;
  palette: string[]; props: string[];
  identityPrompt: string; locked: boolean; approved: boolean;
  referenceAssetIds: ID[]; assetId: ID | null;
  scenes: ID[];
}
export interface WorldBible {
  id: ID; projectId: ID; era: string; geography: string; rules: string;
  moodBoard: string; colorScript: { scene: string; palette: string[] }[];
}

/* ── scenes & shots ──────────────────────────────────────────── */
export type ShotSize = 'Extreme Wide' | 'Wide' | 'Full' | 'Medium Wide' | 'Medium' | 'Medium Close' | 'Close-up' | 'Extreme Close-up' | 'Over Shoulder' | 'POV' | 'Insert' | 'Two Shot';
export type CameraMove = 'Static' | 'Pan' | 'Tilt' | 'Dolly' | 'Dolly In' | 'Dolly Out' | 'Truck' | 'Crane' | 'Handheld' | 'Steadicam' | 'Slow Push' | 'Pull Back' | 'Whip Pan' | 'Orbit' | 'Zoom' | 'Rack Focus' | 'Aerial';
export const LENSES = ['14mm','18mm','24mm','28mm','35mm','50mm','85mm','105mm','135mm','200mm','Macro','Anamorphic 40mm','Anamorphic 75mm'] as const;

export interface Shot {
  id: ID; projectId: ID; sceneId: ID; index: number;
  size: ShotSize; lens: string; move: CameraMove; durationSec: number;
  angle: string; description: string; dialogue: string;
  lighting: string; prompt: string; negativePrompt: string;
  seed: number; frameAssetId: ID | null; videoAssetId: ID | null;
  frameStatus: 'none' | 'queued' | 'generating' | 'ready' | 'approved' | 'rejected' | 'failed';
  videoStatus: 'none' | 'queued' | 'generating' | 'ready' | 'approved' | 'rejected' | 'failed';
  variations: ID[]; take: number; notes: string;
}
export interface Scene {
  id: ID; projectId: ID; index: number;
  heading: string; intExt: string; locationName: string; timeOfDay: string;
  locationId: ID | null; durationSec: number;
  characterIds: ID[]; emotion: string; lighting: string;
  props: string[]; dialogue: string; action: string;
  shotIds: ID[]; elementIds: ID[];
  colorPalette: string[]; music: string; approved: boolean;
}

/* ── assets ──────────────────────────────────────────────────── */
export type AssetKind = 'image' | 'video' | 'audio' | 'voice' | 'music' | 'sfx' | 'character' | 'location' | 'storyboard' | 'export' | 'document' | 'lut' | 'project';
export interface Asset {
  id: ID; projectId: ID | null; userId: ID;
  name: string; kind: AssetKind; mimeType: string;
  storageKey: string; url: string; thumbnailUrl: string | null;
  bytes: number; width?: number; height?: number; durationSec?: number;
  modelId: ID | null; providerId: ID | null; generationId: ID | null;
  prompt: string; negativePrompt: string; seed: number;
  version: number; tags: string[]; meta: Record<string, unknown>;
  demo: boolean; status: 'ready' | 'processing' | 'failed';
  createdAt: string; updatedAt: string;
  refIds: { characters?: ID[]; locations?: ID[]; shots?: ID[]; scenes?: ID[] };
}

/* ── generations / queue ─────────────────────────────────────── */
export type GenKind =
  | 'text' | 'image' | 'video' | 'voice' | 'music' | 'sfx' | 'upscale' | 'lipsync'
  | 'assembly' | 'export' | 'analysis'
  | 'story' | 'script' | 'cast' | 'world' | 'breakdown' | 'sound-design' | 'dialogue'
  | 'edit-plan' | 'copilot' | 'stems' | 'bundle';
export type GenStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'paused' | 'review';
export interface GenerationJob {
  id: ID; projectId: ID | null; userId: ID;
  kind: GenKind; label: string; sublabel: string;
  status: GenStatus; progress: number;
  modelId: ID | null; providerId: ID | null; presetId: ID | null;
  input: Record<string, unknown>; output: Record<string, unknown>;
  assetIds: ID[]; error: { message: string; code?: string; providerMessage?: string; retryable: boolean; suggestion?: string } | null;
  credits: number; priority: number; attempts: number; maxAttempts: number;
  queuePosition: number; stage: StageId | null; automationRunId: ID | null;
  logs: { t: string; level: 'info' | 'warn' | 'error'; msg: string }[];
  demo: boolean; parentJobId: ID | null; batchId: ID | null;
  createdAt: string; startedAt: string | null; finishedAt: string | null;
}

/* ── providers / models ──────────────────────────────────────── */
export type Capability = 'text' | 'image' | 'video' | 'voice' | 'music' | 'sound' | 'upscale' | 'lipsync' | '3d' | 'vision' | 'editing';
export type ProviderDriver =
  | 'openai-compatible' | 'anthropic' | 'replicate' | 'fal' | 'comfyui'
  | 'elevenlabs' | 'suno' | 'custom-http' | 'demo' | 'local-ffmpeg'
  /** Aliases for `openai-compatible`, kept so provider rows can name their driver
   *  naturally. `adapterFor()` resolves all three to the same adapter. */
  | 'openai' | 'ollama' | 'lmstudio';

export interface Provider {
  id: ID; name: string; driver: ProviderDriver;
  baseUrl: string | null; enabled: boolean; builtIn: boolean;
  capabilities: Capability[]; docsUrl: string | null;
  credentialStatus: 'missing' | 'configured' | 'env' | 'invalid' | 'connected' | 'untested' | 'failed';
  envKeyVar: string | null; notes: string; priority: number;
  createdAt: string;
}
export interface ModelDescriptor {
  id: ID; providerId: ID; name: string; driverModel: string;
  capabilities: Capability[]; kind: GenKind;
  quality: 1 | 2 | 3 | 4 | 5; speed: 1 | 2 | 3 | 4 | 5;
  costPerUnit: number; unit: string;
  contextWindow?: number; maxDurationSec?: number;
  supportedRatios: AspectRatio[]; supportedResolutions: Resolution[];
  features: string[]; enabled: boolean; isDefault: boolean;
  demo: boolean; custom: boolean; config: Record<string, unknown>;
  createdAt: string;
}
export interface ApiCredential {
  id: ID; providerId: ID; userId: ID;
  label: string; maskedKey: string; keyFingerprint: string;
  encrypted: boolean; baseUrl: string | null; extra: Record<string, string>;
  status: 'untested' | 'connected' | 'failed' | 'invalid'; lastTestedAt: string | null;
  lastError: string | null; scopes: string[];
  createdAt: string; updatedAt: string;
}

/**
 * An INBOUND key: what a caller presents to authenticate against `/api/open/*`.
 *
 * Not to be confused with `ApiCredential`, which is an OUTBOUND key the studio
 * uses to reach a vendor. The plaintext is shown exactly once, at creation, and
 * is never persisted — only `keyHash` is, so a database leak does not hand out
 * working credentials.
 */
export interface ApiKey {
  id: ID; userId: ID;
  name: string;
  /** `afs_` + the first characters of the key, for telling keys apart in a list. */
  prefix: string;
  keyHash: string;
  scopes: string[];
  enabled: boolean;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  createdAt: string; updatedAt: string;
}
export interface ModelPreset {
  id: ID; name: string; description: string; builtIn: boolean; userId: ID | null;
  textModel: ID | null; imageModel: ID | null; videoModel: ID | null;
  voiceModel: ID | null; musicModel: ID | null; soundModel: ID | null;
  upscaleModel: ID | null; editingModel: ID | null;
  strategy: 'quality' | 'speed' | 'cost' | 'explicit';
  defaults: { resolution: Resolution; aspectRatio: AspectRatio; fps: Fps; steps?: number; guidance?: number; motion?: string };
  fallbacks: Partial<Record<Capability, ID[]>>;
}

/* ── timeline / NLE ──────────────────────────────────────────── */
export type TrackKind = 'video' | 'audio';
export type ClipKind = 'video' | 'image' | 'audio' | 'text' | 'adjustment' | 'solid' | 'shape';
export type TransitionKind = 'none' | 'cut' | 'crossfade' | 'dip-black' | 'dip-white' | 'wipe-left' | 'wipe-right' | 'wipe-up' | 'slide' | 'zoom' | 'blur' | 'light-leak';
export type BlendMode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'soft-light' | 'add' | 'difference';

export interface Keyframe<T = number> { t: number; v: T; ease: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'hold' }
export interface Transform { x: number; y: number; scale: number; rotation: number; opacity: number; crop: { l: number; r: number; t: number; b: number }; flipH: boolean; flipV: boolean }
export interface EffectInstance {
  id: ID; type: string; name: string; enabled: boolean; intensity: number;
  params: Record<string, number | string | boolean>; keyframes: Record<string, Keyframe[]>;
}
export interface ColorGrade {
  exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number;
  temperature: number; tint: number; saturation: number; vibrance: number; sharpness: number;
  fade: number; vignette: number; grain: number;
  lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number];
  curves: { rgb: [number, number][]; red: [number, number][]; green: [number, number][]; blue: [number, number][] };
  hsl: Record<string, { h: number; s: number; l: number }>;
  lutAssetId: ID | null; lutAmount: number;
  splitShadows: string; splitHighlights: string; splitBalance: number;
}
export const DEFAULT_GRADE: ColorGrade = {
  exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
  temperature: 0, tint: 0, saturation: 0, vibrance: 0, sharpness: 0,
  fade: 0, vignette: 0, grain: 0,
  lift: [0, 0, 0], gamma: [0, 0, 0], gain: [0, 0, 0],
  curves: { rgb: [[0, 0], [1, 1]], red: [[0, 0], [1, 1]], green: [[0, 0], [1, 1]], blue: [[0, 0], [1, 1]] },
  hsl: {}, lutAssetId: null, lutAmount: 100,
  splitShadows: '#000000', splitHighlights: '#ffffff', splitBalance: 0
};

export interface Clip {
  id: ID; trackId: ID; kind: ClipKind; name: string;
  assetId: ID | null; srcUrl: string | null; demo: boolean;
  start: number; duration: number; in: number; out: number;
  speed: number; opacity: number; blend: BlendMode;
  transform: Transform; volume: number; pan: number;
  fadeIn: number; fadeOut: number;
  transitionIn: TransitionKind; transitionOut: TransitionKind; transitionDur: number;
  effects: EffectInstance[]; grade: ColorGrade | null;
  freeze: { at: number; dur: number }[];
  text?: { content: string; font: string; size: number; color: string; align: 'left' | 'center' | 'right'; y: number; bg: boolean; animate: 'none' | 'fade' | 'rise' | 'type' };
  markers: { t: number; label: string; color: string }[];
  locked: boolean; muted: boolean; linked: ID[];
  waveformPeaks: number[] | null;
  color: string; meta: Record<string, unknown>;
}
export interface Track {
  id: ID; kind: TrackKind; name: string; index: number;
  height: number; muted: boolean; solo: boolean; locked: boolean; hidden: boolean;
  volume: number; pan: number; clips: Clip[];
}
export interface Timeline {
  id: ID; projectId: ID; name: string; fps: Fps;
  width: number; height: number; aspectRatio: AspectRatio;
  tracks: Track[]; markers: { id: ID; t: number; label: string; color: string }[];
  inPoint: number | null; outPoint: number | null;
  grade: ColorGrade; nested: { id: ID; timelineId: ID }[];
  durationSec: number; createdAt: string; updatedAt: string;
}
export interface Caption { id: ID; start: number; end: number; text: string; speaker?: string; style?: Record<string, unknown> }

/* ── voice & sound ───────────────────────────────────────────── */
export interface VoiceLine {
  id: ID; projectId: ID; sceneId: ID | null; characterId: ID | null;
  speaker: string; text: string; voiceId: string; language: string;
  emotion: string; speed: number; pitch: number; stability: number; clarity: number;
  assetId: ID | null; status: 'none' | 'queued' | 'generating' | 'ready' | 'approved' | 'failed';
  take: number; durationSec: number; modelId: ID | null; demo: boolean;
}
export type SoundKind = 'dialogue' | 'sfx' | 'ambience' | 'foley' | 'music' | 'score' | 'stinger';
export interface SoundCue {
  id: ID; projectId: ID; sceneId: ID | null; kind: SoundKind;
  name: string; description: string; prompt: string;
  startSec: number; durationSec: number; volume: number; loop: boolean;
  assetId: ID | null; status: 'none' | 'queued' | 'generating' | 'ready' | 'approved' | 'failed';
  modelId: ID | null; demo: boolean; autoDetected: boolean; tags: string[];
}

/* ── automation ──────────────────────────────────────────────── */
export type NodeType =
  | 'start' | 'text-generate' | 'image-generate' | 'video-generate' | 'voice-generate'
  | 'music-generate' | 'sfx-generate' | 'upload' | 'transform' | 'condition' | 'loop'
  | 'batch' | 'delay' | 'human-review' | 'approve' | 'reject' | 'webhook' | 'http-request'
  | 'save-asset' | 'timeline' | 'export' | 'extract-characters' | 'extract-locations'
  | 'breakdown-scenes' | 'generate-story' | 'generate-script' | 'generate-storyboard'
  | 'assemble' | 'upscale' | 'caption' | 'end';

export interface AutomationNode {
  id: ID; automationId: ID; type: NodeType; label: string;
  x: number; y: number; config: Record<string, unknown>;
  modelId: ID | null; prompt: string; enabled: boolean;
  retry: number; timeoutSec: number; reviewGate: boolean;
  inputPort: string; outputPorts: { id: string; label: string }[];
  status: 'idle' | 'running' | 'done' | 'error' | 'waiting' | 'skipped';
  logs: { t: string; level: 'info' | 'warn' | 'error'; msg: string }[];
}
export interface AutomationEdge { id: ID; automationId: ID; from: ID; fromPort: string; to: ID; toPort: string }
export interface Automation {
  id: ID; projectId: ID | null; userId: ID; name: string; description: string;
  nodes: AutomationNode[]; edges: AutomationEdge[];
  trigger: 'manual' | 'schedule' | 'webhook'; schedule: string | null;
  maxCostCredits: number; requireApproval: boolean; enabled: boolean;
  lastRunId: ID | null; createdAt: string; updatedAt: string;
}
export type RunStatus = 'running' | 'paused' | 'waiting' | 'succeeded' | 'failed' | 'cancelled';
export interface AutomationRun {
  id: ID; automationId: ID; projectId: ID | null; userId: ID; status: RunStatus;
  currentNodeId: ID | null; visited: ID[]; progress: number;
  creditsUsed: number; error: string | null;
  review: { nodeId: ID; prompt: string; payload: Record<string, unknown>; requestedAt: string } | null;
  logs: { t: string; nodeId: ID | null; level: 'info' | 'warn' | 'error'; msg: string }[];
  startedAt: string; finishedAt: string | null;
}

/* ── versions, credits, billing ──────────────────────────────── */
export interface ProjectVersion {
  id: ID; projectId: ID; rev: number; label: string; reason: string;
  snapshot: string; sizeBytes: number; createdAt: string; userId: ID;
  stage: StageId | null;
}
export type PlanId = 'free' | 'creator' | 'pro' | 'studio' | 'enterprise';
export interface Plan {
  id: PlanId; name: string; priceMonthly: number; priceYearly: number; currency: string;
  creditsMonthly: number; seats: number; features: string[]; highlight?: boolean;
  maxResolution: Resolution; concurrentJobs: number; watermark: boolean; priority: number;
}
export interface Subscription {
  id: ID; userId: ID; planId: PlanId; status: 'active' | 'trialing' | 'past_due' | 'cancelled';
  credits: number; creditsLifetime: number; renewsAt: string | null;
  cancelAtPeriodEnd: boolean; providerRef: string | null; paymentProvider: string; startedAt: string;
}
export interface CreditTx {
  id: ID; userId: ID; amount: number; balanceAfter: number;
  kind: 'purchase' | 'spend' | 'refund' | 'grant' | 'plan';
  refType: string; refId: string; description: string; createdAt: string;
}
export interface ExportJob {
  id: ID; projectId: ID; timelineId: ID; label: string;
  format: 'mp4' | 'mov' | 'webm' | 'gif' | 'wav' | 'zip' | 'json';
  codec: 'h264' | 'h265' | 'prores' | 'vp9' | 'av1' | 'pcm';
  resolution: Resolution; fps: Fps; aspectRatio: AspectRatio;
  quality: 'draft' | 'high' | 'master'; bitrate: number;
  status: 'queued' | 'rendering' | 'encoding' | 'succeeded' | 'failed';
  progress: number; engine: 'browser' | 'ffmpeg' | 'server';
  assetId: ID | null; error: string | null; range: [number, number] | null;
  createdAt: string; finishedAt: string | null;
}

/* ── users ───────────────────────────────────────────────────── */
export interface User {
  id: ID; email: string; name: string; avatarColor: string;
  role: 'owner' | 'admin' | 'editor' | 'viewer';
  developerMode: boolean; theme: string; createdAt: string;
  onboardingDone: boolean;
}

/* ── project aggregate ───────────────────────────────────────── */
export interface Project {
  id: ID; userId: ID; name: string; slug: string;
  type: ProjectType; settings: ProjectSettings;
  idea: Idea; story: Story | null; screenplay: Screenplay | null;
  worldBible: WorldBible | null;
  stage: StageId; stageStates: Record<StageId, StageState>;
  activeTimelineId: ID | null; rev: number;
  coverAssetId: ID | null; tags: string[]; description: string;
  creditsSpent: number; generationsCount: number;
  createdAt: string; updatedAt: string; lastOpenedAt: string;
}

/* ── API envelope ────────────────────────────────────────────── */
export interface ApiOk<T> { ok: true; data: T }
export interface ApiErr { ok: false; error: { message: string; code: string; details?: unknown; hint?: string } }
export type ApiResult<T> = ApiOk<T> | ApiErr;

/* ── events (SSE) ────────────────────────────────────────────── */
export type BusEvent =
  | { type: 'job:update'; job: GenerationJob }
  | { type: 'job:created'; job: GenerationJob }
  | { type: 'job:removed'; id: ID }
  | { type: 'asset:created'; asset: Asset }
  | { type: 'credits:update'; credits: number }
  | { type: 'project:update'; projectId: ID; patch: Partial<Project> }
  | { type: 'automation:update'; run: AutomationRun }
  | { type: 'export:update'; export: ExportJob }
  | { type: 'toast'; level: 'info' | 'success' | 'error' | 'warn'; title: string; body?: string }
  | { type: 'review:requested'; run: AutomationRun };

/* ── AI edit proposals ───────────────────────────────────────── */
export interface ProposalChange {
  path: string;                        // e.g. timeline.tracks[0].clips[3].speed
  label: string; from: unknown; to: unknown; kind: 'set' | 'insert' | 'remove';
}
export interface EditProposal {
  id: ID; command: string; summary: string; rationale: string;
  changes: ProposalChange[]; credits: number; risky: boolean;
  ops: TimelineOp[]; createdAt: string;
}
export type TimelineOp =
  | { op: 'addClip'; track: number; clip: Partial<Clip> & { start: number; duration: number } }
  | { op: 'removeClip'; clipId: ID }
  | { op: 'updateClip'; clipId: ID; patch: Partial<Clip> }
  | { op: 'moveClip'; clipId: ID; start: number; trackId?: ID }
  | { op: 'splitClip'; clipId: ID; at: number }
  | { op: 'trimClip'; clipId: ID; start?: number; duration?: number }
  | { op: 'addTrack'; kind: TrackKind; name?: string; at?: number }
  | { op: 'removeTrack'; trackId: ID }
  | { op: 'rippleDelete'; clipId: ID }
  | { op: 'setGrade'; grade: Partial<ColorGrade>; scope: 'timeline' | 'clip'; clipId?: ID }
  | { op: 'addMarker'; t: number; label: string }
  | { op: 'retime'; clipId: ID; speed: number }
  | { op: 'addTransition'; clipId: ID; edge: 'in' | 'out'; kind: TransitionKind; dur: number }
  | { op: 'sortTimeline' };

/* ── search ──────────────────────────────────────────────────── */
export interface SearchHit {
  id: ID; kind: 'project' | 'character' | 'location' | 'scene' | 'shot' | 'asset' | 'dialogue' | 'prompt' | 'generation' | 'clip' | 'voice' | 'command';
  title: string; subtitle: string; projectId: ID | null; stage: StageId | null; score: number;
}

/* ── demo/sample ─────────────────────────────────────────────── */
export interface DemoMotion {
  kind: 'demo-motion'; frames: string[]; fps: number;
  move: CameraMove; zoomFrom: number; zoomTo: number; panX: number; panY: number;
  label: string;
}
