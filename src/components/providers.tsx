'use client';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useApp, type Bootstrap } from '@/store/app';
import { BootProvider } from '@/components/boot-context';
import { Toaster } from '@/components/ui/overlays';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { GlobalSearch } from '@/components/shell/GlobalSearch';
import { UpgradeModal } from '@/components/shell/UpgradeModal';
import { ShortcutsModal } from '@/components/shell/ShortcutsModal';
import { useEventBridge } from '@/hooks/useEventBridge';
import { useHotkeys } from '@/hooks/useHotkeys';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 12_000, refetchOnWindowFocus: false, retry: 1, gcTime: 5 * 60_000 },
    mutations: { retry: 0 }
  }
});

/**
 * `initialBoot` comes from the server-rendered layout. We seed the store in a
 * state initialiser — which runs before the first paint — so there is no
 * loading flash and no hydration mismatch.
 */
export function Providers({ children, initialBoot }: { children: React.ReactNode; initialBoot?: Bootstrap | null }) {
  const load = useApp(s => s.load);
  const setUi = useApp(s => s.setUi);
  const bootError = useApp(s => s.bootError);

  // Push the server payload into the store on mount so subsequent updates
  // (SSE job events, credit changes, reloads) flow through one source of truth.
  // The first paint itself comes from BootProvider — see boot-context.tsx.
  React.useEffect(() => {
    if (initialBoot) useApp.getState().hydrate(initialBoot);
    void load(Boolean(initialBoot));
  }, [load, initialBoot]);
  useEventBridge();
  useHotkeys();

  return (
    <QueryClientProvider client={queryClient}>
      <BootProvider value={initialBoot ?? null}>
      <div className="app-root flex h-full w-full flex-col overflow-hidden bg-bg text-ink">
        {bootError && (
          <div className="flex items-center gap-2 border-b border-bad/30 bg-bad/10 px-4 py-2 text-[12px] text-bad">
            <span className="font-semibold">Could not reach the server.</span>
            <span className="text-ink2">{bootError}</span>
            <button className="ml-auto underline decoration-dotted hover:text-ink" onClick={() => void load()}>Retry</button>
          </div>
        )}
        {children}
      </div>
      <Toaster />
      <CommandPalette />
      <GlobalSearch />
      <UpgradeModal />
      <ShortcutsModal />
      <GlobalKeyboardHint onOpenPalette={() => setUi('palette', true)} />
      </BootProvider>
    </QueryClientProvider>
  );
}

function GlobalKeyboardHint({ onOpenPalette }: { onOpenPalette: () => void }) {
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); onOpenPalette(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onOpenPalette]);
  return null;
}
