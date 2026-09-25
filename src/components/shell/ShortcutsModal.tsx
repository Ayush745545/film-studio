'use client';
import { Modal } from '@/components/ui/overlays';
import { Kbd } from '@/components/ui/primitives';
import { useApp } from '@/store/app';
import { SHORTCUTS } from '@/hooks/useHotkeys';

export function ShortcutsModal() {
  const open = useApp(s => s.ui.shortcuts);
  const setUi = useApp(s => s.setUi);
  const groups = [...new Set(SHORTCUTS.map(s => s.group))];
  return (
    <Modal open={open} onClose={() => setUi('shortcuts', false)} width={620} title="Keyboard shortcuts"
      sub="Built for two hands on the keyboard: transport on the left, editing on the right.">
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
        {groups.map(g => (
          <div key={g}>
            <div className="label mb-2">{g}</div>
            <ul className="space-y-1.5">
              {SHORTCUTS.filter(s => s.group === g).map(s => (
                <li key={s.keys + s.label} className="flex items-center justify-between gap-3">
                  <span className="text-[11.5px] text-ink2">{s.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {s.keys.split(' ').map((k, i) => k === '/' ? <span key={i} className="text-ink3">/</span> : <Kbd key={i}>{k}</Kbd>)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-5 rounded-md border border-line-soft bg-well px-3 py-2 text-[11px] leading-relaxed text-ink3">
        Shortcuts are disabled while a text field has focus, so you can type prompts without cutting clips.
        Double-click any slider to reset it to zero.
      </p>
    </Modal>
  );
}
