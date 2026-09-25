'use client';
import * as React from 'react';
import { SlidersHorizontal, Sparkles, Palette, Gauge, Volume2, Type, Layers, RotateCcw, Plus, Diamond, Trash2 } from 'lucide-react';
import { cx, Button, Badge, Tip, Collapsible, PrevisBadge } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Slider, Toggle, ColorInput } from '@/components/ui/inputs';
import { useEditor, useSelectedClip } from '@/store/editor';
import { useProject } from '@/store/project';
import { addEffect, chromaKey, freezeFrame, setKeyframe, setSpeedRamp, sampleKeyframes } from '@/lib/timeline/ops';
import { DEFAULT_GRADE } from '@/types';
import type { Clip, TransitionKind } from '@/types';

const EFFECTS: { type: string; name: string; params: Record<string, number | string> }[] = [
  { type: 'blur', name: 'Gaussian Blur', params: { radius: 8 } },
  { type: 'sharpen', name: 'Sharpen', params: { amount: 0.6 } },
  { type: 'grayscale', name: 'Black & White', params: {} },
  { type: 'sepia', name: 'Sepia', params: {} },
  { type: 'hue-shift', name: 'Hue Shift', params: { degrees: 30 } },
  { type: 'brightness', name: 'Brightness', params: { amount: 0.2 } },
  { type: 'contrast', name: 'Contrast', params: { amount: 0.3 } },
  { type: 'saturate', name: 'Saturate', params: { amount: 0.4 } },
  { type: 'invert', name: 'Invert', params: {} },
  { type: 'speed-ramp', name: 'Speed Ramp', params: { from: 1, to: 1.5 } },
  { type: 'chroma-key', name: 'Chroma Key', params: { color: '#00FF00', tolerance: 0.4, spill: 0.3 } },
  { type: 'motion-track', name: 'Motion Track', params: { x: 0, y: 0 } },
  { type: 'mask', name: 'Mask', params: { shape: 'rect', feather: 20 } }
];
const TRANSITIONS: TransitionKind[] = ['none', 'cut', 'crossfade', 'dip-black', 'dip-white', 'wipe-left', 'wipe-right', 'wipe-up', 'slide', 'zoom', 'blur', 'light-leak'];

/** Clip / track inspector: transform, speed, effects, keyframes, audio, text, grade. */
export function Inspector() {
  const tab = useEditor(s => s.inspector);
  const set = useEditor(s => s.set);
  const clip = useSelectedClip();
  const editorTl = useEditor(s => s.timeline);
  const projectTl = useProject(s => s.timeline);
  const tl = editorTl ?? projectTl;
  const apply = useEditor(s => s.apply);
  const assets = useProject(s => s.assets);

  const track = React.useMemo(() => {
    if (!tl) return null;
    if (clip) return tl.tracks.find(t => t.clips.some(c => c.id === clip.id)) ?? null;
    return tl.tracks.find(t => t.id === useEditor.getState().activeTrack) ?? tl.tracks[0] ?? null;
  }, [tl, clip]);

  const patch = (p: Partial<Clip>) => { if (clip) apply([{ op: 'updateClip', clipId: clip.id, patch: p }], { coalesce: true }); };
  const asset = clip?.assetId ? assets.find(a => a.id === clip.assetId) ?? null : null;

  const tabs = [
    { id: 'clip', label: 'Clip', icon: <SlidersHorizontal size={12} /> },
    { id: 'speed', label: 'Speed', icon: <Gauge size={12} /> },
    { id: 'effects', label: 'Effects', icon: <Sparkles size={12} /> },
    { id: 'color', label: 'Color', icon: <Palette size={12} /> },
    { id: 'audio', label: 'Audio', icon: <Volume2 size={12} /> },
    { id: 'text', label: 'Text', icon: <Type size={12} /> },
    { id: 'track', label: 'Track', icon: <Layers size={12} /> }
  ] as const;

  return (
    <div className="flex h-full min-h-0 flex-col border-l border-line bg-panel">
      <div className="scroll-thin flex shrink-0 gap-0.5 overflow-x-auto border-b border-line-soft px-1.5 py-1.5 no-scrollbar">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => set({ inspector: t.id as never })}
            className={cx('flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors',
              tab === t.id ? 'bg-accent/12 text-accent-bright' : 'text-ink3 hover:bg-white/[0.04] hover:text-ink2')}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        {!clip && tab !== 'track' && (
          <div className="p-4 text-center">
            <p className="text-[11.5px] text-ink2">No clip selected</p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink3">Click a clip on the timeline, or switch to the Track tab to edit track-level settings.</p>
          </div>
        )}

        {clip && tab === 'clip' && (
          <div className="space-y-3 p-3">
            <div>
              <div className="flex items-center gap-2">
                <Badge tone={clip.kind === 'audio' ? 'ok' : 'accent'}>{clip.kind}</Badge>
                {asset?.demo && <PrevisBadge />}
                {clip.locked && <Badge tone="mut">locked</Badge>}
              </div>
              <TextInput className="mt-2" value={clip.name} onChange={e => patch({ name: e.target.value })} />
              {asset?.prompt && <p className="mt-1.5 line-clamp-3 text-[10px] leading-relaxed text-ink3">{asset.prompt}</p>}
            </div>

            <Collapsible title="Timing">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Start (s)"><TextInput type="number" step={0.01} value={round(clip.start)} onChange={e => patch({ start: Math.max(0, Number(e.target.value)) })} /></Field>
                <Field label="Duration (s)"><TextInput type="number" step={0.01} min={0.04} value={round(clip.duration)} onChange={e => patch({ duration: Math.max(0.04, Number(e.target.value)) })} /></Field>
                <Field label="Source in"><TextInput type="number" step={0.01} value={round(clip.in)} onChange={e => patch({ in: Math.max(0, Number(e.target.value)) })} /></Field>
                <Field label="Source out"><TextInput type="number" step={0.01} value={round(clip.out)} onChange={e => patch({ out: Math.max(clip.in + 0.04, Number(e.target.value)) })} /></Field>
              </div>
              <div className="mt-2 flex gap-1.5">
                <Button size="xs" variant="ghost" className="flex-1" onClick={() => { if (clip) apply([{ op: 'splitClip', clipId: clip.id, at: useEditor.getState().playhead }]); }}>Split at playhead</Button>
                <Button size="xs" variant="ghost" onClick={() => patch({ start: 0 })}>To 0</Button>
              </div>
            </Collapsible>

            <Collapsible title="Transform">
              <Slider label="Position X" bipolar min={-1} max={1} step={0.005} value={clip.transform?.x ?? 0} onChange={v => patch({ transform: { ...clip.transform, x: v } })} format={v => v.toFixed(3)} />
              <Slider label="Position Y" bipolar min={-1} max={1} step={0.005} value={clip.transform?.y ?? 0} onChange={v => patch({ transform: { ...clip.transform, y: v } })} format={v => v.toFixed(3)} />
              <Slider label="Scale" min={0.05} max={4} step={0.01} value={clip.transform?.scale ?? 1} onChange={v => patch({ transform: { ...clip.transform, scale: v } })} format={v => `${(v * 100).toFixed(0)}%`} />
              <Slider label="Rotation" bipolar min={-180} max={180} step={0.5} value={clip.transform?.rotation ?? 0} onChange={v => patch({ transform: { ...clip.transform, rotation: v } })} unit="°" />
              <Slider label="Opacity" min={0} max={100} step={1} value={(clip.opacity ?? 1) * 100} onChange={v => patch({ opacity: v / 100 })} unit="%" />
              <div className="mt-2 grid grid-cols-4 gap-1.5">
                {(['l', 'r', 't', 'b'] as const).map(k => (
                  <Field key={k} label={`Crop ${k.toUpperCase()}`}>
                    <TextInput type="number" step={0.01} min={0} max={0.95} value={round(clip.transform?.crop?.[k] ?? 0)}
                      onChange={e => { const c: Record<'l'|'r'|'t'|'b', number> = { l: 0, r: 0, t: 0, b: 0 }; Object.assign(c, clip.transform?.crop ?? {}); c[k] = Math.max(0, Math.min(0.95, Number(e.target.value))); patch({ transform: { ...clip.transform, crop: { l: c.l, r: c.r, t: c.t, b: c.b } } }); }} />
                  </Field>
                ))}
              </div>
              <div className="mt-2 space-y-1.5">
                <Toggle checked={Boolean(clip.transform?.flipH)} onChange={v => patch({ transform: { ...clip.transform, flipH: v } })} label="Flip horizontal" />
                <Toggle checked={Boolean(clip.transform?.flipV)} onChange={v => patch({ transform: { ...clip.transform, flipV: v } })} label="Flip vertical" />
              </div>
              <Field label="Blend mode" className="mt-2">
                <Select value={clip.blend ?? 'normal'} onChange={v => patch({ blend: v as Clip['blend'] })}
                  options={['normal', 'multiply', 'screen', 'overlay', 'soft-light', 'add', 'difference']} />
              </Field>
              <Button size="xs" variant="ghost" className="mt-2 w-full" onClick={() => patch({ transform: { ...clip.transform, x: 0, y: 0, scale: 1, rotation: 0, crop: { l: 0, r: 0, t: 0, b: 0 }, flipH: false, flipV: false }, opacity: 1 })}>
                <RotateCcw size={11} />Reset transform
              </Button>
            </Collapsible>

            <Collapsible title="Transitions" defaultOpen={false}>
              <div className="space-y-2">
                <Field label="Transition in"><Select value={clip.transitionIn} onChange={v => patch({ transitionIn: v as TransitionKind })} options={TRANSITIONS} /></Field>
                <Field label="Transition out"><Select value={clip.transitionOut} onChange={v => patch({ transitionOut: v as TransitionKind })} options={TRANSITIONS} /></Field>
                <Slider label="Duration" min={0.05} max={3} step={0.05} value={clip.transitionDur} onChange={v => patch({ transitionDur: v })} unit="s" />
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Fade in"><TextInput type="number" step={0.05} min={0} value={round(clip.fadeIn)} onChange={e => patch({ fadeIn: Math.max(0, Number(e.target.value)) })} /></Field>
                  <Field label="Fade out"><TextInput type="number" step={0.05} min={0} value={round(clip.fadeOut)} onChange={e => patch({ fadeOut: Math.max(0, Number(e.target.value)) })} /></Field>
                </div>
              </div>
            </Collapsible>

            <Collapsible title="Freeze frame" defaultOpen={false}>
              <p className="mb-2 text-[10.5px] leading-relaxed text-ink3">Hold a frame for a duration. Used for emphasis beats and to cover a jump cut.</p>
              {(clip.freeze ?? []).map((f, i) => (
                <div key={i} className="mb-1.5 flex items-center gap-2 rounded-md border border-line-soft bg-well px-2 py-1.5 text-[10.5px]">
                  <span className="text-ink3">at {f.at.toFixed(2)}s</span>
                  <span className="text-ink2 tnum">{f.dur.toFixed(2)}s</span>
                  <div className="flex-1" />
                  <button type="button" className="icon-btn h-5 w-5 hover:text-bad" onClick={() => patch({ freeze: (clip.freeze ?? []).filter((_, j) => j !== i) })}><Trash2 size={10} /></button>
                </div>
              ))}
              <Button size="xs" variant="ghost" className="w-full" onClick={() => { if (clip) apply(freezeFrame(useEditor.getState().timeline!, clip.id, useEditor.getState().playhead, 1.5)); }}>
                <Plus size={11} />Freeze at playhead (1.5s)
              </Button>
            </Collapsible>

            <Collapsible title="Clip state" defaultOpen={false}>
              <div className="space-y-1.5">
                <Toggle checked={clip.locked} onChange={v => patch({ locked: v })} label="Locked" hint="Prevents accidental moves and trims." />
                <Toggle checked={clip.muted} onChange={v => patch({ muted: v })} label="Muted / disabled" />
              </div>
            </Collapsible>
          </div>
        )}

        {clip && tab === 'speed' && (
          <div className="space-y-3 p-3">
            <Slider label="Speed" min={0.1} max={8} step={0.01} value={clip.speed}
              onChange={v => apply([{ op: 'retime', clipId: clip.id, speed: v }], { coalesce: true })} format={v => `${v.toFixed(2)}×`} />
            <div className="flex flex-wrap gap-1.5">
              {[0.25, 0.5, 1, 1.5, 2, 4, 8].map(s => (
                <Button key={s} size="xs" variant={clip.speed === s ? 'primary' : 'ghost'} onClick={() => apply([{ op: 'retime', clipId: clip.id, speed: s }])}>{s}×</Button>
              ))}
            </div>
            <div className="rounded-md border border-line-soft bg-well p-2.5 text-[10.5px] leading-relaxed text-ink3">
              Retime keeps the source in/out intact and changes the clip's timeline duration. New length:
              <span className="mono ml-1 text-ink2">{((clip.out - clip.in) / Math.max(0.05, clip.speed)).toFixed(2)}s</span>
            </div>
            <Collapsible title="Speed ramp">
              <RampEditor clip={clip} />
            </Collapsible>
          </div>
        )}

        {clip && tab === 'effects' && (
          <div className="space-y-3 p-3">
            <div>
              <div className="label mb-1.5">Applied</div>
              {!clip.effects.length && <p className="rounded-md border border-dashed border-line px-3 py-3 text-center text-[10.5px] text-ink3">No effects on this clip.</p>}
              <div className="space-y-1.5">
                {clip.effects.map(fx => (
                  <div key={fx.id} className="rounded-md border border-line-soft bg-well p-2">
                    <div className="flex items-center gap-2">
                      <Toggle checked={fx.enabled} label={<span className="text-[11.5px] text-ink">{fx.name}</span>}
                        onChange={v => patch({ effects: clip.effects.map(e => e.id === fx.id ? { ...e, enabled: v } : e) })} />
                      <div className="flex-1" />
                      <button type="button" className="icon-btn h-5 w-5 hover:text-bad" onClick={() => patch({ effects: clip.effects.filter(e => e.id !== fx.id) })}><Trash2 size={10} /></button>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      <Slider label="Intensity" min={0} max={2} step={0.01} value={fx.intensity}
                        onChange={v => patch({ effects: clip.effects.map(e => e.id === fx.id ? { ...e, intensity: v } : e) })} format={v => `${Math.round(v * 100)}%`} />
                      {Object.entries(fx.params).map(([k, v]) => typeof v === 'number' ? (
                        <Slider key={k} label={k} bipolar={k === 'degrees' || k.startsWith('x') || k.startsWith('y')} min={k === 'degrees' ? -180 : k === 'radius' ? 0 : -1}
                          max={k === 'degrees' ? 180 : k === 'radius' ? 40 : k === 'tolerance' || k === 'spill' ? 1 : 4} step={k === 'radius' ? 0.5 : 0.01} value={v}
                          onChange={nv => patch({ effects: clip.effects.map(e => e.id === fx.id ? { ...e, params: { ...e.params, [k]: nv } } : e) })} />
                      ) : k === 'color' ? (
                        <ColorInput key={k} label={k} value={String(v)} onChange={nv => patch({ effects: clip.effects.map(e => e.id === fx.id ? { ...e, params: { ...e.params, [k]: nv } } : e) })} />
                      ) : (
                        <Field key={k} label={k}><TextInput value={String(v)} onChange={e => patch({ effects: clip.effects.map(e2 => e2.id === fx.id ? { ...e2, params: { ...e2.params, [k]: e.target.value } } : e2) })} /></Field>
                      ))}
                      {fx.type === 'chroma-key' && (
                        <Button size="xs" variant="ghost" className="w-full" onClick={() => patch({ effects: clip.effects.map(e => e.id === fx.id ? chromaKey({ ...clip, effects: clip.effects }, String(fx.params.color ?? '#00FF00'), Number(fx.params.tolerance ?? 0.4)).effects.find(x => x.id === fx.id)! : e) })}>
                          Re-key with current colour
                        </Button>
                      )}
                      <KeyframeRow clip={clip} fxId={fx.id} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="label mb-1.5">Add effect</div>
              <div className="grid grid-cols-2 gap-1.5">
                {EFFECTS.map(fx => (
                  <Button key={fx.type} size="xs" variant="ghost" disabled={clip.effects.some(e => e.type === fx.type)}
                    onClick={() => patch({ effects: addEffect(clip, fx.type, fx.name, fx.params).effects })}>
                    <Plus size={10} />{fx.name}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        )}

        {clip && tab === 'color' && <GradePanel target="clip" clip={clip} />}
        {tab === 'color' && !clip && <GradePanel target="timeline" />}

        {clip && tab === 'audio' && (
          <div className="space-y-3 p-3">
            <Slider label="Clip volume" min={0} max={200} step={1} value={clip.volume * 100} onChange={v => patch({ volume: v / 100 })} unit="%" />
            <Slider label="Pan" bipolar min={-1} max={1} step={0.01} value={clip.pan} onChange={v => patch({ pan: v })} format={v => v === 0 ? 'C' : v < 0 ? `L${Math.round(-v * 100)}` : `R${Math.round(v * 100)}`} />
            <Slider label="Fade in" min={0} max={4} step={0.05} value={clip.fadeIn} onChange={v => patch({ fadeIn: v })} unit="s" />
            <Slider label="Fade out" min={0} max={4} step={0.05} value={clip.fadeOut} onChange={v => patch({ fadeOut: v })} unit="s" />
            <Toggle checked={clip.muted} onChange={v => patch({ muted: v })} label="Mute this clip" />
            {track && (
              <div className="rounded-md border border-line-soft bg-well p-2.5">
                <div className="label mb-1.5">Track {track.name}</div>
                <Slider label="Track volume" min={0} max={200} step={1} value={track.volume * 100} onChange={v => patchTrack(track.id, { volume: v / 100 })} unit="%" />
                <Slider label="Track pan" bipolar min={-1} max={1} step={0.01} value={track.pan} onChange={v => patchTrack(track.id, { pan: v })} />
              </div>
            )}
            <div className="rounded-md border border-line-soft bg-well p-2.5 text-[10.5px] leading-relaxed text-ink3">
              Mix targets: dialogue −16 LUFS, effects −18, ambience −30, music −24. Stems export separates these buses
              so a mixer can rebalance them later.
            </div>
          </div>
        )}

        {clip && tab === 'text' && (
          <div className="space-y-3 p-3">
            {clip.kind !== 'text' ? (
              <p className="text-[11px] leading-relaxed text-ink3">Select a text clip to edit its content. Add one from the Text panel on the left.</p>
            ) : (
              <>
                <Field label="Content"><TextArea rows={3} value={clip.text?.content ?? ''} onChange={e => patch({ text: { ...(clip.text ?? defaults()), content: e.target.value } })} /></Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Font"><Select value={clip.text?.font ?? 'Inter'} onChange={v => patch({ text: { ...(clip.text ?? defaults()), font: v } })} options={['Inter', 'Georgia', 'Courier', 'Helvetica', 'Impact']} /></Field>
                  <Field label="Align"><Select value={clip.text?.align ?? 'center'} onChange={v => patch({ text: { ...(clip.text ?? defaults()), align: v as never } })} options={['left', 'center', 'right']} /></Field>
                  <Field label="Size"><TextInput type="number" value={clip.text?.size ?? 44} onChange={e => patch({ text: { ...(clip.text ?? defaults()), size: Number(e.target.value) } })} /></Field>
                  <Field label="Vertical position"><TextInput type="number" step={0.01} min={0} max={1} value={clip.text?.y ?? 0.72} onChange={e => patch({ text: { ...(clip.text ?? defaults()), y: Number(e.target.value) } })} /></Field>
                </div>
                <Field label="Colour"><ColorInput value={clip.text?.color ?? 'rgb(var(--ink-rgb))'} onChange={v => patch({ text: { ...(clip.text ?? defaults()), color: v } })} /></Field>
                <Field label="Animation"><Select value={clip.text?.animate ?? 'none'} onChange={v => patch({ text: { ...(clip.text ?? defaults()), animate: v as never } })} options={['none', 'fade', 'rise', 'type']} /></Field>
                <Toggle checked={Boolean(clip.text?.bg)} onChange={v => patch({ text: { ...(clip.text ?? defaults()), bg: v } })} label="Background plate" hint="Improves legibility over busy frames." />
              </>
            )}
          </div>
        )}

        {tab === 'track' && track && (
          <div className="space-y-3 p-3">
            <Field label="Track name"><TextInput value={track.name} onChange={e => patchTrack(track.id, { name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Kind"><Select value={track.kind} onChange={v => patchTrack(track.id, { kind: v as never })} options={['video', 'audio']} /></Field>
              <Field label="Height"><TextInput type="number" min={28} max={220} value={track.height} onChange={e => patchTrack(track.id, { height: Math.max(28, Math.min(220, Number(e.target.value))) })} /></Field>
            </div>
            <div className="space-y-1.5">
              <Toggle checked={track.muted} onChange={v => patchTrack(track.id, { muted: v })} label="Muted" />
              <Toggle checked={track.solo} onChange={v => patchTrack(track.id, { solo: v })} label="Solo" />
              <Toggle checked={track.locked} onChange={v => patchTrack(track.id, { locked: v })} label="Locked" />
              <Toggle checked={track.hidden} onChange={v => patchTrack(track.id, { hidden: v })} label="Hidden" hint="Hidden video tracks are not composited; hidden audio tracks are not mixed." />
            </div>
            {track.kind === 'audio' && (
              <>
                <Slider label="Volume" min={0} max={200} step={1} value={track.volume * 100} onChange={v => patchTrack(track.id, { volume: v / 100 })} unit="%" />
                <Slider label="Pan" bipolar min={-1} max={1} step={0.01} value={track.pan} onChange={v => patchTrack(track.id, { pan: v })} />
              </>
            )}
            <div className="rounded-md border border-line-soft bg-well p-2.5">
              <div className="label mb-1">Clips on this track</div>
              <p className="text-[11px] text-ink2">{track.clips.length} clip(s), {track.clips.reduce((a, c) => a + c.duration, 0).toFixed(1)}s total</p>
            </div>
            <Button size="xs" variant="danger" className="w-full" onClick={() => apply([{ op: 'removeTrack', trackId: track.id }])}>
              <Trash2 size={11} />Delete track
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  function patchTrack(id: string, p: Record<string, unknown>) {
    const t = useEditor.getState().timeline;
    if (!t) return;
    useEditor.setState({ timeline: { ...t, tracks: t.tracks.map(x => x.id === id ? { ...x, ...p } : x) }, dirty: true });
    void useEditor.getState().flush();
  }
}

/* ── grade panel (shared by Color stage and inspector) ───── */
export function GradePanel({ target, clip }: { target: 'timeline' | 'clip'; clip?: Clip | null }) {
  const tl = useEditor(s => s.timeline);
  const setGrade = useEditor(s => s.setGrade);
  const resetGrade = useEditor(s => s.resetGrade);
  const gradeTarget = useEditor(s => s.gradeTarget);
  const set = useEditor(s => s.set);
  const assets = useProject(s => s.assets);
  const grade = (target === 'clip' ? clip?.grade : tl?.grade) ?? DEFAULT_GRADE;
  const [point, setPoint] = React.useState<{ ch: 'rgb' | 'red' | 'green' | 'blue'; i: number } | null>(null);

  const g = (k: keyof typeof DEFAULT_GRADE) => Number(grade[k] ?? 0);
  const setNum = (k: keyof typeof DEFAULT_GRADE, v: number) => setGrade({ [k]: v } as never, target);
  const luts = assets.filter(a => a.kind === 'lut' || a.name.toLowerCase().endsWith('.cube'));

  const primaries = [
    { key: 'basic', label: 'Basic', sliders: [['exposure', 'Exposure'], ['contrast', 'Contrast'], ['saturation', 'Saturation'], ['vibrance', 'Vibrance']] as const },
    { key: 'tone', label: 'Tone', sliders: [['highlights', 'Highlights'], ['shadows', 'Shadows'], ['whites', 'Whites'], ['blacks', 'Blacks'], ['fade', 'Fade']] as const },
    { key: 'balance', label: 'Balance', sliders: [['temperature', 'Temperature'], ['tint', 'Tint']] as const },
    { key: 'finish', label: 'Finish', sliders: [['sharpness', 'Sharpness'], ['vignette', 'Vignette'], ['grain', 'Film grain']] as const }
  ];

  return (
    <div className="space-y-3 p-3">
      {!clip && (
        <div className="flex items-center gap-1.5 rounded-md border border-line-soft bg-well p-1.5">
          <span className="px-1 text-[10.5px] text-ink3">Target</span>
          <Select size="sm" className="flex-1" value={gradeTarget} onChange={v => set({ gradeTarget: v as never })}
            options={[{ value: 'timeline', label: 'Whole timeline' }, { value: 'clip', label: 'Selected clip' }]} />
        </div>
      )}

      {primaries.map(group => (
        <Collapsible key={group.key} title={group.label}>
          <div className="space-y-1.5">
            {group.sliders.map(([k, label]) => (
              <Slider key={k} label={label} bipolar min={-100} max={100} step={1} value={g(k)} onChange={v => setNum(k, v)} onCommit={v => setNum(k, v)} />
            ))}
          </div>
        </Collapsible>
      ))}

      <Collapsible title="Colour wheels" defaultOpen={false}>
        <div className="grid grid-cols-3 gap-2">
          {(['lift', 'gamma', 'gain'] as const).map(wheel => (
            <div key={wheel} className="rounded-md border border-line-soft bg-well p-2">
              <div className="label mb-1.5 text-center capitalize">{wheel}</div>
              <Wheel value={(grade[wheel] ?? [0, 0, 0]) as [number, number, number]}
                onChange={v => setGrade({ [wheel]: v } as never, target)} />
              <Slider className="mt-1.5" bipolar min={-100} max={100} step={1}
                value={((grade[wheel] as number[])[2] ?? 0)} onChange={v => {
                  const cur = (grade[wheel] ?? [0, 0, 0]) as number[];
                  setGrade({ [wheel]: [cur[0], cur[1], v] } as never, target);
                }} />
            </div>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink3">Drag inside a wheel to shift that range's colour; the slider underneath controls its luminance.</p>
      </Collapsible>

      <Collapsible title="Curves" defaultOpen={false}>
        <div className="mb-2 flex gap-1">
          {(['rgb', 'red', 'green', 'blue'] as const).map(ch => (
            <button key={ch} type="button" onClick={() => setPoint(p => ({ ch, i: -1 }))}
              className={cx('flex-1 rounded border px-1.5 py-1 text-[10px] capitalize transition-colors',
                point?.ch === ch ? 'border-accent/50 bg-accent/12 text-accent-bright' : 'border-line bg-well text-ink3 hover:text-ink2')}>
              {ch === 'rgb' ? 'master' : ch}
            </button>
          ))}
        </div>
        <CurveEditor points={(grade.curves?.[(point?.ch ?? 'rgb')] ?? [[0, 0], [1, 1]]) as [number, number][]}
          channel={point?.ch ?? 'rgb'}
          onChange={pts => setGrade({ curves: { ...grade.curves, [point?.ch ?? 'rgb']: pts } } as never, target)} />
      </Collapsible>

      <Collapsible title="LUT" defaultOpen={false}>
        <Field label="LUT asset" hint="Import a .cube file from the Assets page (kind: LUT). Applied after the primary grade.">
          <Select value={grade.lutAssetId ?? ''} placeholder="No LUT" onChange={v => setGrade({ lutAssetId: v || null } as never, target)}
            options={luts.map(a => ({ value: a.id, label: a.name }))} />
        </Field>
        {grade.lutAssetId && <Slider label="LUT amount" min={0} max={100} step={1} value={grade.lutAmount ?? 100} onChange={v => setGrade({ lutAmount: v } as never, target)} unit="%" />}
        {!luts.length && <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">No .cube LUTs in this project yet. Upload one in the Asset Library and it appears here.</p>}
      </Collapsible>

      <Collapsible title="Split toning" defaultOpen={false}>
        <div className="space-y-2">
          <Field label="Shadows"><ColorInput value={grade.splitShadows ?? '#000000'} onChange={v => setGrade({ splitShadows: v } as never, target)} /></Field>
          <Field label="Highlights"><ColorInput value={grade.splitHighlights ?? '#ffffff'} onChange={v => setGrade({ splitHighlights: v } as never, target)} /></Field>
          <Slider label="Balance" bipolar min={-100} max={100} step={1} value={grade.splitBalance ?? 0} onChange={v => setGrade({ splitBalance: v } as never, target)} />
        </div>
      </Collapsible>

      <Button size="xs" variant="ghost" className="w-full" onClick={() => resetGrade(target)}><RotateCcw size={11} />Reset grade</Button>
      {void sampleKeyframes}
    </div>
  );
}

function Wheel({ value, onChange }: { value: [number, number, number]; onChange: (v: [number, number, number]) => void }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [drag, setDrag] = React.useState(false);
  const set = (e: React.PointerEvent | PointerEvent) => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 2 - 1;
    const y = (((e.clientY - r.top) / r.height) * 2 - 1) * -1;
    const len = Math.min(1, Math.hypot(x, y));
    const ang = Math.atan2(y, x);
    // map hue angle to an R/G/B balance, keeping luminance on the slider
    const rC = Math.round(Math.cos(ang) * len * 100);
    const gC = Math.round(Math.sin(ang + 2.094) * len * 100);
    const bC = Math.round(Math.sin(ang + 4.188) * len * 100);
    onChange([rC, gC, bC]);
  };
  React.useEffect(() => {
    if (!drag) return;
    const mv = (e: PointerEvent) => set(e);
    const up = () => setDrag(false);
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, value]);
  const len = Math.hypot(value[0], value[1]) / 100;
  const ang = Math.atan2(value[1], value[0]);
  return (
    <div ref={ref} className="relative mx-auto h-[74px] w-[74px] cursor-crosshair rounded-full"
      style={{ background: 'conic-gradient(from 0deg, #E96A6A, #E0B341, #4CCB8A, #5BC8C8, #63A9E9, #C58BE9, #E96A6A)' }}
      onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag(true); set(e); }}>
      <span className="absolute inset-[16%] rounded-full bg-well" />
      <span className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-black shadow"
        style={{ left: `${50 + Math.cos(ang) * len * 34}%`, top: `${50 - Math.sin(ang) * len * 34}%` }} />
    </div>
  );
}

function CurveEditor({ points, channel, onChange }: { points: [number, number][]; channel: string; onChange: (p: [number, number][]) => void }) {
  const ref = React.useRef<SVGSVGElement>(null);
  const [dragIdx, setDragIdx] = React.useState<number | null>(null);
  const S = 180;
  const toPx = (p: [number, number]) => ({ x: p[0] * S, y: S - p[1] * S });
  const toVal = (x: number, y: number): [number, number] => [Math.max(0, Math.min(1, x / S)), Math.max(0, Math.min(1, 1 - y / S))];
  const path = React.useMemo(() => {
    const sorted = [...points].sort((a, b) => a[0] - b[0]);
    let d = '';
    for (let i = 0; i < sorted.length; i++) {
      const p = toPx(sorted[i]);
      if (i === 0) d += `M${p.x},${p.y}`;
      else {
        const prev = toPx(sorted[i - 1]);
        const cx = (prev.x + p.x) / 2;
        d += ` C${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
      }
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  const colour = channel === 'red' ? '#E96A6A' : channel === 'green' ? '#4CCB8A' : channel === 'blue' ? '#63A9E9' : '#D99A32';

  const addPoint = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const v = toVal(((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S);
    const next = [...points, v].sort((a, b) => a[0] - b[0]);
    onChange(next);
    setDragIdx(next.findIndex(p => p[0] === v[0] && p[1] === v[1]));
  };
  const movePoint = (i: number, e: PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    const v = toVal(((e.clientX - r.left) / r.width) * S, ((e.clientY - r.top) / r.height) * S);
    const next = points.map((p, j) => (j === i ? ([Math.max(i === 0 ? 0 : points[i - 1][0] + 0.001, i === points.length - 1 ? 1 : points[i + 1][0] - 0.001, v[0]), v[1]] as [number, number]) : p)) as [number, number][];
    onChange(next);
  };
  React.useEffect(() => {
    if (dragIdx == null) return;
    const mv = (e: PointerEvent) => movePoint(dragIdx, e);
    const up = () => setDragIdx(null);
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragIdx, points]);

  return (
    <div>
      <svg ref={ref} viewBox={`0 0 ${S} ${S}`} className="w-full cursor-crosshair rounded-md border border-line-soft bg-deep" onClick={addPoint}>
        {[0.25, 0.5, 0.75].map(t => <g key={t}><line x1={t * S} y1={0} x2={t * S} y2={S} stroke="#241F1B" strokeWidth={1} /><line x1={0} y1={t * S} x2={S} y2={t * S} stroke="#241F1B" strokeWidth={1} /></g>)}
        <line x1={0} y1={S} x2={S} y2={0} stroke="#302C27" strokeWidth={1} strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={colour} strokeWidth={2} />
        {points.map((p, i) => {
          const q = toPx(p);
          return <circle key={i} cx={q.x} cy={q.y} r={dragIdx === i ? 6 : 4.5} fill="#0C0B0A" stroke={colour} strokeWidth={2}
            className="cursor-grab" onPointerDown={e => { e.stopPropagation(); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDragIdx(i); }}
            onDoubleClick={e => { e.stopPropagation(); if (i > 0 && i < points.length - 1) onChange(points.filter((_, j) => j !== i)); }} />;
        })}
      </svg>
      <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">Click to add a point · drag to shape · double-click to remove. Input is luminance, output is the mapped value.</p>
    </div>
  );
}

function KeyframeRow({ clip, fxId }: { clip: Clip; fxId: string }) {
  const fx = clip.effects.find(e => e.id === fxId);
  if (!fx) return null;
  const playhead = useEditor(s => s.playhead);
  const params = Object.keys(fx.params).filter(k => typeof fx.params[k] === 'number');
  if (!params.length) return null;
  return (
    <div className="mt-1.5 border-t border-line-soft pt-1.5">
      <div className="label mb-1 flex items-center gap-1"><Diamond size={9} />Keyframes</div>
      {params.map(p => {
        const kfs = fx.keyframes?.[p] ?? [];
        const local = Math.max(0, playhead - clip.start);
        return (
          <div key={p} className="mb-1 flex items-center gap-1.5">
            <span className="w-16 shrink-0 truncate text-[10px] text-ink3">{p}</span>
            <span className="flex flex-1 items-center gap-px">
              {kfs.map((k, i) => <Tip key={i} label={`${k.t.toFixed(2)}s → ${k.v.toFixed(2)}`}><span className="h-1.5 w-1.5 rotate-45 bg-accent" /></Tip>)}
              {!kfs.length && <span className="text-[9.5px] text-ink3">none</span>}
            </span>
            <Tip label={`Keyframe ${p} at playhead`}>
              <button type="button" className="icon-btn h-5 w-5"
                onClick={() => {
                  const v = sampleKeyframes(kfs, local, Number(fx.params[p]));
                  const next = setKeyframe(clip, fxId, p, local, v);
                  useEditor.getState().apply([{ op: 'updateClip', clipId: clip.id, patch: { effects: next.effects } }]);
                }}>
                <Plus size={9} />
              </button>
            </Tip>
          </div>
        );
      })}
    </div>
  );
}

function RampEditor({ clip }: { clip: Clip }) {
  const apply = useEditor(s => s.apply);
  const fx = clip.effects.find(e => e.type === 'speed-ramp');
  const [from, setFrom] = React.useState(Number(fx?.params.from ?? clip.speed));
  const [to, setTo] = React.useState(Number(fx?.params.to ?? clip.speed));
  return (
    <div className="space-y-2">
      <Slider label="From" min={0.1} max={8} step={0.05} value={from} onChange={setFrom} format={v => `${v.toFixed(2)}×`} />
      <Slider label="To" min={0.1} max={8} step={0.05} value={to} onChange={setTo} format={v => `${v.toFixed(2)}×`} />
      <Button size="xs" variant="primary" className="w-full"
        onClick={() => {
          const t = useEditor.getState().timeline;
          if (!t) return;
          apply(setSpeedRamp(t, clip.id, from, to), { label: 'speed ramp' });
        }}>
        Apply ramp
      </Button>
      <p className="text-[10px] leading-relaxed text-ink3">A ramp eases between two speeds across the clip. The timeline duration uses the average; the renderer follows the ramp curve.</p>
    </div>
  );
}

const round = (n: number) => Math.round((n ?? 0) * 1000) / 1000;
const defaults = () => ({ content: '', font: 'Inter', size: 46, color: 'rgb(var(--ink-rgb))', align: 'center' as const, y: 0.72, bg: false, animate: 'fade' as const });
