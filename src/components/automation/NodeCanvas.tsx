'use client';
import * as React from 'react';
import { motion } from 'framer-motion';
import {
  X, Plus, Play, Save, Trash2, Copy, Sparkles, Image as ImageIcon, Video, Type, Mic2, Music,
  Upload, Repeat, GitBranch, RefreshCcw, Layers, Clock, UserCheck, Check, Ban, Webhook, Globe,
  Database, Film, Download, Users, Map, Clapperboard, Wand2, Scissors, Search, Captions, ArrowUpRight, Hand
} from 'lucide-react';
import { cx, Badge, Button, Tip } from '@/components/ui/primitives';
import { Field, TextInput, TextArea, Select, Toggle } from '@/components/ui/inputs';
import { useApp, useBoot } from '@/store/app';
import { patch as apiPatch, describeError } from '@/lib/client/api';
import type { Automation, AutomationEdge, AutomationNode, NodeType } from '@/types';

const NODE_W = 196;
const NODE_H = 62;

const PALETTE: { type: NodeType; label: string; icon: React.ReactNode; group: string; hint: string }[] = [
  { type: 'start', label: 'Start', icon: <ArrowUpRight size={12} />, group: 'Flow', hint: 'Entry point of the run' },
  { type: 'end', label: 'End', icon: <Check size={12} />, group: 'Flow', hint: 'Marks the run complete' },
  { type: 'condition', label: 'Condition', icon: <GitBranch size={12} />, group: 'Flow', hint: 'Branch on an expression' },
  { type: 'loop', label: 'Loop', icon: <RefreshCcw size={12} />, group: 'Flow', hint: 'Iterate a collection' },
  { type: 'batch', label: 'Batch', icon: <Layers size={12} />, group: 'Flow', hint: 'Fan out many generations' },
  { type: 'delay', label: 'Delay', icon: <Clock size={12} />, group: 'Flow', hint: 'Wait before continuing' },
  { type: 'transform', label: 'Transform', icon: <Repeat size={12} />, group: 'Flow', hint: 'Reshape a value' },
  { type: 'human-review', label: 'Human review', icon: <UserCheck size={12} />, group: 'Gates', hint: 'Pause for approval' },
  { type: 'approve', label: 'Approve gate', icon: <Check size={12} />, group: 'Gates', hint: 'Explicit approval node' },
  { type: 'reject', label: 'Reject gate', icon: <Ban size={12} />, group: 'Gates', hint: 'Explicit rejection node' },
  { type: 'generate-story', label: 'Generate story', icon: <Sparkles size={12} />, group: 'AI stages', hint: 'Story from the idea' },
  { type: 'generate-script', label: 'Generate script', icon: <Type size={12} />, group: 'AI stages', hint: 'Screenplay from the story' },
  { type: 'extract-characters', label: 'Extract characters', icon: <Users size={12} />, group: 'AI stages', hint: 'Cast from the screenplay' },
  { type: 'extract-locations', label: 'Extract locations', icon: <Map size={12} />, group: 'AI stages', hint: 'World from the screenplay' },
  { type: 'breakdown-scenes', label: 'Break into scenes', icon: <Clapperboard size={12} />, group: 'AI stages', hint: 'Scenes and coverage' },
  { type: 'generate-storyboard', label: 'Generate storyboard', icon: <ImageIcon size={12} />, group: 'AI stages', hint: 'Frames per shot' },
  { type: 'text-generate', label: 'Text generate', icon: <Type size={12} />, group: 'AI generate', hint: 'Freeform text model call' },
  { type: 'image-generate', label: 'Image generate', icon: <ImageIcon size={12} />, group: 'AI generate', hint: 'Freeform image call' },
  { type: 'video-generate', label: 'Video generate', icon: <Video size={12} />, group: 'AI generate', hint: 'Freeform video call' },
  { type: 'voice-generate', label: 'Voice generate', icon: <Mic2 size={12} />, group: 'AI generate', hint: 'Dialogue or narration' },
  { type: 'music-generate', label: 'Music generate', icon: <Music size={12} />, group: 'AI generate', hint: 'Score or song bed' },
  { type: 'sfx-generate', label: 'SFX generate', icon: <Wand2 size={12} />, group: 'AI generate', hint: 'Effects and ambience' },
  { type: 'upscale', label: 'Upscale', icon: <Search size={12} />, group: 'AI generate', hint: 'Super-resolution pass' },
  { type: 'caption', label: 'Captions', icon: <Captions size={12} />, group: 'Finish', hint: 'Subtitle track from dialogue' },
  { type: 'assemble', label: 'Assemble timeline', icon: <Scissors size={12} />, group: 'Finish', hint: 'Build the cut from media' },
  { type: 'timeline', label: 'Timeline op', icon: <Film size={12} />, group: 'Finish', hint: 'Apply timeline operations' },
  { type: 'export', label: 'Export', icon: <Download size={12} />, group: 'Finish', hint: 'Render a deliverable' },
  { type: 'upload', label: 'Upload', icon: <Upload size={12} />, group: 'IO', hint: 'Reference an uploaded file' },
  { type: 'save-asset', label: 'Save asset', icon: <Database size={12} />, group: 'IO', hint: 'Persist to the library' },
  { type: 'http-request', label: 'HTTP request', icon: <Globe size={12} />, group: 'IO', hint: 'Call any REST API' },
  { type: 'webhook', label: 'Webhook', icon: <Webhook size={12} />, group: 'IO', hint: 'Notify an external system' }
];

const ACCENT: Record<string, string> = {
  Flow: '#91897D', Gates: '#D99A32', 'AI stages': '#63A9E9', 'AI generate': '#C58BE9', Finish: '#4CCB8A', IO: '#5BC8C8'
};

/** Visual node editor: pan, zoom, connect, configure, save and run. */
export function NodeCanvas({ automation, onClose, onRun }: { automation: Automation; onClose: () => void; onRun: () => void }) {
  const toast = useApp(s => s.toast);
  const boot = useBoot();
  const [nodes, setNodes] = React.useState<AutomationNode[]>(automation.nodes ?? []);
  const [edges, setEdges] = React.useState<AutomationEdge[]>(automation.edges ?? []);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = React.useState<string | null>(null);
  const [view, setView] = React.useState({ x: 40, y: 20, k: 0.62 });
  const [drag, setDrag] = React.useState<null | { kind: 'pan' | 'node' | 'link'; id?: string; sx: number; sy: number; ox: number; oy: number; port?: string }>(null);
  const [linkPreview, setLinkPreview] = React.useState<null | { from: string; port: string; x: number; y: number }>(null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [q, setQ] = React.useState('');
  const svgRef = React.useRef<SVGSVGElement>(null);

  const sel = nodes.find(n => n.id === selected) ?? null;
  const models = boot?.models ?? [];

  const toWorld = (clientX: number, clientY: number) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: (clientX - (r?.left ?? 0) - view.x) / view.k, y: (clientY - (r?.top ?? 0) - view.y) / view.k };
  };

  const markDirty = () => setDirty(true);

  const addNode = (type: NodeType, label: string) => {
    const n: AutomationNode = {
      id: `node_${Math.random().toString(36).slice(2, 12)}`, automationId: automation.id, type, label,
      x: (-view.x + 420) / view.k, y: (-view.y + 200) / view.k,
      config: {}, modelId: null, prompt: '', enabled: true, retry: 1, timeoutSec: 900,
      reviewGate: type === 'human-review' || type === 'approve' || type === 'reject',
      inputPort: 'in',
      outputPorts: type === 'condition' ? [{ id: 'true', label: 'true' }, { id: 'false', label: 'false' }] : [{ id: 'out', label: 'out' }],
      status: 'idle', logs: []
    };
    setNodes(ns => [...ns, n]); setSelected(n.id); markDirty();
  };

  const patchNode = (id: string, p: Partial<AutomationNode>) => {
    setNodes(ns => ns.map(n => n.id === id ? { ...n, ...p } : n));
    markDirty();
  };

  const connect = (from: string, fromPort: string, to: string) => {
    if (from === to) return;
    if (edges.some(e => e.from === from && e.to === to && e.fromPort === fromPort)) return;
    setEdges(es => [...es, { id: `edge_${Math.random().toString(36).slice(2, 12)}`, automationId: automation.id, from, fromPort, to, toPort: 'in' }]);
    markDirty();
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiPatch(`/api/automations/${automation.id}`, { nodes, edges });
      setDirty(false);
      toast({ level: 'success', title: 'Workflow saved', body: `${nodes.length} nodes · ${edges.length} connections` });
    } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); }
    finally { setSaving(false); }
  };

  /* ── pointer handling ─────────────────────────────────────── */
  React.useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      if (drag.kind === 'pan') { setView(v => ({ ...v, x: drag.ox + (e.clientX - drag.sx), y: drag.oy + (e.clientY - drag.sy) })); return; }
      if (drag.kind === 'node' && drag.id) {
        const dx = (e.clientX - drag.sx) / view.k, dy = (e.clientY - drag.sy) / view.k;
        setNodes(ns => ns.map(n => n.id === drag.id ? { ...n, x: Math.round((drag.ox + dx) / 8) * 8, y: Math.round((drag.oy + dy) / 8) * 8 } : n));
        markDirty();
        return;
      }
      if (drag.kind === 'link') { const p = toWorld(e.clientX, e.clientY); setLinkPreview({ from: drag.id!, port: drag.port!, x: p.x, y: p.y }); }
    };
    const up = (e: PointerEvent) => {
      if (drag.kind === 'link') {
        const p = toWorld(e.clientX, e.clientY);
        const target = nodes.find(n => p.x >= n.x && p.x <= n.x + NODE_W && p.y >= n.y && p.y <= n.y + NODE_H);
        if (target) connect(drag.id!, drag.port!, target.id);
        setLinkPreview(null);
      }
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, view.k, nodes]);

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 2) return;
    e.preventDefault();
    const r = svgRef.current?.getBoundingClientRect();
    const mx = e.clientX - (r?.left ?? 0), my = e.clientY - (r?.top ?? 0);
    const k = Math.max(0.25, Math.min(2.2, view.k * (e.deltaY > 0 ? 0.92 : 1.08)));
    setView(v => ({ k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k }));
  };

  const filtered = q ? PALETTE.filter(p => `${p.label} ${p.group}`.toLowerCase().includes(q.toLowerCase())) : PALETTE;
  const groups = [...new Set(filtered.map(p => p.group))];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[210] flex flex-col bg-bg">
      {/* header */}
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-panel-grad px-3 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.08] text-accent-bright"><Layers size={14} /></span>
        <div className="min-w-0">
          <h2 className="truncate text-[13px] font-semibold text-ink">{automation.name}</h2>
          <p className="truncate text-[10.5px] text-ink3">{nodes.length} nodes · {edges.length} connections · cap {automation.maxCostCredits} credits{automation.requireApproval ? ' · review gates on' : ''}</p>
        </div>
        {dirty && <Badge tone="accent">unsaved</Badge>}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5">
          <Tip label="Fit to content"><button type="button" className="icon-btn" onClick={() => {
            if (!nodes.length) return;
            const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
            const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs) + NODE_W, maxY = Math.max(...ys) + NODE_H;
            const el = svgRef.current?.getBoundingClientRect();
            const k = Math.max(0.25, Math.min(1.2, Math.min((el?.width ?? 900) / (maxX - minX + 120), (el?.height ?? 600) / (maxY - minY + 120))));
            setView({ k, x: 60 - minX * k, y: 60 - minY * k });
          }}><Hand size={13} /></button></Tip>
          <span className="mono text-[10px] text-ink3">{Math.round(view.k * 100)}%</span>
          <Button size="sm" variant="ghost" loading={saving} disabled={!dirty} onClick={() => void save()}><Save size={12} />Save</Button>
          <Button size="sm" variant="primary" onClick={() => { if (dirty) void save().then(onRun); else onRun(); }}><Play size={12} />Run</Button>
          <Button size="sm" variant="ghost" onClick={onClose}><X size={12} />Close</Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* palette */}
        <aside className="flex w-[212px] shrink-0 flex-col border-r border-line bg-panel">
          <div className="shrink-0 border-b border-line-soft p-2">
            <TextInput className="h-[28px] text-[11px]" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter nodes…" />
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-2">
            {groups.map(g => (
              <div key={g} className="mb-2.5">
                <div className="label mb-1" style={{ color: ACCENT[g] }}>{g}</div>
                <div className="space-y-1">
                  {filtered.filter(p => p.group === g).map(p => (
                    <Tip key={p.type + p.label} label={p.hint} side="right">
                      <button type="button" onClick={() => addNode(p.type, p.label)}
                        className="flex w-full items-center gap-2 rounded-md border border-line bg-well px-2 py-1.5 text-left text-[11px] text-ink2 transition-colors hover:border-accent/35 hover:text-ink">
                        <span style={{ color: ACCENT[g] }}>{p.icon}</span>
                        <span className="min-w-0 flex-1 truncate">{p.label}</span>
                        <Plus size={10} className="shrink-0 text-ink3" />
                      </button>
                    </Tip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* canvas */}
        <div className="relative min-w-0 flex-1 overflow-hidden">
          <svg ref={svgRef} className="h-full w-full cursor-grab active:cursor-grabbing" onWheel={onWheel}
            onPointerDown={e => { if (e.target === svgRef.current || (e.target as Element).tagName === 'rect' && (e.target as Element).getAttribute('data-bg')) { setSelected(null); setSelectedEdge(null); setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }); } }}>
            <defs>
              <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <circle cx="1" cy="1" r="1" fill="#1E1B17" />
              </pattern>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#4A443B" />
              </marker>
              <marker id="arrowLive" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="#D99A32" />
              </marker>
            </defs>
            <rect data-bg="1" width="100%" height="100%" fill="#090908" />
            <rect data-bg="1" width="100%" height="100%" fill="url(#grid)" />

            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {/* edges */}
              {edges.map(e => {
                const a = nodes.find(n => n.id === e.from); const b = nodes.find(n => n.id === e.to);
                if (!a || !b) return null;
                const portIdx = Math.max(0, (a.outputPorts ?? []).findIndex(p => p.id === e.fromPort));
                const ports = (a.outputPorts ?? []).length || 1;
                const x1 = a.x + NODE_W, y1 = a.y + NODE_H * ((portIdx + 1) / (ports + 1));
                const x2 = b.x, y2 = b.y + NODE_H / 2;
                const dx = Math.max(38, Math.abs(x2 - x1) * 0.5);
                const live = a.status === 'done' || a.status === 'running';
                return (
                  <g key={e.id}>
                    <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} className="node-edge" data-live={live}
                      markerEnd={live ? 'url(#arrowLive)' : 'url(#arrow)'} strokeWidth={selectedEdge === e.id ? 2.6 : 1.6}
                      stroke={selectedEdge === e.id ? '#F0B347' : undefined} />
                    <path d={`M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`} stroke="transparent" strokeWidth={14} fill="none"
                      className="cursor-pointer" onPointerDown={ev => { ev.stopPropagation(); setSelectedEdge(e.id); setSelected(null); }} />
                  </g>
                );
              })}
              {linkPreview && (() => {
                const a = nodes.find(n => n.id === linkPreview.from); if (!a) return null;
                const x1 = a.x + NODE_W, y1 = a.y + NODE_H / 2;
                return <path d={`M${x1},${y1} C${x1 + 60},${y1} ${linkPreview.x - 60},${linkPreview.y} ${linkPreview.x},${linkPreview.y}`} stroke="#F0B347" strokeWidth={1.8} strokeDasharray="5 4" fill="none" />;
              })()}

              {/* nodes */}
              {nodes.map(n => {
                const meta = PALETTE.find(p => p.type === n.type);
                const accent = ACCENT[meta?.group ?? 'Flow'] ?? '#91897D';
                const isSel = selected === n.id;
                return (
                  <g key={n.id} transform={`translate(${n.x} ${n.y})`} className="cursor-move"
                    onPointerDown={e => { e.stopPropagation(); setSelected(n.id); setSelectedEdge(null); setDrag({ kind: 'node', id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y }); }}>
                    <rect width={NODE_W} height={NODE_H} rx={9}
                      fill={isSel ? '#1E1B16' : 'rgb(var(--elevated-rgb))'}
                      stroke={isSel ? '#D99A32' : n.status === 'error' ? '#E96A6A' : n.status === 'done' ? '#4CCB8A55' : n.status === 'waiting' ? '#D99A3266' : '#302C27'}
                      strokeWidth={isSel ? 1.8 : 1.2}
                      style={{ filter: isSel ? 'drop-shadow(0 0 12px rgba(217,154,50,.35))' : undefined }} />
                    <rect width={3} height={NODE_H} rx={1.5} fill={accent} opacity={n.enabled ? 0.9 : 0.3} />
                    {/* status dot */}
                    <circle cx={NODE_W - 12} cy={12} r={3.4}
                      fill={n.status === 'done' ? '#4CCB8A' : n.status === 'running' ? '#D99A32' : n.status === 'error' ? '#E96A6A' : n.status === 'waiting' ? '#F0B347' : n.status === 'skipped' ? '#3A352E' : '#241F1B'}
                      stroke={n.status === 'running' || n.status === 'waiting' ? '#F0B347' : 'rgb(var(--well-rgb))'} strokeWidth={1}>
                      {(n.status === 'running' || n.status === 'waiting') && <animate attributeName="opacity" values="1;0.35;1" dur="1.4s" repeatCount="indefinite" />}
                    </circle>
                    {/* input port */}
                    {n.type !== 'start' && (
                      <circle cx={0} cy={NODE_H / 2} r={5.5} fill="#0C0B0A" stroke="#4A443B" strokeWidth={2} />
                    )}
                    {/* output ports */}
                    {(n.outputPorts ?? [{ id: 'out', label: 'out' }]).map((p, i, arr) => (
                      <g key={p.id} className="cursor-crosshair"
                        onPointerDown={e => { e.stopPropagation(); setDrag({ kind: 'link', id: n.id, port: p.id, sx: e.clientX, sy: e.clientY, ox: 0, oy: 0 }); }}>
                        <circle cx={NODE_W} cy={NODE_H * ((i + 1) / (arr.length + 1))} r={5.5} fill="#0C0B0A" stroke={accent} strokeWidth={2} className="node-port-circle" />
                        {arr.length > 1 && <text x={NODE_W - 12} y={NODE_H * ((i + 1) / (arr.length + 1)) + 3} fontSize={8} fill="#91897D" textAnchor="end">{p.label}</text>}
                      </g>
                    ))}
                    <text x={26} y={22} fontSize={11.5} fontWeight={600} fill="#F3EFE8">{(n.label || meta?.label || n.type).slice(0, 24)}</text>
                    <text x={26} y={38} fontSize={9} fill="#625D55">{n.type}{n.reviewGate ? ' · gate' : ''}{n.enabled ? '' : ' · off'}</text>
                    <text x={26} y={52} fontSize={9} fill="#91897D">
                      {(n.prompt ? n.prompt.slice(0, 30) : (n.config as any)?.source ? `source: ${(n.config as any).source}` : (n.config as any)?.mode ? `mode: ${(n.config as any).mode}` : meta?.hint ?? '').slice(0, 34)}
                    </text>
                    {n.reviewGate && <rect x={NODE_W - 30} y={NODE_H - 18} width={22} height={12} rx={3} fill="#D99A3222" stroke="#D99A3255" strokeWidth={0.8} />}
                    {n.reviewGate && <text x={NODE_W - 19} y={NODE_H - 9} fontSize={7.5} fill="#E8B968" textAnchor="middle">GATE</text>}
                  </g>
                );
              })}
            </g>
          </svg>

          {!nodes.length && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <p className="max-w-[42ch] rounded-lg border border-dashed border-line bg-well/80 px-5 py-4 text-center text-[11.5px] leading-relaxed text-ink3">
                Add nodes from the left, then drag from a node's right port to another node's left port to connect them.
                Ctrl/⌘ + scroll to zoom, drag the background to pan.
              </p>
            </div>
          )}

          {selectedEdge && (
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg border border-line bg-panel/95 px-3 py-2 shadow-pop backdrop-blur">
              <span className="text-[11px] text-ink2">Connection selected</span>
              <Button size="xs" variant="danger" onClick={() => { setEdges(es => es.filter(e => e.id !== selectedEdge)); setSelectedEdge(null); markDirty(); }}><Trash2 size={11} />Delete</Button>
            </div>
          )}
        </div>

        {/* inspector */}
        <aside className="flex w-[300px] shrink-0 flex-col border-l border-line bg-panel">
          <div className="shrink-0 border-b border-line-soft px-3 py-2.5">
            <h3 className="truncate text-[12px] font-semibold text-ink">{sel ? sel.label || sel.type : 'Workflow'}</h3>
            <p className="mt-0.5 truncate text-[10px] text-ink3">{sel ? sel.type : 'Settings for the whole workflow'}</p>
          </div>
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
            {sel ? (
              <div className="space-y-3">
                <Field label="Label"><TextInput value={sel.label} onChange={e => patchNode(sel.id, { label: e.target.value })} /></Field>
                <Field label="Prompt" hint="Supports {{vars.x}}, {{outputs.nodeId}} and, in batch nodes, {{item.field}}.">
                  <TextArea rows={4} value={sel.prompt} onChange={e => patchNode(sel.id, { prompt: e.target.value })} placeholder={sel.type.startsWith('http') || sel.type === 'webhook' ? '' : 'Describe what to generate…'} />
                </Field>
                <Field label="Model" hint="Leave empty to let the router choose by capability.">
                  <Select value={sel.modelId ?? ''} onChange={v => patchNode(sel.id, { modelId: v || null })} placeholder="Router decides"
                    options={models.map(m => ({ value: m.id, label: m.name, group: m.kind }))} />
                </Field>

                {(sel.type === 'batch' || sel.type === 'loop') && (
                  <>
                    <Field label="Source collection">
                      <Select value={String(sel.config.source ?? 'shots')} onChange={v => patchNode(sel.id, { config: { ...sel.config, source: v } })}
                        options={['shots', 'shots-with-frames', 'scenes', 'characters', 'locations', 'voices', 'sounds']} />
                    </Field>
                    <Field label="Generation kind">
                      <Select value={String(sel.config.kind ?? 'image')} onChange={v => patchNode(sel.id, { config: { ...sel.config, kind: v } })}
                        options={['image', 'video', 'voice', 'music', 'sfx', 'upscale']} />
                    </Field>
                    <Field label="Limit"><TextInput type="number" min={1} max={500} value={Number(sel.config.limit ?? 500)} onChange={e => patchNode(sel.id, { config: { ...sel.config, limit: Number(e.target.value) } })} /></Field>
                    <div className="rounded-md border border-line-soft bg-well p-2"><Toggle checked={String(sel.config.waitFor ?? 'true') === 'true'} onChange={v => patchNode(sel.id, { config: { ...sel.config, waitFor: String(v) } })} label="Wait for all jobs" hint="Otherwise the run continues immediately." /></div>
                  </>
                )}
                {sel.type === 'condition' && (
                  <Field label="Expression" hint="e.g. counts.shots > 0 && vars.approved">
                    <TextInput className="mono text-[11px]" value={String(sel.config.expression ?? '')} onChange={e => patchNode(sel.id, { config: { ...sel.config, expression: e.target.value } })} />
                  </Field>
                )}
                {sel.type === 'delay' && <Field label="Seconds"><TextInput type="number" min={0} max={600} value={Number(sel.config.seconds ?? 1)} onChange={e => patchNode(sel.id, { config: { ...sel.config, seconds: Number(e.target.value) } })} /></Field>}
                {(sel.type === 'http-request' || sel.type === 'webhook') && (
                  <>
                    <Field label="URL"><TextInput className="mono text-[11px]" value={String(sel.config.url ?? '')} onChange={e => patchNode(sel.id, { config: { ...sel.config, url: e.target.value } })} placeholder="https://…" /></Field>
                    <Field label="Method"><Select value={String(sel.config.method ?? 'POST')} onChange={v => patchNode(sel.id, { config: { ...sel.config, method: v } })} options={['GET', 'POST', 'PUT', 'PATCH']} /></Field>
                  </>
                )}
                {(sel.type === 'assemble' || sel.type === 'timeline') && (
                  <>
                    <Field label="Mode"><Select value={String(sel.config.mode ?? 'full')} onChange={v => patchNode(sel.id, { config: { ...sel.config, mode: v } })} options={['full', 'trailer', 'short30', 'social']} /></Field>
                    <Field label="Grade"><Select value={String(sel.config.grade ?? 'cinematic')} onChange={v => patchNode(sel.id, { config: { ...sel.config, grade: v } })} options={['none', 'cinematic', 'noir', 'warm', 'cold']} /></Field>
                    <div className="rounded-md border border-line-soft bg-well p-2"><Toggle checked={sel.config.addCaptions === true} onChange={v => patchNode(sel.id, { config: { ...sel.config, addCaptions: v } })} label="Add captions" /></div>
                  </>
                )}
                {sel.type === 'export' && (
                  <>
                    <Field label="Engine"><Select value={String(sel.config.engine ?? 'ffmpeg')} onChange={v => patchNode(sel.id, { config: { ...sel.config, engine: v } })} options={[{ value: 'ffmpeg', label: 'ffmpeg (server)' }, { value: 'stems', label: 'Stems (audio)' }, { value: 'bundle', label: 'Project bundle' }]} /></Field>
                    <Field label="Format"><Select value={String(sel.config.format ?? 'mp4')} onChange={v => patchNode(sel.id, { config: { ...sel.config, format: v } })} options={['mp4', 'mov', 'webm']} /></Field>
                    <Field label="Resolution"><Select value={String(sel.config.resolution ?? '1080p')} onChange={v => patchNode(sel.id, { config: { ...sel.config, resolution: v } })} options={['720p', '1080p', '1440p', '4k']} /></Field>
                  </>
                )}
                {(sel.type === 'human-review' || sel.type === 'approve' || sel.type === 'reject') && (
                  <>
                    <Field label="Gate message"><TextArea rows={2} value={String(sel.config.summary ?? '')} onChange={e => patchNode(sel.id, { config: { ...sel.config, summary: e.target.value } })} placeholder="What should the reviewer check?" /></Field>
                    <Field label="Estimated credits shown at gate"><TextInput type="number" min={0} value={Number(sel.config.estimatedCredits ?? 0)} onChange={e => patchNode(sel.id, { config: { ...sel.config, estimatedCredits: Number(e.target.value) } })} /></Field>
                    <Field label="Next stage label"><TextInput value={String(sel.config.nextLabel ?? '')} onChange={e => patchNode(sel.id, { config: { ...sel.config, nextLabel: e.target.value } })} /></Field>
                  </>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <Field label="Retries"><TextInput type="number" min={0} max={5} value={sel.retry} onChange={e => patchNode(sel.id, { retry: Number(e.target.value) })} /></Field>
                  <Field label="Timeout (s)"><TextInput type="number" min={30} max={7200} value={sel.timeoutSec} onChange={e => patchNode(sel.id, { timeoutSec: Number(e.target.value) })} /></Field>
                </div>
                <div className="space-y-1.5 rounded-md border border-line-soft bg-well p-2">
                  <Toggle checked={sel.enabled} onChange={v => patchNode(sel.id, { enabled: v })} label="Node enabled" />
                  <Toggle checked={sel.reviewGate} onChange={v => patchNode(sel.id, { reviewGate: v })} label="Treat as review gate" />
                </div>
                {sel.logs?.length > 0 && (
                  <div>
                    <div className="label mb-1">Node log</div>
                    <div className="scroll-thin max-h-32 overflow-y-auto rounded-md border border-line-soft bg-deep p-2">
                      {sel.logs.slice(-20).map((l, i) => <p key={i} className={cx('mono text-[9.5px] leading-relaxed', l.level === 'error' ? 'text-bad' : l.level === 'warn' ? 'text-accent-bright' : 'text-ink3')}>{l.msg}</p>)}
                    </div>
                  </div>
                )}
                <div className="flex gap-1.5">
                  <Button size="xs" variant="ghost" className="flex-1" onClick={() => { const copy = { ...sel, id: `node_${Math.random().toString(36).slice(2, 12)}`, x: sel.x + 28, y: sel.y + 28, status: 'idle' as const, logs: [] }; setNodes(ns => [...ns, copy]); setSelected(copy.id); markDirty(); }}><Copy size={11} />Duplicate</Button>
                  <Button size="xs" variant="danger" onClick={() => { setNodes(ns => ns.filter(n => n.id !== sel.id)); setEdges(es => es.filter(e => e.from !== sel.id && e.to !== sel.id)); setSelected(null); markDirty(); }}><Trash2 size={11} />Delete</Button>
                </div>
              </div>
            ) : (
              <WorkflowSettings automation={automation} onChange={async p => { try { await apiPatch(`/api/automations/${automation.id}`, p); toast({ level: 'success', title: 'Workflow settings saved' }); } catch (err) { const d = describeError(err); toast({ level: 'error', title: d.title, body: d.body }); } }} />
            )}
          </div>
          <div className="shrink-0 border-t border-line-soft bg-well2 px-3 py-2 text-[10px] leading-relaxed text-ink3">
            Drag from a node's right port to another node's left port to connect. Click an edge to select and delete it.
          </div>
        </aside>
      </div>
    </motion.div>
  );
}

function WorkflowSettings({ automation, onChange }: { automation: Automation; onChange: (p: Partial<Automation>) => Promise<void> }) {
  const [f, setF] = React.useState(automation);
  React.useEffect(() => setF(automation), [automation.id]);
  return (
    <div className="space-y-3">
      <Field label="Name"><TextInput value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Description"><TextArea rows={2} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
      <Field label="Trigger"><Select value={f.trigger} onChange={v => setF({ ...f, trigger: v as never })} options={[{ value: 'manual', label: 'Manual' }, { value: 'schedule', label: 'Schedule (cron)' }, { value: 'webhook', label: 'Webhook' }]} /></Field>
      {f.trigger !== 'manual' && <Field label={f.trigger === 'schedule' ? 'Cron expression' : 'Webhook token'}><TextInput className="mono text-[11px]" value={f.schedule ?? ''} onChange={e => setF({ ...f, schedule: e.target.value })} placeholder={f.trigger === 'schedule' ? '0 3 * * *' : 'secret-token'} /></Field>}
      <Field label="Credit cap per run" hint="The run stops before it would exceed this."><TextInput type="number" min={0} value={f.maxCostCredits} onChange={e => setF({ ...f, maxCostCredits: Number(e.target.value) })} /></Field>
      <div className="space-y-1.5 rounded-md border border-line-soft bg-well p-2">
        <Toggle checked={f.requireApproval} onChange={v => setF({ ...f, requireApproval: v })} label="Require approval for expensive batches" hint="Never spends credits on a large batch without showing the plan first." />
        <Toggle checked={f.enabled} onChange={v => setF({ ...f, enabled: v })} label="Workflow enabled" />
      </div>
      <Button size="sm" variant="primary" className="w-full" onClick={() => void onChange({ name: f.name, description: f.description, trigger: f.trigger, schedule: f.schedule, maxCostCredits: f.maxCostCredits, requireApproval: f.requireApproval, enabled: f.enabled })}><Save size={12} />Save settings</Button>
    </div>
  );
}
