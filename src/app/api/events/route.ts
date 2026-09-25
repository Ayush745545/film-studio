import { bus } from '@/lib/events';
import { currentUser } from '@/lib/security/auth';
import { ensureBooted } from '@/lib/boot';
import type { BusEvent } from '@/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * Server-Sent Events stream.
 *
 * Carries job progress, asset creation, credit balance, automation review
 * requests and export progress to every open client. On (re)connect the last
 * few seconds of events are replayed so nothing is missed during a refresh.
 */
export async function GET(req: Request) {
  await ensureBooted();
  const user = await currentUser();
  if (!user) return new Response('unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try { controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); }
        catch { closed = true; }
      };
      send('hello', { userId: user.id, at: Date.now() });
      for (const e of bus.since(20_000)) send(e.type, e);

      const off = bus.subscribe((e: BusEvent) => {
        // Never leak another user's data down this socket.
        const anyE = e as unknown as Record<string, any>;
        const owner = anyE.job?.userId ?? anyE.asset?.userId ?? anyE.run?.userId ?? anyE.export?.userId;
        if (owner && owner !== user.id) return;
        if (e.type === 'project:update' && anyE.patch?.userId && anyE.patch.userId !== user.id) return;
        send(e.type, e);
      });

      const ping = setInterval(() => send('ping', { t: Date.now() }), 20_000);
      req.signal.addEventListener('abort', () => {
        closed = true; clearInterval(ping); off();
        try { controller.close(); } catch { /* already closed */ }
      }, { once: true });
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    }
  });
}
