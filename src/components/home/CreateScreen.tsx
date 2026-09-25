'use client';
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  Clapperboard, Film, Video, Music, Megaphone, BookOpen, Workflow, ArrowRight, Sparkles,
  FolderOpen, Plus, Clock, Layers, Wand2, AlertTriangle, ChevronRight,
  Image, Mic, Volume2, Type, Zap, Server, Cpu, Database, Globe, Settings,
  CircleDollarSign, X, SlidersHorizontal, Loader2, Mic2, Music as MusicIcon
} from 'lucide-react';
import { cx, Card, Badge, Button, PrevisBadge, EmptyState, NativeSelect, NativeTextInput, NativeTextArea } from '@/components/ui/primitives';
import { NewProjectModal } from './NewProjectModal';
import { useApp, useBoot, useProjects } from '@/store/app';
import { STAGES, STAGE_META, type ProjectType } from '@/types';

interface CreateCard {
  id: ProjectType; title: string; blurb: string; icon: React.ReactNode;
  accent: string; steps: string; featured?: boolean;
}

const CARDS: CreateCard[] = [
  { id: 'new-video', title: 'New Video', blurb: 'Professional editor, your footage', icon: <Video size={19} />, accent: '#63A9E9', steps: 'Import → Edit → Color → Export', featured: true },
  { id: 'short-film', title: 'AI Short Film', blurb: 'Idea → story → script → film', icon: <Clapperboard size={19} />, accent: '#D99A32', steps: '15 stages, fully generated', featured: true },
  { id: 'drama', title: 'AI Drama', blurb: 'Characters, continuity, episodes', icon: <Film size={19} />, accent: '#C58BE9', steps: 'Locked character identities' },
  { id: 'music-video', title: 'AI Music Video', blurb: 'Music → scenes → shots → edit', icon: <Music size={19} />, accent: '#4CCB8A', steps: 'Beat-synced cutting' },
  { id: 'commercial', title: 'AI Commercial', blurb: 'Product → concept → storyboard → advertisement', icon: <Megaphone size={19} />, accent: '#F0B347', steps: 'Product photography preset' },
  { id: 'documentary', title: 'Documentary', blurb: 'Research → script → interview → edit', icon: <BookOpen size={19} />, accent: '#5BC8C8', steps: 'Interview + archive workflow' },
  { id: 'custom', title: 'Automation', blurb: 'Node pipeline with review gates', icon: <Workflow size={19} />, accent: '#9AA7E9', steps: 'Idea → export, unattended' }
];

const GENERATOR_MODES = [
  { id: 'image', label: 'Image', icon: <Image size={18} />, accent: '#63A9E9', models: ['flux-1.1-pro', 'gpt-image-1', 'rep-flux-1-1-pro', 'fal-flux-pro'] },
  { id: 'video', label: 'Video', icon: <Film size={18} />, accent: '#D99A32', models: ['kling-2.1', 'rep-kling-2-1', 'fal-kling', 'rep-veo-3', 'rep-minimax', 'rep-hunyuan-video', 'rep-wan-2-2'] },
  { id: 'voice', label: 'Voice', icon: <Mic2 size={18} />, accent: '#C58BE9', models: ['eleven-v3', 'el-multilingual-v2', 'openai-tts-hd', 'fal-playai-tts'] },
  { id: 'music', label: 'Music', icon: <MusicIcon size={18} />, accent: '#4CCB8A', models: ['eleven-music', 'el-music', 'demo-music'] },
  { id: 'sfx', label: 'Sound Effect', icon: <Volume2 size={18} />, accent: '#F0B347', models: ['eleven-sfx', 'el-sfx', 'demo-sfx'] },
  { id: 'text', label: 'Text', icon: <Type size={18} />, accent: '#5BC8C8', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'gpt-4o', 'gpt-4-1', 'demo-text'] }
] as const;

type GeneratorMode = typeof GENERATOR_MODES[number]['id'];

interface AIGeneratorModalProps {
  open: boolean;
  mode: GeneratorMode;
  onClose: () => void;
  onGenerate: (mode: GeneratorMode, prompt: string, options: Record<string, any>) => void;
}

function AIGeneratorModal({ open, mode, onClose, onGenerate }: AIGeneratorModalProps) {
  const modeConfig = GENERATOR_MODES.find(m => m.id === mode)!;
  const [prompt, setPrompt] = React.useState('');
  const [model, setModel] = React.useState('auto');
  const [loading, setLoading] = React.useState(false);
  const [options, setOptions] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    setPrompt('');
    setModel('auto');
    setOptions({});
  }, [mode]);

  const handleGenerate = () => {
    if (!prompt.trim()) return;
    setLoading(true);
    onGenerate(mode, prompt, { model, ...options });
    setTimeout(() => setLoading(false), 2000);
  };

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-generator-title"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={{ type: 'spring', damping: 30, stiffness: 400 }}
        className="relative w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-line p-5"
          style={{ background: `linear-gradient(180deg, ${modeConfig.accent}15, transparent)` }}>
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl"
              style={{ background: `linear-gradient(180deg, ${modeConfig.accent}22, transparent)`, borderColor: `${modeConfig.accent}33`, color: modeConfig.accent }}>
              {modeConfig.icon}
            </span>
            <div>
              <h2 id="ai-generator-title" className="text-[16px] font-semibold text-ink">Generate {modeConfig.label}</h2>
              <p className="text-[12px] text-ink3">AI Generator · {modeConfig.models.length} models available</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="icon-btn text-ink3 hover:text-ink hover:bg-white/5"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto max-h-[calc(90vh-80px)]">
          <div className="space-y-5">
            {/* Prompt */}
            <div>
              <label className="block text-[12px] font-medium text-ink2 mb-2">Prompt <span className="text-accent">*</span></label>
              <NativeTextArea
                rows={4}
                placeholder={`Describe the ${modeConfig.label.toLowerCase()} you want to generate…`}
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                className="h-[100px] resize-none"
              />
              <p className="mt-1.5 text-[11px] text-ink3">Be specific — style, lighting, composition, mood, technical details.</p>
            </div>

            {/* Model selector */}
            <div>
              <label className="block text-[12px] font-medium text-ink2 mb-2">Model</label>
              <NativeSelect
                value={model}
                onChange={e => setModel(e.target.value)}
                className="w-full"
              >
                <option value="auto">Auto — router picks by capability, quality & availability</option>
                {modeConfig.models.map(m => (
                  <option key={m} value={m}>{m.replace(/-/g, ' ').toUpperCase()}</option>
                ))}
              </NativeSelect>
              <p className="mt-1.5 text-[11px] text-ink3">Auto selects the best configured provider for this capability.</p>
            </div>

            {/* Mode-specific options */}
            {mode === 'image' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Aspect Ratio</label>
                  <NativeSelect
                    value={options.aspectRatio || '16:9'}
                    onChange={e => setOptions(o => ({ ...o, aspectRatio: e.target.value }))}
                    className="w-full"
                  >
                    <option value="16:9">16:9 — Landscape</option>
                    <option value="9:16">9:16 — Portrait</option>
                    <option value="1:1">1:1 — Square</option>
                    <option value="4:5">4:5 — Portrait</option>
                    <option value="2.39:1">2.39:1 — Cinematic</option>
                    <option value="21:9">21:9 — Ultrawide</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Resolution</label>
                  <NativeSelect
                    value={options.resolution || '1080p'}
                    onChange={e => setOptions(o => ({ ...o, resolution: e.target.value }))}
                    className="w-full"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="1440p">1440p</option>
                    <option value="4k">4K</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {mode === 'video' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Duration</label>
                  <NativeSelect
                    value={options.duration || '5'}
                    onChange={e => setOptions(o => ({ ...o, duration: e.target.value }))}
                    className="w-full"
                  >
                    <option value="3">3 seconds</option>
                    <option value="5">5 seconds</option>
                    <option value="8">8 seconds</option>
                    <option value="10">10 seconds</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Aspect Ratio</label>
                  <NativeSelect
                    value={options.aspectRatio || '16:9'}
                    onChange={e => setOptions(o => ({ ...o, aspectRatio: e.target.value }))}
                    className="w-full"
                  >
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="2.39:1">2.39:1</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Resolution</label>
                  <NativeSelect
                    value={options.resolution || '1080p'}
                    onChange={e => setOptions(o => ({ ...o, resolution: e.target.value }))}
                    className="w-full"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="4k">4K</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {mode === 'voice' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Voice</label>
                  <NativeSelect
                    value={options.voice || 'alloy'}
                    onChange={e => setOptions(o => ({ ...o, voice: e.target.value }))}
                    className="w-full"
                  >
                    <option value="alloy">Alloy</option>
                    <option value="nova">Nova</option>
                    <option value="shimmer">Shimmer</option>
                    <option value="echo">Echo</option>
                    <option value="onyx">Onyx</option>
                    <option value="fable">Fable</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Emotion</label>
                  <NativeSelect
                    value={options.emotion || 'neutral'}
                    onChange={e => setOptions(o => ({ ...o, emotion: e.target.value }))}
                    className="w-full"
                  >
                    <option value="neutral">Neutral</option>
                    <option value="happy">Happy</option>
                    <option value="sad">Sad</option>
                    <option value="angry">Angry</option>
                    <option value="calm">Calm</option>
                    <option value="excited">Excited</option>
                    <option value="fearful">Fearful</option>
                    <option value="surprised">Surprised</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Speed</label>
                  <NativeSelect
                    value={options.speed || '1.0'}
                    onChange={e => setOptions(o => ({ ...o, speed: e.target.value }))}
                    className="w-full"
                  >
                    <option value="0.8">0.8x — Slow</option>
                    <option value="1.0">1.0x — Normal</option>
                    <option value="1.2">1.2x — Fast</option>
                    <option value="1.5">1.5x — Very Fast</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {mode === 'music' && (
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Duration</label>
                  <NativeSelect
                    value={options.duration || '30'}
                    onChange={e => setOptions(o => ({ ...o, duration: e.target.value }))}
                    className="w-full"
                  >
                    <option value="15">15 seconds</option>
                    <option value="30">30 seconds</option>
                    <option value="60">60 seconds</option>
                    <option value="120">2 minutes</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Mood</label>
                  <NativeSelect
                    value={options.mood || 'ambient'}
                    onChange={e => setOptions(o => ({ ...o, mood: e.target.value }))}
                    className="w-full"
                  >
                    <option value="ambient">Ambient</option>
                    <option value="cinematic">Cinematic</option>
                    <option value="upbeat">Upbeat</option>
                    <option value="dark">Dark</option>
                    <option value="corporate">Corporate</option>
                    <option value="lofi">Lo-fi</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Stems</label>
                  <NativeSelect
                    value={options.stems || 'false'}
                    onChange={e => setOptions(o => ({ ...o, stems: e.target.value }))}
                    className="w-full"
                  >
                    <option value="false">Stereo only</option>
                    <option value="true">Export stems</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {mode === 'sfx' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Duration</label>
                  <NativeSelect
                    value={options.duration || '5'}
                    onChange={e => setOptions(o => ({ ...o, duration: e.target.value }))}
                    className="w-full"
                  >
                    <option value="2">2 seconds</option>
                    <option value="5">5 seconds</option>
                    <option value="10">10 seconds</option>
                    <option value="15">15 seconds</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Type</label>
                  <NativeSelect
                    value={options.type || 'ambience'}
                    onChange={e => setOptions(o => ({ ...o, type: e.target.value }))}
                    className="w-full"
                  >
                    <option value="ambience">Ambience</option>
                    <option value="foley">Foley</option>
                    <option value="impact">Impact</option>
                    <option value="whoosh">Whoosh</option>
                    <option value="mechanical">Mechanical</option>
                    <option value="magical">Magical</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {mode === 'text' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Format</label>
                  <NativeSelect
                    value={options.format || 'story'}
                    onChange={e => setOptions(o => ({ ...o, format: e.target.value }))}
                    className="w-full"
                  >
                    <option value="story">Story / Narrative</option>
                    <option value="script">Screenplay</option>
                    <option value="dialogue">Dialogue</option>
                    <option value="outline">Outline</option>
                    <option value="treatment">Treatment</option>
                    <option value="logline">Logline</option>
                  </NativeSelect>
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-ink2 mb-2">Length</label>
                  <NativeSelect
                    value={options.length || 'medium'}
                    onChange={e => setOptions(o => ({ ...o, length: e.target.value }))}
                    className="w-full"
                  >
                    <option value="short">Short (~500 words)</option>
                    <option value="medium">Medium (~1500 words)</option>
                    <option value="long">Long (~3000 words)</option>
                  </NativeSelect>
                </div>
              </div>
            )}

            {/* Quick presets */}
            <div className="border-t border-line pt-5">
              <h3 className="text-[12px] font-semibold text-ink mb-3 flex items-center gap-2">
                <SlidersHorizontal size={14} className="text-accent" />Quick presets
              </h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {(() => {
                  const presets: { label: string; desc: string; prompt: string }[] =
                    mode === 'image' ? [
                      { label: 'Photorealistic portrait', desc: 'FLUX 1.1 Pro · 1024×1024', prompt: 'Professional photorealistic portrait, 85mm lens, shallow depth of field, natural lighting, skin texture detail, 8k resolution' },
                      { label: 'Cinematic landscape', desc: 'FLUX 1.1 Pro · 1920×1080', prompt: 'Epic cinematic landscape, golden hour, dramatic clouds, volumetric lighting, wide angle, 8k' },
                      { label: 'Product photography', desc: 'GPT Image 1 · 1024×1024', prompt: 'Clean product photography, studio lighting, white background, commercial quality, sharp details' },
                      { label: 'Concept art', desc: 'FLUX 1.1 Pro · 1024×1024', prompt: 'Detailed concept art, sci-fi environment, dramatic lighting, intricate details, artstation trending' }
                    ] : mode === 'video' ? [
                      { label: 'Cinematic video clip', desc: 'Kling 2.1 · 5s · 1080p', prompt: 'Cinematic camera movement, dramatic lighting, high production value, 24fps, film grain' },
                      { label: 'Social media reel', desc: 'Kling 2.1 · 5s · 9:16', prompt: 'Vertical video for social media, dynamic cuts, vibrant colors, engaging visual hooks' },
                      { label: 'Product demo', desc: 'Kling 2.1 · 8s · 1080p', prompt: 'Clean product demonstration, smooth camera orbits, professional lighting, minimal background' },
                      { label: 'Atmospheric B-roll', desc: 'Kling 2.1 · 10s · 4k', prompt: 'Atmospheric B-roll footage, slow motion, natural light, organic textures, cinematic mood' }
                    ] : mode === 'voice' ? [
                      { label: 'Voiceover narration', desc: 'Eleven v3 · Neutral · 30s', prompt: 'Professional documentary narration, clear articulate speech, measured pacing, authoritative tone' },
                      { label: 'Character dialogue', desc: 'Eleven v3 · Happy · 15s', prompt: 'Natural character dialogue, expressive emotion, conversational pace, realistic breathing' },
                      { label: 'Audiobook reading', desc: 'Eleven v3 · Calm · 60s', prompt: 'Audiobook narration, warm engaging voice, consistent pacing, clear enunciation' },
                      { label: 'Commercial voiceover', desc: 'Eleven v3 · Excited · 20s', prompt: 'High-energy commercial voiceover, persuasive tone, dynamic range, brand-friendly energy' }
                    ] : mode === 'music' ? [
                      { label: 'Ambient music loop', desc: 'Eleven Music · 60s · Stems', prompt: 'Atmospheric ambient loop, evolving pads, subtle textures, seamless loop point, stereo width' },
                      { label: 'Cinematic score', desc: 'Eleven Music · 90s · Stems', prompt: 'Epic cinematic orchestral, emotional build, strings and brass, dramatic climax' },
                      { label: 'Corporate background', desc: 'Eleven Music · 30s · Stems', prompt: 'Upbeat corporate background, modern electronic, positive energy, non-intrusive' },
                      { label: 'Lo-fi beat', desc: 'Eleven Music · 45s · Stems', prompt: 'Chill lo-fi hip hop beat, dusty vinyl crackle, relaxed tempo, study-friendly' }
                    ] : mode === 'sfx' ? [
                      { label: 'Atmosphere ambience', desc: 'Eleven SFX · 10s', prompt: 'Immersive ambient atmosphere, spatial depth, natural field recording quality' },
                      { label: 'Foley footsteps', desc: 'Eleven SFX · 5s', prompt: 'Realistic footsteps on various surfaces, spatial positioning, material accuracy' },
                      { label: 'Impact hit', desc: 'Eleven SFX · 3s', prompt: 'Heavy cinematic impact, sub-bass weight, transient punch, trailer-style' },
                      { label: 'Magical sparkle', desc: 'Eleven SFX · 4s', prompt: 'Ethereal magical shimmer, crystalline textures, fantasy spell effect, stereo spread' }
                    ] : mode === 'text' ? [
                      { label: 'Short story', desc: 'Claude Sonnet 4.5 · ~1500 words', prompt: 'Compelling short story with strong hook, developed characters, satisfying arc' },
                      { label: 'Screenplay scene', desc: 'Claude Sonnet 4.5 · ~1500 words', prompt: 'Properly formatted screenplay scene, visual storytelling, subtext-rich dialogue' },
                      { label: 'Video script', desc: 'Claude Sonnet 4.5 · ~1000 words', prompt: 'Engaging video script with hook, structure, and clear call-to-action' },
                      { label: 'Treatment outline', desc: 'Claude Sonnet 4.5 · ~2000 words', prompt: 'Detailed film treatment, act structure, character arcs, visual style notes' }
                    ] : [];
                  return presets.map((preset, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setPrompt(preset.prompt)}
                      className="text-left p-3 rounded-lg border border-line hover:border-accent/30 hover:bg-well transition-all"
                    >
                      <p className="text-[13px] font-medium text-ink">{preset.label}</p>
                      <p className="text-[11px] text-ink3 mt-0.5">{preset.desc}</p>
                    </button>
                  ));
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-line p-4 bg-well/30">
          <button
            onClick={onClose}
            className="btn btn-ghost text-[13px]"
          >
            Cancel
          </button>
          <button
            onClick={handleGenerate}
            disabled={!prompt.trim() || loading}
            className="btn btn-primary text-[13px] flex items-center gap-2"
            style={{ background: modeConfig.accent, borderColor: modeConfig.accent }}
          >
            {loading && <Loader2 size={16} className="animate-spin" />}
            <Sparkles size={16} />
            Generate {modeConfig.label}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/** The landing workspace: create something. */
export function CreateScreen() {
  const router = useRouter();
  const boot = useBoot();
  const projects = useProjects();
  const demo = boot?.demoMode ?? true;
  const [modal, setModal] = React.useState<{ open: boolean; type: ProjectType }>({ open: false, type: 'short-film' });
  const [aiGeneratorModal, setAiGeneratorModal] = React.useState<{ open: boolean; mode: GeneratorMode }>({ open: false, mode: 'image' });

  const openNew = (type: ProjectType) => {
    if (type === 'custom') { router.push('/automation'); return; }
    setModal({ open: true, type });
  };

  const openAiGenerator = (mode: GeneratorMode) => {
    setAiGeneratorModal({ open: true, mode });
  };

  const closeAiGenerator = () => {
    setAiGeneratorModal({ open: false, mode: 'image' });
  };

  const handleAiGenerate = (mode: GeneratorMode, prompt: string, options: Record<string, any>) => {
    console.log('Generate:', mode, prompt, options);
    // TODO: Connect to actual generation API
    closeAiGenerator();
  };

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />

      <div className="relative mx-auto w-full max-w-[1240px] px-6 pb-20 pt-12 lg:px-10">
        {/* engine status — only shown until a provider is connected */}
        {demo && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}
            className="mb-8 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-gradient-to-r from-well2 to-transparent px-4 py-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.08]"><Sparkles size={13} className="text-accent-bright" /></span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">Built-in Studio Engine active</p>
              <p className="mt-0.5 text-[11.5px] leading-snug text-ink2">
                Every stage is fully functional right now — rendering previsualisation plates, synthesised audio and
                procedural motion at no cost. Connect a provider to route generation to models instead.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button size="sm" variant="primary" onClick={() => router.push('/settings/providers')}>Connect a provider</Button>
              <Button size="sm" variant="ghost" onClick={() => router.push('/models')}>Browse models</Button>
            </div>
          </motion.div>
        )}

        {/* hero */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.38, ease: [0.22, 0.61, 0.36, 1] }} className="mb-8">
          <div className="mb-3 flex items-center gap-2">
            <span className="h-px w-8 bg-gradient-to-r from-transparent to-accent/60" />
            <span className="label text-accent/80">Production workspace</span>
          </div>
          <h1 className="display max-w-[16ch] text-ink">Create something</h1>
          <p className="lede mt-3 max-w-[64ch]">
            A professional editor, an AI film studio and a production pipeline in one workspace.
          </p>
        </motion.div>

        {/* AI Generator — simplified */}
        <section className="mb-10">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-accent/60" />
              <span className="label text-accent/80">AI Generator</span>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-ink3">
              <CircleDollarSign size={12} />Balance 19,620 credits · charged on success, refunded on failure
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-6">
            {[
              { id: 'image', label: 'Image', icon: <Image size={14} />, accent: '#63A9E9' },
              { id: 'video', label: 'Video', icon: <Video size={14} />, accent: '#D99A32' },
              { id: 'voice', label: 'Voice', icon: <Mic size={14} />, accent: '#C58BE9' },
              { id: 'music', label: 'Music', icon: <Music size={14} />, accent: '#4CCB8A' },
              { id: 'sfx', label: 'Sound Effect', icon: <Volume2 size={14} />, accent: '#F0B347' },
              { id: 'text', label: 'Text', icon: <Type size={14} />, accent: '#5BC8C8' },
            ].map((g) => (
              <motion.button key={g.id} type="button"
                onClick={() => openAiGenerator(g.id as GeneratorMode)}
                whileHover={{ scale: 1.05, y: -2 }}
                whileTap={{ scale: 0.98 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="group relative flex flex-col items-center gap-1.5 p-3 rounded-lg border border-line bg-panel transition-all duration-200 hover:border-accent/50 hover:shadow-lg cursor-pointer"
                style={{ '--accent': g.accent } as React.CSSProperties}>
                <span className="relative flex h-8 w-8 items-center justify-center rounded-md transition-all duration-300 group-hover:scale-110"
                  style={{ background: `linear-gradient(180deg, ${g.accent}22, transparent)`, borderColor: `${g.accent}33`, color: g.accent, boxShadow: `0 0 0 1px ${g.accent}33` }}>
                  {g.icon}
                </span>
                <span className="text-[11px] font-medium text-ink transition-colors group-hover:text-ink group-hover:drop-shadow-[0_0_8px_var(--accent)]">{g.label}</span>
              </motion.button>
            ))}
          </div>
        </section>

        {/* create cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CARDS.map((c, i) => (
            <motion.button key={c.id} type="button" onClick={() => openNew(c.id)}
              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i, duration: 0.26 }}
              whileHover={{ y: -3 }}
              className={cx('card card-hover group relative overflow-hidden p-4 text-left', c.featured && 'xl:col-span-2')}>
              <span className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full opacity-[0.09] blur-2xl transition-opacity duration-300 group-hover:opacity-25"
                style={{ background: c.accent }} />
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                style={{ background: `linear-gradient(90deg, transparent, ${c.accent}66, transparent)` }} />
              <span className="pointer-events-none absolute inset-0 rounded-lg border border-white/0 group-hover:border-white/40 transition-colors duration-300" />
              <span className="relative flex h-9 w-9 items-center justify-center rounded-lg border transition-colors duration-200"
                style={{ borderColor: `${c.accent}33`, background: `linear-gradient(180deg, ${c.accent}1A, transparent)`, color: c.accent }}>
                {c.icon}
              </span>
              {c.id === 'new-video' && (
                <>
                  <video autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-100 pointer-events-none"
                    src="/banner-374a8e61.mp4" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />
                </>
              )}
              {c.id === 'short-film' && (
                <>
                  <video autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover opacity-100 pointer-events-none"
                    src="/Octa%20ai.mp4" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />
                </>
              )}
              <h3 className="relative mt-3 text-[14px] font-semibold tracking-tight text-ink">{c.title}</h3>
              <p className="relative mt-1 text-[11.5px] leading-snug text-ink2">{c.blurb}</p>
              <p className="relative mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.09em] text-ink3">
                {c.steps}
                <ArrowRight size={11} className="translate-x-0 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100" style={{ color: c.accent }} />
              </p>
            </motion.button>
          ))}
        </div>

        {/* Models registry */}
        <section className="mb-12">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="h-px w-8 bg-gradient-to-r from-transparent to-accent/60" />
              <span className="label text-accent/80">Models</span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => router.push('/models')}>
              <Settings size={12} />Manage all
            </Button>
          </div>
          <p className="mb-4 text-[11.5px] leading-relaxed text-ink3 max-w-2xl">
            Every capability is served by a registry entry, not by hard-coded vendor calls. Set a default, disable what you don't want, re-price a model, or add your own — the router picks from whatever is enabled and has credentials.
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { id: 'comfyui', label: 'ComfyUI', desc: 'Local node-graph workflows', icon: <Cpu size={14} />, accent: '#D99A32', href: '/settings/providers?tab=comfyui', status: boot?.providers?.find(p => p.id === 'comfyui')?.credentialStatus === 'connected' ? 'connected' : 'not configured' },
              { id: 'ollama', label: 'Ollama', desc: 'Local LLMs (Llama, Qwen, etc.)', icon: <Server size={14} />, accent: '#C58BE9', href: '/settings/providers?tab=ollama', status: boot?.providers?.find(p => p.id === 'ollama')?.credentialStatus === 'connected' ? 'connected' : 'not configured' },
              { id: 'lmstudio', label: 'LM Studio', desc: 'Local OpenAI-compatible server', icon: <Database size={14} />, accent: '#4CCB8A', href: '/settings/providers?tab=lmstudio', status: boot?.providers?.find(p => p.id === 'lmstudio')?.credentialStatus === 'connected' ? 'connected' : 'not configured' },
              { id: 'custom', label: 'Custom API', desc: 'Any REST endpoint', icon: <Globe size={14} />, accent: '#9AA7E9', href: '/settings/providers?tab=custom', status: 'configure' },
            ].map((m, i) => (
              <Link key={m.id} href={m.href}
                className="group card card-hover relative overflow-hidden p-4 transition-all duration-200"
                style={{ '--accent': m.accent } as React.CSSProperties}>
                <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.08] blur-2xl transition-opacity duration-300 group-hover:opacity-20"
                  style={{ background: m.accent }} />
                <span className="pointer-events-none absolute inset-0 rounded-lg border border-white/0 group-hover:border-white/30 transition-colors duration-300" />
                <div className="flex items-start gap-3">
                  <span className="relative flex h-10 w-10 items-center justify-center rounded-xl flex-shrink-0 transition-all duration-200 group-hover:scale-110"
                    style={{ background: `linear-gradient(180deg, ${m.accent}22, transparent)`, borderColor: `${m.accent}33`, color: m.accent }}>
                    {m.icon}
                  </span>
                  <div className="min-w-0 flex-1 text-left">
                    <h4 className="text-[13px] font-semibold text-ink">{m.label}</h4>
                    <p className="mt-0.5 text-[11px] text-ink3">{m.desc}</p>
                    <span className="mt-2 inline-flex items-center gap-1 text-[10px]"
                      style={{ color: m.status === 'connected' ? '#4CCB8A' : '#D99A32' }}>
                      {m.status === 'connected' ? (
                        <>
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#4CCB8A' }} />
                          Connected
                        </>
                      ) : (
                        <>Configure</>
                      )}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* recent projects */}
        <section className="mt-12">
          <div className="mb-3 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-ink">Recent projects</h2>
              <p className="mt-0.5 text-[11.5px] text-ink3">Everything is persisted — reopen a project and every stage is exactly where you left it.</p>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => router.push('/projects')} iconRight={<ArrowRight size={12} />}>All projects</Button>
              <Button size="sm" variant="primary" onClick={() => setModal({ open: true, type: 'short-film' })}><Plus size={12} />New project</Button>
            </div>
          </div>

          {projects.length === 0 ? (
            <EmptyState icon={<FolderOpen size={17} />}
              title="No projects yet"
              body={<>Pick a card above to start. An <strong className="text-ink2">AI Short Film</strong> walks you through idea → story → script → cast → world → scenes → storyboard → shots → video → voice → sound → edit → color → export. A <strong className="text-ink2">New Video</strong> project drops you straight into the editor.</>}
              action={<Button variant="primary" size="sm" onClick={() => setModal({ open: true, type: 'short-film' })}><Clapperboard size={12} />Create an AI Short Film</Button>}
              secondary={<Button size="sm" onClick={() => setModal({ open: true, type: 'new-video' })}><Video size={12} />Open the editor</Button>} />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {projects.slice(0, 8).map((p, i) => <ProjectCard key={p.id} p={p} index={i} />)}
            </div>
          )}
        </section>

        {/* pipeline explainer */}
        <section className="mt-12 grid gap-3 lg:grid-cols-3">
          <Card hover={false} className="p-4">
            <Layers size={15} className="text-accent" />
            <h3 className="mt-2.5 text-[13px] font-semibold text-ink">One workspace, fifteen stages</h3>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink2">
              Idea, story, screenplay, characters, world, scenes, storyboard, shots, video, voice, sound, AI edit,
              pro editor, color and export. Each stage keeps its own state and you can return to any of them at any time.
            </p>
          </Card>
          <Card hover={false} className="p-4">
            <Wand2 size={15} className="text-accent" />
            <h3 className="mt-2.5 text-[13px] font-semibold text-ink">Provider-agnostic by design</h3>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink2">
              A model router picks the best configured provider per capability, with fallbacks. OpenAI-compatible,
              Anthropic, Replicate, fal, ElevenLabs, ComfyUI, Ollama, LM Studio or any custom HTTP API — add one without
              touching the UI.
            </p>
          </Card>
          <Card hover={false} className="p-4">
            <Workflow size={15} className="text-accent" />
            <h3 className="mt-2.5 text-[13px] font-semibold text-ink">Automate with review gates</h3>
            <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink2">
              Build a node pipeline from idea to export. Human-review nodes suspend the run and show you exactly what
              will be generated and what it will cost before a single credit is spent.
            </p>
            <Link href="/automation" className="mt-2.5 inline-flex items-center gap-1 text-[11.5px] font-medium text-accent-bright hover:underline">
              Open Automation <ArrowRight size={11} />
            </Link>
          </Card>
        </section>

        {boot && !boot.ffmpeg && (
          <p className="mt-8 flex items-start gap-2 rounded-lg border border-line-soft bg-well2 px-3.5 py-2.5 text-[11px] leading-relaxed text-ink3">
            <AlertTriangle size={12} className="mt-[2px] shrink-0 text-accent" />
            <span>
              FFmpeg was not found on this server, so server-side video renders are disabled. The editor's in-browser
              renderer still produces real exports, and stem and project-bundle exports work without it. Install ffmpeg
              or set <code className="mono text-ink2">FFMPEG_PATH</code> to enable H.264/H.265/ProRes masters.
            </span>
          </p>
        )}
      </div>

      <NewProjectModal open={modal.open} type={modal.type} onClose={() => setModal(m => ({ ...m, open: false }))} />
      <AIGeneratorModal
        open={aiGeneratorModal.open}
        mode={aiGeneratorModal.mode}
        onClose={closeAiGenerator}
        onGenerate={handleAiGenerate}
      />
    </div>
  );
}

function ProjectCard({ p, index }: { p: NonNullable<ReturnType<typeof useApp.getState>['boot']>['projects'][number]; index: number }) {
  const router = useRouter();
  const states = (p.stageStates ?? {}) as Record<string, string>;
  const done = Object.values(states).filter(s => s === 'ready' || s === 'approved').length;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 * index }}>
      <Card className="group cursor-pointer overflow-hidden" onClick={() => router.push(`/project/${p.id}`)}>
        <div className="relative h-[92px] overflow-hidden border-b border-line-soft bg-well">
          <div className="absolute inset-0 bg-gradient-to-br from-card via-well2 to-deep" />
          <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(70% 90% at 25% 10%, rgba(217,154,50,0.16), transparent 60%)' }} />
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-3 pb-2.5">
            {Array.from({ length: 15 }).map((_, i) => {
              const order = ['idea','story','script','characters','world','scenes','storyboard','shots','video','voice','sound','aiedit','editor','color','export'];
              const st = states[order[i]] ?? 'empty';
              return <span key={i} className={cx('h-1 flex-1 rounded-full', st === 'approved' ? 'bg-ok' : st === 'ready' ? 'bg-ok/55' : st === 'generating' ? 'bg-accent animate-pulseDot' : st === 'error' ? 'bg-bad' : 'bg-white/[0.08]')} />;
            })}
          </div>
          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded border border-line bg-black/40 text-ink3 opacity-0 transition-opacity group-hover:opacity-100">
            <ArrowRight size={12} />
          </span>
        </div>
        <div className="p-3">
          <div className="flex items-start justify-between gap-2">
            <h3 className="min-w-0 truncate text-[12.5px] font-semibold text-ink">{p.name}</h3>
            <Badge tone="mut" className="shrink-0 font-mono text-[9px]">r{p.rev}</Badge>
          </div>
          <p className="mt-1 truncate text-[10.5px] text-ink3">{p.description || p.type.replace(/-/g, ' ')}</p>
          <div className="mt-2.5 flex items-center gap-2 text-[10px] text-ink3">
            <Clock size={10} />{new Date(p.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            <span className="ml-auto">{done}/15 stages</span>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
