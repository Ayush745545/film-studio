'use client';
import * as React from 'react';
import { post, get, describeError } from '@/lib/client/api';
import { useApp } from '@/store/app';
import type { GenerationJob } from '@/types';

/**
 * Run a one-shot text generation through the real queue and wait for it.
 *
 * Used where a stage needs a written result inline (idea refinement, logline
 * alternatives, prompt rewriting) rather than a durable asset. It still goes
 * through the router, so model choice, credits, demo fallback and error
 * handling all behave exactly like any other generation.
 */
export function useTextJob(projectId?: string | null) {
  const toast = useApp(s => s.toast);
  const [busy, setBusy] = React.useState(false);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => () => { alive.current = false; }, []);

  const run = React.useCallback(async (opts: {
    prompt: string; system?: string; json?: boolean; label?: string;
    modelId?: string | null; presetId?: string | null; temperature?: number; maxTokens?: number;
  }): Promise<{ text: string; json: unknown; demo: boolean } | null> => {
    setBusy(true);
    try {
      const res = await post<{ job: GenerationJob }>('/api/generate', {
        kind: 'text', prompt: opts.prompt, projectId: projectId ?? null,
        modelId: opts.modelId ?? null, presetId: opts.presetId ?? null,
        name: opts.label ?? 'Text generation',
        text: { system: opts.system, responseFormat: opts.json ? 'json' : 'text', temperature: opts.temperature, maxTokens: opts.maxTokens }
      });
      const id = res.job.id;
      setJobId(id);
      const started = Date.now();
      for (;;) {
        const j = await get<GenerationJob>(`/api/jobs/${id}`);
        if (j.status === 'succeeded') {
          const out = (j.output ?? {}) as { text?: string; json?: unknown; demo?: boolean };
          return { text: out.text ?? '', json: out.json ?? null, demo: Boolean(out.demo ?? j.demo) };
        }
        if (j.status === 'failed' || j.status === 'cancelled') {
          throw new Error(j.error?.message ?? `Job ${j.status}`);
        }
        if (Date.now() - started > 180_000) throw new Error('The model took too long to respond');
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      const d = describeError(err);
      toast({ level: 'error', title: d.title, body: d.body, ttl: 10000 });
      return null;
    } finally {
      if (alive.current) { setBusy(false); setJobId(null); }
    }
  }, [projectId, toast]);

  return { run, busy, jobId };
}
