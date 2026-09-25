'use client';
import * as React from 'react';
import { useApp } from '@/store/app';
import { useEditor } from '@/store/editor';
import { useProject } from '@/store/project';

export interface ShortcutDef { keys: string; label: string; group: string; scope: 'global' | 'editor' }

export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Space', label: 'Play / pause', group: 'Transport', scope: 'global' },
  { keys: 'J', label: 'Reverse (press twice for 2×)', group: 'Transport', scope: 'global' },
  { keys: 'K', label: 'Stop', group: 'Transport', scope: 'global' },
  { keys: 'L', label: 'Forward (press twice for 2×)', group: 'Transport', scope: 'global' },
  { keys: '← / →', label: 'Step one frame', group: 'Transport', scope: 'global' },
  { keys: '⇧ ← / →', label: 'Step ten frames', group: 'Transport', scope: 'global' },
  { keys: 'Home / End', label: 'Go to start / end', group: 'Transport', scope: 'global' },
  { keys: 'I', label: 'Mark in', group: 'Editing', scope: 'editor' },
  { keys: 'O', label: 'Mark out', group: 'Editing', scope: 'editor' },
  { keys: 'M', label: 'Add marker at playhead', group: 'Editing', scope: 'editor' },
  { keys: 'S', label: 'Split at playhead', group: 'Editing', scope: 'editor' },
  { keys: 'V', label: 'Selection tool', group: 'Editing', scope: 'editor' },
  { keys: 'T', label: 'Trim tool', group: 'Editing', scope: 'editor' },
  { keys: 'C', label: 'Razor tool', group: 'Editing', scope: 'editor' },
  { keys: 'H', label: 'Hand / pan tool', group: 'Editing', scope: 'editor' },
  { keys: 'A', label: 'Add selected asset at playhead', group: 'Editing', scope: 'editor' },
  { keys: 'Delete', label: 'Delete clip', group: 'Editing', scope: 'editor' },
  { keys: '⇧ Delete', label: 'Ripple delete', group: 'Editing', scope: 'editor' },
  { keys: 'N', label: 'Snap toggle', group: 'Editing', scope: 'editor' },
  { keys: '+ / −', label: 'Zoom timeline', group: 'Editing', scope: 'editor' },
  { keys: '⌘/Ctrl Z', label: 'Undo', group: 'General', scope: 'global' },
  { keys: '⇧ ⌘/Ctrl Z', label: 'Redo', group: 'General', scope: 'global' },
  { keys: '⌘/Ctrl S', label: 'Save now', group: 'General', scope: 'global' },
  { keys: '⌘/Ctrl K', label: 'Command palette', group: 'General', scope: 'global' },
  { keys: '⌘/Ctrl F', label: 'Search project', group: 'General', scope: 'global' },
  { keys: '⌘/Ctrl J', label: 'Generation queue', group: 'General', scope: 'global' },
  { keys: '⌘/Ctrl .', label: 'AI copilot', group: 'General', scope: 'global' },
  { keys: '1 – 9', label: 'Jump to production stage', group: 'General', scope: 'global' },
  { keys: 'F', label: 'Fullscreen preview', group: 'General', scope: 'editor' },
  { keys: '?', label: 'This dialog', group: 'General', scope: 'global' }
];

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  if (!n) return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || n.isContentEditable;
};

export function useHotkeys() {
  const setUi = useApp(s => s.setUi);
  const lastJ = React.useRef(0);
  const lastL = React.useRef(0);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const ed = useEditor.getState();
      const app = useApp.getState();
      const proj = useProject.getState();
      const inEditor = Boolean(ed.timeline);

      // global chords
      if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? ed.redo() : ed.undo(); return; }
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void ed.flush(); app.toast({ level: 'success', title: 'Saved', body: 'Project and timeline written to the database.' }); return; }
      if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); app.setUi('search', !app.ui.search); return; }
      if (mod && e.key.toLowerCase() === 'j') { e.preventDefault(); app.setUi('queue', !app.ui.queue); return; }
      if (mod && e.key === '.') { e.preventDefault(); app.setUi('copilot', !app.ui.copilot); return; }
      if (mod) return;

      if (isTyping(e.target)) return;

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) { e.preventDefault(); app.setUi('shortcuts', true); return; }
      if (e.key === 'Escape') {
        if (app.ui.palette || app.ui.queue || app.ui.copilot || app.ui.search || app.ui.upgrade || app.ui.shortcuts || app.ui.usage) {
          app.setUi('palette', false); app.setUi('queue', false); app.setUi('copilot', false);
          app.setUi('search', false); app.setUi('upgrade', false); app.setUi('shortcuts', false); app.setUi('usage', false);
        } else if (ed.selection.length) ed.select([]);
        return;
      }

      // transport
      if (e.code === 'Space') { e.preventDefault(); ed.set({ playing: !ed.playing }); return; }
      if (e.key.toLowerCase() === 'k') { ed.set({ playing: false }); ed.setPlayhead(ed.playhead); return; }
      if (e.key.toLowerCase() === 'j') {
        const now = Date.now();
        const boost = now - lastJ.current < 700;
        lastJ.current = now;
        ed.set({ playing: true, rate: boost ? -2 : -1 });
        return;
      }
      if (e.key.toLowerCase() === 'l') {
        const now = Date.now();
        const boost = now - lastL.current < 700;
        lastL.current = now;
        ed.set({ playing: true, rate: boost ? 2 : 1 });
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); ed.nudge(e.shiftKey ? -10 : -1); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); ed.nudge(e.shiftKey ? 10 : 1); return; }
      if (e.key === 'Home') { ed.setPlayhead(0, { snap: false }); return; }
      if (e.key === 'End') { ed.setPlayhead(ed.duration(), { snap: false }); return; }

      if (!inEditor) {
        // stage navigation 1..9 then 0
        const n = Number(e.key);
        if (!Number.isNaN(n) && proj.project) {
          const idx = n === 0 ? 9 : n - 1;
          const stages = ['idea','story','script','characters','world','scenes','storyboard','shots','video'] as const;
          if (idx < stages.length) { proj.setStage(stages[idx]); }
        }
        return;
      }

      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); ed.splitAtPlayhead(); break;
        case 'v': ed.setTool('select'); break;
        case 't': ed.setTool('trim'); break;
        case 'c': ed.setTool('razor'); break;
        case 'h': ed.setTool('hand'); break;
        case 'i': ed.markIn(); break;
        case 'o': ed.markOut(); break;
        case 'm': ed.addMarker(); break;
        case 'n': ed.set({ snap: !ed.snap }); break;
        case 'f': ed.set({ previewScale: ed.previewScale === 1 ? 0 : 1 }); break;
        case 'delete': case 'backspace': e.preventDefault(); ed.deleteSelected(e.shiftKey); break;
        case '+': case '=': ed.set({ zoom: Math.min(600, ed.zoom * 1.25) }); break;
        case '-': case '_': ed.set({ zoom: Math.max(4, ed.zoom / 1.25) }); break;
        default: {
          const d = Number(e.key);
          if (!Number.isNaN(d) && d >= 1 && d <= 9 && proj.project) {
            const stages = ['idea','story','script','characters','world','scenes','storyboard','shots','video','voice','sound','aiedit','editor','color','export'] as const;
            if (d - 1 < stages.length) proj.setStage(stages[d - 1]);
          }
        }
      }
      void setUi;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setUi]);
}
