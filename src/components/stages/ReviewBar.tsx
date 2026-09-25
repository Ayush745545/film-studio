'use client';
import * as React from 'react';
import { Check, X, RefreshCw, ArrowRight, Pencil, History, ShieldCheck } from 'lucide-react';
import { Button, Badge, cx, Tip } from '@/components/ui/primitives';
import { STAGE_META, STAGES, type StageId } from '@/types';
import { useProject } from '@/store/project';

/**
 * The review/next-step footer every stage ends with.
 *
 * It encodes the core loop: AI generates → user reviews → user approves → next
 * stage. Approval is explicit and persisted, so automation and the router know
 * what is safe to build on.
 */
export function ReviewBar({ approved, onApprove, onReject, onRegenerate, onEdit, busy, next, nextLabel, note, count }: {
  approved?: boolean; onApprove?: () => void; onReject?: () => void; onRegenerate?: () => void; onEdit?: () => void;
  busy?: boolean; next?: StageId | null; nextLabel?: string; note?: React.ReactNode; count?: string;
}) {
  const stage = useProject(s => s.stage);
  const setStage = useProject(s => s.setStage);
  const target = next ?? (STAGES[STAGES.indexOf(stage) + 1] ?? null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && <div className="mr-auto min-w-0 flex-1 text-[11px] leading-snug text-ink2">{note}</div>}
      {!note && count && <span className="mr-auto text-[11px] text-ink3">{count}</span>}
      {onEdit && <Button size="sm" variant="ghost" onClick={onEdit} disabled={busy}><Pencil size={12} />Edit manually</Button>}
      {onRegenerate && (
        <Tip label="Regenerate — the current version is saved as a revision first">
          <Button size="sm" variant="ghost" onClick={onRegenerate} disabled={busy}><RefreshCw size={12} />Regenerate</Button>
        </Tip>
      )}
      {onReject && <Button size="sm" variant="ghost" onClick={onReject} disabled={busy || approved === false}><X size={12} />Reject</Button>}
      {onApprove && (
        <Button size="sm" variant={approved ? 'default' : 'primary'} onClick={onApprove} disabled={busy}>
          {approved ? <><ShieldCheck size={12} />Approved</> : <><Check size={12} />Approve</>}
        </Button>
      )}
      {target && (
        <Button size="sm" variant={approved ? 'primary' : 'default'} onClick={() => setStage(target)} iconRight={<ArrowRight size={12} />}>
          {nextLabel ?? `Next: ${STAGE_META[target].label}`}
        </Button>
      )}
      {approved && <Badge tone="ok" className="ml-1"><Check size={9} />locked in</Badge>}
    </div>
  );
}

export function StageProgressDots({ stage }: { stage: StageId }) {
  return (
    <div className={cx('flex items-center gap-1')}>
      {STAGES.map((s, i) => (
        <span key={s} title={STAGE_META[s].label}
          className={cx('h-1 rounded-full transition-all',
            s === stage ? 'w-4 bg-accent' : i < STAGES.indexOf(stage) ? 'w-1.5 bg-ok/60' : 'w-1.5 bg-white/10')} />
      ))}
    </div>
  );
}
