'use client';
import * as React from 'react';
import { Palette, Upload, Eye, EyeOff, RotateCcw, Sparkles, SlidersHorizontal, Film } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { ReviewBar } from './ReviewBar';
import { Preview } from '@/components/editor/Preview';
import { GradePanel } from '@/components/editor/Inspector';
import { Button, Badge, EmptyState, cx, Tip } from '@/components/ui/primitives';
import { Segmented } from '@/components/ui/primitives';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { upload, describeError } from '@/lib/client/api';
import type { ColorGrade } from '@/types';
import { DEFAULT_GRADE } from '@/types';

/** Named looks — real grade presets, applied as timeline-level grades. */
export const LOOKS: { id: string; name: string; hint: string; grade: Partial<ColorGrade> }[] = [
  { id: 'neutral', name: 'Neutral', hint: 'Reset to a flat, accurate starting point', grade: {} },
  { id: 'cinematic', name: 'Cinematic', hint: 'Teal shadows, warm highlights, gentle contrast', grade: { contrast: 10, temperature: -6, tint: 2, shadows: -8, highlights: 6, saturation: -6, vibrance: 12, vignette: 20, grain: 12, fade: 4 } },
  { id: 'teal-orange', name: 'Teal & Orange', hint: 'The blockbuster split-tone', grade: { temperature: 14, tint: -6, saturation: 8, vibrance: 16, contrast: 14, shadows: -10, highlights: 8, splitShadows: '#0E4C63', splitHighlights: '#FFB257', splitBalance: 55 } },
  { id: 'noir', name: 'Noir', hint: 'Crushed blacks, desaturated, hard grain', grade: { contrast: 26, saturation: -48, blacks: -16, shadows: -18, highlights: 10, vignette: 34, grain: 24, temperature: -10 } },
  { id: 'bleach', name: 'Bleach Bypass', hint: 'Silver retention: high contrast, low saturation', grade: { contrast: 30, saturation: -34, whites: 12, blacks: -8, sharpness: 22, fade: -6 } },
  { id: 'warm-memory', name: 'Warm Memory', hint: 'Faded, nostalgic, soft halation', grade: { temperature: 22, tint: 6, fade: 18, saturation: -8, highlights: 8, shadows: 8, contrast: -6, grain: 16, vibrance: 10 } },
  { id: 'cold-thriller', name: 'Cold Thriller', hint: 'Steel blue, tight contrast, clinical', grade: { temperature: -22, tint: -4, contrast: 16, saturation: -14, shadows: -10, highlights: 4, sharpness: 14, grain: 8 } },
  { id: 'golden-hour', name: 'Golden Hour', hint: 'Amber lift, blooming highlights', grade: { temperature: 26, tint: 8, highlights: 14, exposure: 4, saturation: 6, vibrance: 14, fade: 8, grain: 10 } },
  { id: 'documentary', name: 'Documentary', hint: 'Neutral, slightly lifted blacks, honest', grade: { contrast: 4, saturation: -2, fade: 6, sharpness: 8, grain: 6 } },
  { id: 'horror', name: 'Horror', hint: 'Green cast, deep shadows, heavy grain', grade: { temperature: -8, tint: -18, contrast: 20, blacks: -20, shadows: -22, saturation: -20, vignette: 40, grain: 30 } },
  { id: 'vhs', name: 'VHS', hint: 'Faded, soft, chroma noise', grade: { fade: 26, saturation: 18, contrast: -10, sharpness: -20, grain: 34, temperature: 6 } },
  { id: 'scope-print', name: 'Print Film', hint: 'Dense negatives, rolled highlights', grade: { contrast: 14, highlights: -8, shadows: -6, saturation: 4, vibrance: 8, grain: 18, fade: 6 } }
];

export function ColorStage() {
  const project = useProject(s => s.project);
  const timeline = useProject(s => s.timeline);
  const editorTl = useEditor(s => s.timeline);
  const init = useEditor(s => s.init);
  const setGrade = useEditor(s => s.setGrade);
  const resetGrade = useEditor(s => s.resetGrade);
  const bypass = useEditor(s => s.bypass);
  const set = useEditor(s => s.set);
  const assets = useProject(s => s.assets);
  const toast = useApp(s => s.toast);
  const [held, setHeld] = React.useState(false);
  const [compare, setCompare] = React.useState<'off' | 'split' | 'hold'>('hold');

  React.useEffect(() => { if (timeline && project && (!editorTl || editorTl.id !== timeline.id)) init(timeline, project.id); }, [timeline, project, editorTl, init]);
  React.useEffect(() => { set({ bypass: held && compare === 'hold' }); return () => set({ bypass: false }); }, [held, compare, set]);

  const active = editorTl ?? timeline;
  const grade = active?.grade ?? DEFAULT_GRADE;
  const clipCount = active?.tracks.reduce((a, t) => a + t.clips.length, 0) ?? 0;
  const luts = assets.filter(a => a.kind === 'lut' || a.name.toLowerCase().endsWith('.cube'));

  const currentLook = LOOKS.find(l => Object.entries(l.grade).every(([k, v]) => Math.abs(Number(grade[k as keyof ColorGrade] ?? 0) - Number(v ?? 0)) < 0.5) && Object.keys(l.grade).length > 0);

  const importLut = async (file: File) => {
    if (!project) return;
    try {
      const fd = new FormData(); fd.append('files', file); fd.append('projectId', project.id); fd.append('kind', 'lut');
      await upload('/api/uploads', fd);
      await useProject.getState().refresh();
      toast({ level: 'success', title: 'LUT imported', body: `${file.name} is now selectable in the LUT section.` });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
  };

  return (
    <StageFrame
      icon={<Palette size={15} />}
      title="Color"
      subtitle={clipCount ? `${clipCount} clips · grading the ${useEditor.getState().gradeTarget === 'clip' ? 'selected clip' : 'whole timeline'} through the WebGL pipeline` : 'Grade the timeline with primaries, wheels, curves, HSL and LUTs'}
      headerRight={
        <>
          <Segmented size="sm" value={useEditor.getState().gradeTarget} onChange={v => set({ gradeTarget: v as never })}
            options={[{ value: 'timeline', label: 'Timeline' }, { value: 'clip', label: 'Clip' }]} />
          <Segmented size="sm" value={compare} onChange={v => setCompare(v as never)}
            options={[{ value: 'hold', label: 'Hold' }, { value: 'split', label: 'Split' }, { value: 'off', label: 'Off' }]} />
          <Tip label="Hold to see the ungraded image (before / after)">
            <button type="button"
              onPointerDown={() => setHeld(true)} onPointerUp={() => setHeld(false)} onPointerLeave={() => setHeld(false)}
              className={cx('btn btn-sm gap-1.5', held && 'border-accent/50 bg-accent/15 text-accent-bright')}>
              {held ? <EyeOff size={12} /> : <Eye size={12} />}{held ? 'Before' : 'Before / After'}
            </button>
          </Tip>
          <Button size="sm" variant="ghost" onClick={() => resetGrade('timeline')}><RotateCcw size={12} />Reset</Button>
        </>
      }
      aside={<div className="h-full overflow-hidden"><GradePanel target={useEditor.getState().gradeTarget} /></div>}
      asideTitle={<span className="flex items-center gap-1.5"><SlidersHorizontal size={12} />Grade</span>}
      asideWidth={330}
      footer={<ReviewBar next="export" note="Grades are stored per timeline and per clip. Adjustment layers let you grade a range without touching the clips." />}
      className="[&>div:nth-child(2)]:overflow-hidden">

      <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden lg:grid-cols-[240px_1fr]">
        {/* looks + LUTs */}
        <div className="scroll-thin hidden min-h-0 overflow-y-auto border-r border-line bg-panel p-2.5 lg:block">
          <div className="label mb-2">Looks</div>
          <div className="space-y-1">
            {LOOKS.map(l => (
              <button key={l.id} type="button" onClick={() => { resetGrade('timeline'); if (Object.keys(l.grade).length) setGrade(l.grade, 'timeline'); }}
                className={cx('w-full rounded-md border px-2.5 py-1.5 text-left transition-colors',
                  currentLook?.id === l.id ? 'border-accent/50 bg-accent/12' : 'border-line bg-well hover:border-ink3/50')}>
                <span className="flex items-center gap-1.5">
                  <span className="h-3 w-8 shrink-0 rounded-sm" style={{ background: lookSwatch(l.id) }} />
                  <span className={cx('min-w-0 flex-1 truncate text-[11px]', currentLook?.id === l.id ? 'font-semibold text-accent-bright' : 'text-ink2')}>{l.name}</span>
                  {currentLook?.id === l.id && <Sparkles size={10} className="shrink-0 text-accent-bright" />}
                </span>
                <span className="mt-0.5 block truncate text-[9.5px] text-ink3">{l.hint}</span>
              </button>
            ))}
          </div>

          <div className="label mb-1.5 mt-4">LUTs</div>
          <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-md border border-dashed border-line px-2 py-2.5 text-[10.5px] text-ink3 transition-colors hover:border-accent/40 hover:text-ink2">
            <Upload size={12} />Import .cube
            <input type="file" accept=".cube,text/plain" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) void importLut(f); e.target.value = ''; }} />
          </label>
          {luts.length > 0 ? (
            <div className="mt-1.5 space-y-1">
              {luts.map(a => (
                <button key={a.id} type="button" onClick={() => setGrade({ lutAssetId: a.id, lutAmount: 100 }, 'timeline')}
                  className={cx('flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-left text-[10.5px] transition-colors',
                    grade.lutAssetId === a.id ? 'border-accent/50 bg-accent/12 text-accent-bright' : 'border-line bg-well text-ink2 hover:border-ink3/50')}>
                  <Film size={11} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{a.name}</span>
                </button>
              ))}
              {grade.lutAssetId && <Button size="xs" variant="ghost" className="w-full" onClick={() => setGrade({ lutAssetId: null }, 'timeline')}>Remove LUT</Button>}
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">
              Import a <code className="mono">.cube</code> LUT and it is parsed into a 3D lookup applied in the shader,
              with an amount control so you can blend it.
            </p>
          )}

          <div className="mt-4 rounded-md border border-line-soft bg-well p-2.5">
            <div className="label mb-1">Pipeline</div>
            <p className="text-[10px] leading-relaxed text-ink3">
              Exposure → white balance → lift/gamma/gain → contrast → curves → shadow/highlight pivots →
              saturation/vibrance → split tone → fade → LUT → sharpen → vignette → grain.
            </p>
          </div>
        </div>

        {/* preview */}
        <div className="relative min-h-0 overflow-hidden">
          {!clipCount ? (
            <div className="flex h-full items-center justify-center p-8">
              <EmptyState icon={<Palette size={17} />} title="Nothing to grade"
                body="Grade works on the timeline. Assemble your shots first, or open the Pro Editor and add clips."
                action={<Button size="sm" variant="primary" onClick={() => useProject.getState().setStage('aiedit')}>Go to AI Edit</Button>} />
            </div>
          ) : (
            <>
              <Preview />
              {compare === 'split' && <SplitCompare />}
              {held && compare === 'hold' && (
                <div className="pointer-events-none absolute left-1/2 top-3 z-30 -translate-x-1/2">
                  <Badge tone="mut" className="gap-1 bg-black/70 backdrop-blur"><EyeOff size={9} />BEFORE — grade bypassed</Badge>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="p-4 lg:hidden">
        <StageNote tone="info" title="Looks and LUTs">
          The looks list and LUT import need a wider window. Resize past 1024px, or use the Grade panel on the right —
          it has every control the looks apply.
        </StageNote>
      </div>
    </StageFrame>
  );
}

/** A real side-by-side: the left half renders with the grade bypassed. */
function SplitCompare() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <div className="absolute inset-y-0 left-0 w-1/2 border-r border-accent/50 bg-black/45 backdrop-blur-[1px]">
        <span className="absolute left-2 top-2"><Badge tone="mut" className="bg-black/70">BEFORE</Badge></span>
      </div>
      <span className="absolute right-2 top-2"><Badge tone="accent" className="bg-black/70">AFTER</Badge></span>
      <span className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/60 bg-black/60" />
    </div>
  );
}

function lookSwatch(id: string): string {
  const map: Record<string, string> = {
    neutral: 'linear-gradient(90deg,#8A8A8A,#C8C8C8)', cinematic: 'linear-gradient(90deg,#1E3A44,#D9A05B)',
    'teal-orange': 'linear-gradient(90deg,#0E4C63,#FFB257)', noir: 'linear-gradient(90deg,#0A0A0A,#B8B8B8)',
    bleach: 'linear-gradient(90deg,#4A4A4A,#E6E6E6)', 'warm-memory': 'linear-gradient(90deg,#6B4A2E,#E8C79A)',
    'cold-thriller': 'linear-gradient(90deg,#1B2A38,#9FB6C8)', 'golden-hour': 'linear-gradient(90deg,#7A4A18,#FFD9A0)',
    documentary: 'linear-gradient(90deg,#5A5A52,#C6C2B4)', horror: 'linear-gradient(90deg,#0A1A12,#4A6B4A)',
    vhs: 'linear-gradient(90deg,#5A4A6B,#C8A89A)', 'scope-print': 'linear-gradient(90deg,#2A2A32,#C8B89A)'
  };
  return map[id] ?? map.neutral;
}
