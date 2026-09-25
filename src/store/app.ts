'use client';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { get as apiGet, post, patch as apiPatch } from '@/lib/client/api';
import { subscribeEvents } from '@/lib/client/events';
import type { BootstrapPayload, ProjectSummary } from '@/lib/bootstrap';
import type {
  Asset, BusEvent, GenerationJob, ModelDescriptor, ModelPreset, Plan, Provider, Subscription, User, Project
} from '@/types';

/** The bootstrap payload shape, shared with the server builder. */
export type Bootstrap = BootstrapPayload;
export type { ProjectSummary };

export interface Toast { id: string; level: 'info' | 'success' | 'error' | 'warn'; title: string; body?: string; action?: { label: string; run: () => void }; ttl?: number }

interface AppState {
  boot: Bootstrap | null;
  booting: boolean;
  bootError: string | null;
  toasts: Toast[];
  jobs: GenerationJob[];
  jobCounts: Record<string, number>;
  credits: number;
  connected: boolean;
  ui: {
    sidebar: boolean; queue: boolean; palette: boolean; copilot: boolean; search: boolean; upgrade: boolean; shortcuts: boolean; usage: boolean;
  };
  recentAssets: Asset[];

  hydrate: (payload: Bootstrap) => void;
  load: (force?: boolean) => Promise<void>;
  reload: (part?: 'models' | 'providers' | 'projects' | 'subscription') => Promise<void>;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
  setUi: (k: keyof AppState['ui'], v: boolean) => void;
  applyEvent: (e: BusEvent) => void;
}

let unsub: (() => void) | null = null;
let toastSeq = 0;

const useAppStore = create<AppState>()((set, get) => ({
  boot: null, booting: false, bootError: null,
  toasts: [], jobs: [], jobCounts: {}, credits: 0, connected: false,
  ui: { sidebar: true, queue: false, palette: false, copilot: false, search: false, upgrade: false, shortcuts: false, usage: false },
  recentAssets: [],

  /**
   * Seed the store from the server-rendered payload.
   *
   * Called once before the first client render so the workspace paints with
   * real data instead of a splash screen. Idempotent: a later `load()` still
   * refreshes everything from `/api/bootstrap`.
   */
  hydrate(payload) {
    if (!payload) return;
    set({
      boot: payload, booting: false, bootError: null,
      credits: payload.subscription?.credits ?? 0,
      jobs: payload.queue?.active ?? [],
      jobCounts: (payload.queue?.counts ?? {}) as Record<string, number>
    });
    if (!unsub) unsub = subscribeEvents(e => get().applyEvent(e));
  },

  async load(force) {
    if (!force && (get().boot || get().booting)) {
      // Already hydrated from SSR: still open the event stream, but skip the
      // round trip unless the caller asked for a refresh.
      if (get().boot && !unsub) unsub = subscribeEvents(e => get().applyEvent(e));
      if (!force) return;
    }
    set({ booting: true, bootError: null });
    try {
      const boot = await apiGet<Bootstrap>('/api/bootstrap');
      set({
        boot, booting: false,
        credits: boot.subscription.credits,
        jobs: boot.queue.active,
        jobCounts: boot.queue.counts as Record<string, number>,
        recentAssets: []
      });
      if (!unsub) unsub = subscribeEvents(e => get().applyEvent(e));
    } catch (err) {
      set({ booting: false, bootError: (err as Error).message });
    }
  },

  async reload(part) {
    try {
      if (part === 'subscription' || !part) {
        const c = await apiGet<{ subscription: Subscription }>('/api/credits');
        set(s => ({ boot: s.boot ? { ...s.boot, subscription: c.subscription } : s.boot, credits: c.subscription.credits }));
      }
      if (part === 'projects' || !part) {
        const p = await apiGet<{ projects: Bootstrap['projects'] }>('/api/projects');
        set(s => ({ boot: s.boot ? { ...s.boot, projects: p.projects } : s.boot }));
      }
      if (part === 'models' || part === 'providers' || !part) {
        const [m, pr] = await Promise.all([apiGet<{ models: ModelDescriptor[] }>('/api/models'), apiGet<{ providers: Provider[] }>('/api/providers')]);
        set(s => ({ boot: s.boot ? { ...s.boot, models: m.models, providers: pr.providers } : s.boot }));
      }
    } catch { /* surface via toast at call site */ }
  },

  toast(t) {
    const id = `t${++toastSeq}`;
    set(s => ({ toasts: [...s.toasts, { ...t, id }].slice(-5) }));
    const ttl = t.ttl ?? (t.level === 'error' ? 9000 : 4200);
    if (ttl > 0) setTimeout(() => get().dismiss(id), ttl);
  },
  dismiss(id) { set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })) },
  setUi(k, v) { set(s => ({ ui: { ...s.ui, [k]: v } })) },

  applyEvent(e) {
    switch (e.type) {
      case 'job:created':
        set(s => ({ jobs: [e.job, ...s.jobs.filter(j => j.id !== e.job.id)].slice(0, 60) }));
        break;
      case 'job:update': {
        set(s => {
          const jobs = s.jobs.some(j => j.id === e.job.id)
            ? s.jobs.map(j => j.id === e.job.id ? e.job : j)
            : [e.job, ...s.jobs];
          const counts = {
            queued: jobs.filter(j => j.status === 'queued').length,
            running: jobs.filter(j => j.status === 'running').length,
            paused: jobs.filter(j => j.status === 'paused').length
          };
          return { jobs: jobs.slice(0, 60), jobCounts: counts };
        });
        if (e.job.status === 'failed') {
          get().toast({ level: 'error', title: `${e.job.label} failed`, body: e.job.error?.suggestion ?? e.job.error?.message, ttl: 12000 });
        }
        if (e.job.status === 'succeeded' && e.job.kind !== 'text') {
          get().toast({ level: 'success', title: `${e.job.label} complete`, body: e.job.demo ? 'Built-in Studio Engine — previsualisation media' : undefined });
        }
        break;
      }
      case 'job:removed':
        set(s => ({ jobs: s.jobs.filter(j => j.id !== e.id) }));
        break;
      case 'asset:created':
        // Dedupe by id: the SSE stream replays recent events on reconnect, so
        // the same asset can legitimately arrive more than once. Without this
        // React sees two children with one key.
        set(s => ({
          recentAssets: [e.asset, ...s.recentAssets.filter(a => a.id !== e.asset.id)].slice(0, 40)
        }));
        break;
      case 'credits:update':
        set({ credits: e.credits });
        break;
      case 'toast':
        get().toast({ level: e.level, title: e.title, body: e.body });
        break;
      case 'review:requested':
        get().toast({ level: 'warn', title: 'Workflow is waiting for your review', body: e.run.review?.prompt, ttl: 0 });
        break;
      default: break;
    }
  }
}));

/* ─────────────────────────────────────────────────────────────
   Shallow-by-default store hook.

   Zustand v5 passes `api.getInitialState` to React as getServerSnapshot. If a
   selector allocates a fresh array/object on each call, React's snapshot
   comparison never settles and you get:

     "The result of getServerSnapshot should be cached to avoid an infinite loop"

   Wrapping every selector in `useShallow` makes that structurally impossible:
   a structurally-equal result keeps its previous identity. Primitives and
   store-owned references behave exactly as before (Object.is), so this is pure
   upside — fewer re-renders, and no way to reintroduce the bug by accident.
   ───────────────────────────────────────────────────────────── */

export const useApp = Object.assign(
  function useApp<T>(selector: (state: AppState) => T): T {
    return useAppStore(useShallow(selector));
  },
  {
    getState: useAppStore.getState,
    setState: useAppStore.setState,
    subscribe: useAppStore.subscribe,
    getInitialState: useAppStore.getInitialState,
    /** Escape hatch: the un-wrapped zustand hook. */
    raw: useAppStore
  }
);


/* ── helpers used across the UI ─────────────────────────── */
/**
 * Selector results must be referentially stable.
 *
 * A selector like `s => s.boot?.plans ?? []` allocates a fresh array on every
 * call, so React's `getServerSnapshot` comparison never settles and you get
 * "The result of getServerSnapshot should be cached to avoid an infinite loop"
 * during SSR/hydration. These module-level constants are the stable empties;
 * derived lists go through `useShallow` so an equal result keeps its identity.
 */
/**
 * `useBoot` resolves from the live store first, falling back to the
 * server-rendered context payload. Import lives in ./boot-accessors to avoid a
 * cycle (the context module only needs the Bootstrap *type*).
 */
export { useBoot, useDemoMode, useFfmpeg, useModels, usePresets, useProviders, usePlans, useProjects } from './boot-accessors';

export async function jobAction(id: string, action: 'cancel' | 'retry' | 'pause' | 'resume' | 'priority', priority?: number) {
  return apiPatch<{ ok: boolean }>(`/api/jobs/${id}`, { action, priority });
}
export async function notifyServer(url: string, body: unknown) { return post(url, body); }
