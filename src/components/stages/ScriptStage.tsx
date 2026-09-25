'use client';
import * as React from 'react';
import { FileText, Moon, Flame, Camera, Film, MessageSquare, Minimize2, Maximize2, Eye, Download, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { StageFrame, StageNote } from './StageFrame';
import { GenerateBar } from './GenerateBar';
import { ReviewBar } from './ReviewBar';
import { Button, Badge, Card, EmptyState, Skeleton, cx, Tip, Segmented } from '@/components/ui/primitives';
import { TextArea, Select } from '@/components/ui/inputs';
import { useProject } from '@/store/project';
import { useApp } from '@/store/app';
import { toScreenplayText } from '@/lib/domain/script';
import type { Screenplay, ScriptElement } from '@/types';

const MODS = [
  { id: 'dialogue', label: 'Rewrite dialogue', icon: <MessageSquare size={12} />, mods: { dialogue: true } },
  { id: 'cinematic', label: 'Make cinematic', icon: <Film size={12} />, mods: { cinematic: true } },
  { id: 'tension', label: 'Add tension', icon: <Flame size={12} />, mods: { tension: true } },
  { id: 'camera', label: 'Add camera direction', icon: <Camera size={12} />, mods: { camera: true } },
  { id: 'shorten', label: 'Shorten', icon: <Minimize2 size={12} />, mods: { shorten: true } },
  { id: 'expand', label: 'Expand', icon: <Maximize2 size={12} />, mods: { expand: true } },
  { id: 'character', label: 'Improve character', icon: <Users size={12} />, mods: { characterDepth: true } },
  { id: 'visual', label: 'Add visual detail', icon: <Eye size={12} />, mods: { visual: true } },
  { id: 'darker', label: 'Make darker', icon: <Moon size={12} />, mods: { darker: true } }
] as const;

export function ScriptStage() {
  const sp = useProject(s => s.screenplay);
  const project = useProject(s => s.project);
  const saveScript = useProject(s => s.saveScript);
  const generate = useProject(s => s.generate);
  const takeSnapshot = useProject(s => s.takeSnapshot);
  const toast = useApp(s => s.toast);
  const jobs = useApp(s => s.jobs);
  const [view, setView] = React.useState<'page' | 'elements' | 'text'>('page');
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [sceneCount, setSceneCount] = React.useState('6');
  const [approved, setApproved] = React.useState(false);

  const generating = jobs.some(j => j.stage === 'script' && (j.status === 'queued' || j.status === 'running'));
  const elements = sp?.elements ?? [];
  const sceneCountActual = elements.filter(e => e.type === 'scene-heading').length;

  const regen = async (mods: Record<string, boolean>, label: string) => {
    await takeSnapshot(`Before ${label}`);
    try { await generate('script', { mods, sceneCount: Number(sceneCount) }); }
    catch (err) { toast({ level: 'error', title: (err as Error).message }); }
  };

  const updateElement = async (id: string, patch: Partial<ScriptElement>) => {
    if (!sp) return;
    await saveScript({ elements: sp.elements.map(e => e.id === id ? { ...e, ...patch } : e) });
  };
  const removeElement = async (id: string) => {
    if (!sp) return;
    await saveScript({ elements: sp.elements.filter(e => e.id !== id) });
    setSelected(null);
  };
  const addElement = async (type: ScriptElement['type'], afterId?: string) => {
    if (!sp) return;
    const el: ScriptElement = { id: `el_${Math.random().toString(36).slice(2, 12)}`, type, text: type === 'scene-heading' ? 'INT. NEW LOCATION — DAY' : '' };
    const idx = afterId ? sp.elements.findIndex(e => e.id === afterId) : sp.elements.length - 1;
    const elements = [...sp.elements];
    elements.splice(idx + 1, 0, el);
    await saveScript({ elements });
    setEditingId(el.id); setDraft(el.text);
  };

  const download = () => {
    if (!sp) return;
    const text = toScreenplayText(sp);
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${sp.title.replace(/\W+/g, '_')}_draft${sp.draft}.txt`; a.click();
    URL.revokeObjectURL(url);
    toast({ level: 'success', title: 'Screenplay exported', body: 'Plain-text screenplay in standard indentation.' });
  };

  return (
    <StageFrame
      icon={<FileText size={15} />}
      title="Screenplay"
      subtitle={sp ? `${sp.title} · draft ${sp.draft} · ${sceneCountActual} scenes · ${elements.filter(e => e.type === 'dialogue').length} dialogue lines` : 'Standard-format screenplay, element by element'}
      headerRight={
        <>
          <Segmented value={view} onChange={setView} size="sm" options={[{ value: 'page', label: 'Page' }, { value: 'elements', label: 'Elements' }, { value: 'text', label: 'Text' }]} />
          {sp && <Button size="sm" variant="ghost" onClick={download}><Download size={12} />Export</Button>}
          <GenerateBar config={{ action: 'script', label: 'Regenerate screenplay', params: { sceneCount: Number(sceneCount) } }} modelKind="text" label="Regenerate" size="sm" />
        </>
      }
      asideTitle="AI tools"
      aside={
        <div className="space-y-3 p-3">
          <div>
            <div className="label mb-1.5">Target length</div>
            <Select value={sceneCount} onChange={setSceneCount}
              options={['4', '6', '8', '10', '12', '14'].map(n => ({ value: n, label: `${n} scenes` }))} />
            <p className="mt-1.5 text-[10px] leading-relaxed text-ink3">Roughly {Number(sceneCount) * 12}s of screen time at a normal dramatic pace.</p>
          </div>
          <div>
            <div className="label mb-2">Rewrite</div>
            <div className="space-y-1">
              {MODS.map(m => (
                <button key={m.id} type="button" disabled={generating || !sp} onClick={() => void regen({ ...m.mods }, m.label)}
                  className="flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-[11.5px] text-ink2 transition-colors hover:border-line-soft hover:bg-white/[0.03] hover:text-ink disabled:opacity-40">
                  <span className="text-accent/80">{m.icon}</span>{m.label}
                </button>
              ))}
            </div>
            {!sp && <p className="mt-2 text-[10.5px] text-ink3">Generate a screenplay first.</p>}
          </div>
          {selected && (
            <div className="rounded-md border border-accent/25 bg-accent/[0.06] p-2.5">
              <div className="label mb-1.5 text-accent-bright">Selected element</div>
              <p className="mb-2 text-[10.5px] text-ink2">{elements.find(e => e.id === selected)?.type}</p>
              <div className="grid grid-cols-2 gap-1">
                <Button size="xs" variant="ghost" onClick={() => void addElement('action', selected)}>+ Action</Button>
                <Button size="xs" variant="ghost" onClick={() => void addElement('character', selected)}>+ Character</Button>
                <Button size="xs" variant="ghost" onClick={() => void addElement('dialogue', selected)}>+ Dialogue</Button>
                <Button size="xs" variant="ghost" onClick={() => void addElement('parenthetical', selected)}>+ Parenthetical</Button>
                <Button size="xs" variant="ghost" onClick={() => void addElement('camera', selected)}>+ Camera</Button>
                <Button size="xs" variant="ghost" onClick={() => void addElement('transition', selected)}>+ Transition</Button>
              </div>
              <Button size="xs" variant="danger" className="mt-1.5 w-full" onClick={() => void removeElement(selected)}><Trash2 size={11} />Delete element</Button>
            </div>
          )}
        </div>
      }
      footer={sp ? (
        <ReviewBar approved={approved} next="characters"
          onApprove={async () => { setApproved(true); useProject.getState().markStage('script', 'approved'); await takeSnapshot('Screenplay approved'); toast({ level: 'success', title: 'Screenplay approved' }); }}
          onRegenerate={() => void regen({}, 'regeneration')} onEdit={() => setView('elements')}
          count={`${elements.length} elements · click any line to edit it`} />
      ) : undefined}>
      <div className="mx-auto w-full max-w-[900px] p-4 xl:p-6">
        {!sp && generating && <div className="space-y-2.5">{Array.from({ length: 14 }).map((_, i) => <Skeleton key={i} className={cx('h-4', i % 5 === 0 ? 'w-2/3' : i % 3 === 0 ? 'w-full' : 'w-4/5')} />)}</div>}

        {!sp && !generating && (
          <EmptyState icon={<FileText size={17} />} title="No screenplay yet"
            body={<>Written from your approved story beats. You'll get standard screenplay elements — slug lines, action, character cues, parentheticals, dialogue, transitions and camera direction — each one individually editable.</>}
            action={<GenerateBar config={{ action: 'script', label: 'Generate screenplay', params: { sceneCount: Number(sceneCount) } }} modelKind="text" label="Generate screenplay" />} />
        )}

        {sp && view === 'page' && (
          <Card hover={false} className="overflow-hidden">
            <div className="border-b border-line-soft px-5 py-3 text-center">
              <p className="font-cine text-[15px] font-semibold uppercase tracking-[0.14em] text-ink">{sp.title}</p>
              <p className="mt-1 text-[10.5px] uppercase tracking-[0.18em] text-ink3">Draft {sp.draft} · {sp.author}</p>
              {sp.logline && <p className="mx-auto mt-2 max-w-[52ch] text-[11px] italic leading-relaxed text-ink3">{sp.logline}</p>}
            </div>
            <div className="screenplay px-5 py-4 sm:px-10">
              {elements.map(el => (
                <ElementLine key={el.id} el={el} editing={editingId === el.id} draft={draft}
                  setDraft={setDraft} onStartEdit={() => { setEditingId(el.id); setDraft(el.text); }}
                  onCommit={async () => { setEditingId(null); await updateElement(el.id, { text: draft }); }}
                  onCancel={() => setEditingId(null)}
                  selected={selected === el.id} onSelect={() => setSelected(el.id)} />
              ))}
            </div>
          </Card>
        )}

        {sp && view === 'elements' && (
          <div className="space-y-1.5">
            {elements.map((el, i) => (
              <Card key={el.id} hover className={cx('p-2.5', selected === el.id && 'border-accent/40 shadow-glow')}
                onClick={() => setSelected(el.id)}>
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[10px] text-ink3 tnum">{i + 1}</span>
                  <Badge tone={el.type === 'scene-heading' ? 'accent' : el.type === 'dialogue' ? 'info' : 'mut'} className="w-[92px] shrink-0 justify-center">{el.type}</Badge>
                  <div className="min-w-0 flex-1">
                    {editingId === el.id ? (
                      <TextArea autoFocus rows={2} value={draft} onChange={e => setDraft(e.target.value)}
                        onBlur={async () => { setEditingId(null); await updateElement(el.id, { text: draft }); }}
                        onKeyDown={e => { if (e.key === 'Escape') setEditingId(null); }} className="text-[12px]" />
                    ) : (
                      <p className="cursor-text whitespace-pre-wrap text-[12px] leading-relaxed text-ink2 hover:text-ink"
                        onClick={e => { e.stopPropagation(); setEditingId(el.id); setDraft(el.text); }}>
                        {el.text || <span className="italic text-ink3">empty</span>}
                      </p>
                    )}
                    {el.meta?.location && <p className="mt-1 text-[10px] text-ink3">{el.meta.intExt} · {el.meta.location} · {el.meta.time}</p>}
                  </div>
                  <div className="flex shrink-0 gap-0.5">
                    <Tip label="Edit"><button type="button" className="icon-btn h-6 w-6" onClick={e => { e.stopPropagation(); setEditingId(el.id); setDraft(el.text); }}><Pencil size={11} /></button></Tip>
                    <Tip label="Delete"><button type="button" className="icon-btn h-6 w-6 hover:text-bad" onClick={e => { e.stopPropagation(); void removeElement(el.id); }}><Trash2 size={11} /></button></Tip>
                  </div>
                </div>
              </Card>
            ))}
            <div className="flex flex-wrap gap-1.5 pt-2">
              {(['scene-heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition', 'camera'] as const).map(t => (
                <Button key={t} size="xs" variant="ghost" onClick={() => void addElement(t)}><Plus size={11} />{t}</Button>
              ))}
            </div>
          </div>
        )}

        {sp && view === 'text' && (
          <Card hover={false} className="p-4">
            <div className="label mb-2">Plain text (exportable)</div>
            <pre className="screenplay max-h-[62vh] overflow-auto whitespace-pre-wrap rounded-md border border-line-soft bg-well p-4 text-[12px] leading-relaxed text-ink2">
              {toScreenplayText(sp)}
            </pre>
            <div className="mt-3 flex items-center gap-2">
              <Button size="sm" onClick={download}><Download size={12} />Download .txt</Button>
              <span className="text-[10.5px] text-ink3">{toScreenplayText(sp).split(/\s+/).length} words · ~{Math.round(toScreenplayText(sp).split(/\s+/).length / 2.4)}s spoken</span>
              {sp.elements.some(e => e.type === 'note') && <Badge tone="mut" className="ml-auto">contains notes</Badge>}
            </div>
          </Card>
        )}

        {sp && <div className="mt-4"><StageNote tone="info" title="Screenplay → production">
          Slug lines become scenes. Character cues become the cast list. Dialogue lines become voice lines with the
          character's voice profile attached. Action lines drive shot coverage planning and sound-effect detection.
        </StageNote></div>}
      </div>
    </StageFrame>
  );
}

function ElementLine({ el, editing, draft, setDraft, onStartEdit, onCommit, onCancel, selected, onSelect }: {
  el: ScriptElement; editing: boolean; draft: string; setDraft: (v: string) => void;
  onStartEdit: () => void; onCommit: () => void; onCancel: () => void; selected: boolean; onSelect: () => void;
}) {
  const cls: Record<string, string> = {
    'scene-heading': 'sp-slug text-ink', action: 'sp-action', character: 'sp-char text-accent-bright',
    dialogue: 'sp-dial', parenthetical: 'sp-paren', transition: 'sp-trans', camera: 'sp-action text-info/80 uppercase text-[11px]',
    shot: 'sp-action text-info/80 uppercase text-[11px]', note: 'sp-action italic text-ink3'
  };
  return (
    <div className={cx('group -mx-2 cursor-text rounded px-2 transition-colors', selected && 'bg-accent/[0.06]', 'hover:bg-white/[0.02]')} onClick={onSelect}>
      {editing ? (
        <TextArea autoFocus rows={el.type === 'action' ? 3 : 1} value={draft} onChange={e => setDraft(e.target.value)}
          onBlur={onCommit} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onCommit(); } if (e.key === 'Escape') onCancel(); }}
          className={cx('my-1 text-[12px]', el.type === 'dialogue' && 'mx-auto max-w-[38ch] text-center')} />
      ) : (
        <p className={cx(cls[el.type] ?? 'sp-action', !el.text && 'italic text-ink3')} onDoubleClick={onStartEdit} onClick={e => { e.stopPropagation(); onStartEdit(); }}>
          {el.text || 'empty — double-click to write'}
        </p>
      )}
    </div>
  );
}
