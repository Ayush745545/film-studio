'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { Workflow, Clapperboard, Film, Music, Megaphone, BookOpen, Video, Share2, Sparkles, ArrowRight } from 'lucide-react';
import { Card, Badge, Button, cx } from '@/components/ui/primitives';
import { NewProjectModal } from './NewProjectModal';
import { post, describeError } from '@/lib/client/api';
import { useApp } from '@/store/app';
import type { ProjectType } from '@/types';

interface Template {
  id: string; name: string; blurb: string; icon: React.ReactNode; accent: string;
  type: ProjectType; tags: string[];
  settings: { format: string; durationSec: number; style: string; fps: number };
  idea: { genre?: string; tone?: string; theme?: string; setting?: string; pacing?: string; visualStyle?: string };
  workflow?: 'full-film' | 'storyboard-only' | 'social-cut';
}

const TEMPLATES: Template[] = [
  { id: 'noir-short', name: 'Neon Noir Short', blurb: 'Rain, sodium light and a debt that cannot be paid.', icon: <Clapperboard size={18} />, accent: '#D99A32', type: 'short-film',
    tags: ['thriller', 'noir', '3 min'], settings: { format: '2.39:1', durationSec: 180, style: 'Noir', fps: 24 },
    idea: { genre: 'neo-noir thriller', tone: 'dread, restrained', theme: 'complicity', setting: 'a rain-soaked coastal city at night', pacing: 'slow burn with two accelerations', visualStyle: 'hard chiaroscuro, single practical sources' }, workflow: 'full-film' },
  { id: 'product-ad', name: 'Product Spot (30s)', blurb: 'Hero product, three beats, one clear call to action.', icon: <Megaphone size={18} />, accent: '#F0B347', type: 'commercial',
    tags: ['commercial', '30s', 'high-key'], settings: { format: '16:9', durationSec: 30, style: 'Commercial', fps: 25 },
    idea: { genre: 'commercial', tone: 'confident, warm', theme: 'a small object that changes a routine', pacing: 'fast, cut on motion', visualStyle: 'studio product photography, immaculate surfaces' } },
  { id: 'music-video', name: 'Music Video', blurb: 'Beat-mapped scenes with a strong colour script.', icon: <Music size={18} />, accent: '#4CCB8A', type: 'music-video',
    tags: ['music', 'stylised', '2 min'], settings: { format: '16:9', durationSec: 210, style: 'Stylized', fps: 24 },
    idea: { genre: 'music video', tone: 'euphoric, restless', theme: 'movement as memory', pacing: 'cut to beat, chorus opens up', visualStyle: 'saturated, high contrast, graphic composition' } },
  { id: 'doc-short', name: 'Observational Doc', blurb: 'Interview, archive and vérité, honestly paced.', icon: <BookOpen size={18} />, accent: '#5BC8C8', type: 'documentary',
    tags: ['documentary', 'interview', '8 min'], settings: { format: '16:9', durationSec: 480, style: 'Documentary', fps: 25 },
    idea: { genre: 'documentary', tone: 'measured, humane', theme: 'who is allowed to tell this story', pacing: 'patient, long takes', visualStyle: 'available light, handheld, unposed' } },
  { id: 'social-vertical', name: 'Vertical Social Cut', blurb: 'Hook first, captions burned in, 9:16.', icon: <Share2 size={18} />, accent: '#C58BE9', type: 'social-short',
    tags: ['vertical', '45s', 'captions'], settings: { format: '9:16', durationSec: 45, style: 'Cinematic', fps: 30 },
    idea: { genre: 'social short', tone: 'urgent, direct', theme: 'one idea, stated plainly', pacing: 'hook in 1.5 seconds', visualStyle: 'centre-weighted, high contrast, big type' }, workflow: 'social-cut' },
  { id: 'sci-fi-teaser', name: 'Sci-Fi Teaser', blurb: 'World first, plot later. Sixty seconds of atmosphere.', icon: <Film size={18} />, accent: '#63A9E9', type: 'trailer',
    tags: ['sci-fi', 'teaser', '60s'], settings: { format: '2.39:1', durationSec: 60, style: 'Sci-Fi', fps: 24 },
    idea: { genre: 'science fiction', tone: 'awe, unease', theme: 'a system that has preferences', pacing: 'slow build to a stop, then two images', visualStyle: 'cold industrial palette, atmospheric haze' }, workflow: 'storyboard-only' },
  { id: 'edit-own', name: 'Edit Your Own Footage', blurb: 'Skip generation, open the timeline and cut.', icon: <Video size={18} />, accent: '#91897D', type: 'new-video',
    tags: ['editor', 'import'], settings: { format: '16:9', durationSec: 120, style: 'Cinematic', fps: 30 } , idea: {} },
  { id: 'automation', name: 'Unattended Pipeline', blurb: 'Node graph from idea to export with review gates.', icon: <Workflow size={18} />, accent: '#9AA7E9', type: 'custom',
    tags: ['automation', 'review gates'], settings: { format: '16:9', durationSec: 120, style: 'Cinematic', fps: 24 }, idea: {}, workflow: 'full-film' }
];

export function TemplatesScreen() {
  const router = useRouter();
  const toast = useApp(s => s.toast);
  const [modal, setModal] = React.useState<{ open: boolean; type: ProjectType }>({ open: false, type: 'short-film' });

  const use = async (t: Template) => {
    if (t.id === 'automation') { router.push('/automation'); return; }
    if (t.type === 'new-video') { setModal({ open: true, type: 'new-video' }); return; }
    try {
      const p = await post<{ id: string }>('/api/projects', {
        name: t.name, type: t.type, description: t.blurb, tags: t.tags,
        settings: t.settings as never, idea: t.idea
      });
      if (t.workflow) {
        await post('/api/automations', { name: `${t.name} pipeline`, template: t.workflow, projectId: p.id, requireApproval: true, maxCostCredits: 600 })
          .catch(() => toast({ level: 'warn', title: 'Project created but the workflow template failed to attach' }));
      }
      toast({ level: 'success', title: `"${t.name}" created`, body: t.idea.genre ? 'The idea fields are pre-filled — review them in the Idea stage.' : undefined });
      router.push(`/project/${p.id}?stage=idea`);
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <div className="scroll-thin relative h-full overflow-y-auto">
      <div className="ambient" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] bg-vignette opacity-60" />
      <div className="relative mx-auto w-full max-w-[1240px] px-6 py-8 lg:px-10">
        <header className="mb-6">
          <h1 className="text-[24px] font-semibold tracking-tight text-ink">Templates</h1>
          <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-ink2">
            Starting points with the project type, format, style and idea fields already set. Each one creates a real
            project — nothing is locked, and every field stays editable.
          </p>
        </header>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}>
              <Card className="group flex h-full flex-col p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105"
                    style={{ borderColor: `${t.accent}33`, background: `linear-gradient(180deg, ${t.accent}1A, transparent)`, color: t.accent }}>{t.icon}</span>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-[13.5px] font-semibold text-ink">{t.name}</h3>
                    <p className="mt-0.5 text-[11.5px] leading-snug text-ink2">{t.blurb}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {t.tags.map(tag => <Badge key={tag} tone="mut">{tag}</Badge>)}
                  {t.workflow && <Badge tone="accent" className="gap-1"><Sparkles size={9} />{t.workflow.replace(/-/g, ' ')}</Badge>}
                </div>
                <dl className="mt-3 space-y-1 border-t border-line-soft pt-3 text-[10.5px]">
                  <div className="flex justify-between gap-3"><dt className="text-ink3">Format</dt><dd className="text-ink2">{t.settings.format} · {t.settings.fps}fps</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-ink3">Duration</dt><dd className="text-ink2">{t.settings.durationSec}s</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-ink3">Style</dt><dd className="text-ink2">{t.settings.style}</dd></div>
                </dl>
                <div className="mt-auto flex items-center gap-2 pt-4">
                  <Button size="sm" variant="primary" className="flex-1" onClick={() => void use(t)}>
                    Use template<ArrowRight size={12} />
                  </Button>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
        <p className={cx('mt-8 rounded-lg border border-line-soft bg-well2 px-4 py-3 text-[11.5px] leading-relaxed text-ink3')}>
          Templates are just presets for the project creation payload — the same fields you would set by hand.
          Add your own by editing <code className="mono text-ink2">src/components/home/TemplatesScreen.tsx</code>.
        </p>
      </div>
      <NewProjectModal open={modal.open} type={modal.type} onClose={() => setModal(m => ({ ...m, open: false }))} />
    </div>
  );
}
