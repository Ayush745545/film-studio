import type { BusEvent } from '@/types';

/**
 * In-process event bus.
 *
 * Workers publish; the SSE endpoint (`/api/events`) subscribes per connection.
 * Because generation workers run inside the same Node process as the API
 * (AFS_QUEUE_DRIVER=memory) this is enough for real-time UI. Swapping to
 * Redis pub/sub for multi-instance deployments means replacing `publish` and
 * `subscribe` — no call site changes.
 */
type Listener = (e: BusEvent) => void;

class Bus {
  private listeners = new Set<Listener>();
  private recent: { e: BusEvent; t: number }[] = [];
  private maxRecent = 200;

  publish(e: BusEvent) {
    this.recent.push({ e, t: Date.now() });
    if (this.recent.length > this.maxRecent) this.recent.splice(0, this.recent.length - this.maxRecent);
    for (const l of [...this.listeners]) {
      try { l(e); } catch (err) { console.warn('[bus] listener error', (err as Error).message); }
    }
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => { this.listeners.delete(l); };
  }
  /** Replay recent events so a reconnecting client catches up without a full refetch. */
  since(ms: number): BusEvent[] {
    const cut = Date.now() - ms;
    return this.recent.filter(r => r.t >= cut).map(r => r.e);
  }
  get size() { return this.listeners.size; }
}

const g = globalThis as unknown as { afsBus?: Bus };
export const bus: Bus = (g.afsBus ??= new Bus());
