'use client';
import type { BusEvent } from '@/types';

/**
 * Single shared SSE connection for the whole app.
 *
 * Components subscribe; the socket reconnects with backoff and replays the
 * last events server-side, so a dropped connection never loses job progress.
 */
type Listener = (e: BusEvent) => void;
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let attempts = 0;
let connected = false;
const statusListeners = new Set<(s: boolean) => void>();

const TYPES: BusEvent['type'][] = [
  'job:update', 'job:created', 'job:removed', 'asset:created', 'credits:update',
  'project:update', 'automation:update', 'export:update', 'toast', 'review:requested'
];

function open() {
  if (source) return;
  try { source = new EventSource('/api/events'); } catch { return; }
  source.onopen = () => { attempts = 0; connected = true; statusListeners.forEach(f => f(true)); };
  for (const t of TYPES) {
    source.addEventListener(t, (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as BusEvent;
        listeners.forEach(l => l(data));
      } catch { /* ignore malformed frame */ }
    });
  }
  source.onerror = () => {
    connected = false; statusListeners.forEach(f => f(false));
    source?.close(); source = null;
    const delay = Math.min(15_000, 700 * 2 ** Math.min(5, attempts++));
    setTimeout(() => { if (listeners.size) open(); }, delay);
  };
}

export function subscribeEvents(l: Listener): () => void {
  listeners.add(l);
  open();
  return () => {
    listeners.delete(l);
    if (!listeners.size && source) { source.close(); source = null; }
  };
}
export function onConnectionChange(l: (s: boolean) => void) { statusListeners.add(l); return () => statusListeners.delete(l); }
export function isEventStreamConnected() { return connected; }
