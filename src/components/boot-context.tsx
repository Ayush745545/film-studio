'use client';
import * as React from 'react';
import type { Bootstrap } from '@/store/app';

/**
 * Server-resolved bootstrap data, delivered through React context.
 *
 * Why not just push it into Zustand before render? Because zustand v5 wires
 * `getServerSnapshot` to `api.getInitialState()`, so anything written with
 * `setState()` during SSR is invisible to the server render — the page paints
 * a loading state and then swaps. Context is part of the render tree, so it
 * participates in SSR correctly and produces identical markup on both sides
 * (no hydration mismatch).
 *
 * `useBoot()` prefers the live store once the client has synced, so credits,
 * queue and projects keep updating after the first paint.
 */
const BootContext = React.createContext<Bootstrap | null>(null);

export function BootProvider({ value, children }: { value: Bootstrap | null; children: React.ReactNode }) {
  return <BootContext.Provider value={value}>{children}</BootContext.Provider>;
}

export function useBootContext(): Bootstrap | null {
  return React.useContext(BootContext);
}
