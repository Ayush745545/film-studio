import { useMemo } from 'react';
import { useBootContext } from '@/components/boot-context';
import { useApp, type Bootstrap } from './app';
import type { ModelDescriptor, ModelPreset, Plan, Provider } from '@/types';
import type { ProjectSummary } from '@/lib/bootstrap';

/**
 * Boot-data accessors.
 *
 * Each one reads the live Zustand store first and falls back to the
 * server-rendered context payload, so the very first paint already has real
 * data (no loading splash) while later updates still flow through the store.
 *
 * Every value returned here is referentially stable — either a store-owned
 * reference or a module-level empty constant. Returning a fresh `[]` on each
 * call would make React's `getServerSnapshot` comparison loop forever
 * ("The result of getServerSnapshot should be cached…").
 */
const EMPTY_MODELS: ModelDescriptor[] = [];
const EMPTY_PRESETS: ModelPreset[] = [];
const EMPTY_PROVIDERS: Provider[] = [];
const EMPTY_PLANS: Plan[] = [];
const EMPTY_PROJECTS: ProjectSummary[] = [];

export function useBoot(): Bootstrap | null {
  const fromStore = useApp(s => s.boot);
  const fromContext = useBootContext();
  return fromStore ?? fromContext;
}

export function useCredits(): number { return useApp(s => s.credits); }
export function useDemoMode(): boolean { return useBoot()?.demoMode ?? true; }
export function useFfmpeg(): boolean { return useBoot()?.ffmpeg ?? false; }
export function usePresets(): ModelPreset[] { return useBoot()?.presets ?? EMPTY_PRESETS; }
export function useProviders(): Provider[] { return useBoot()?.providers ?? EMPTY_PROVIDERS; }
export function usePlans(): Plan[] { return useBoot()?.plans ?? EMPTY_PLANS; }
export function useProjects(): ProjectSummary[] { return useBoot()?.projects ?? EMPTY_PROJECTS; }

export function useModels(kind?: string): ModelDescriptor[] {
  const all = useBoot()?.models ?? EMPTY_MODELS;
  return useMemo(() => {
    if (!kind) return all;
    return all.filter(m => m.kind === kind || (m.capabilities as string[]).includes(kind));
  }, [all, kind]);
}
