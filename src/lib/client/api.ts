'use client';

export class ApiError extends Error {
  code: string; hint?: string; status: number; details?: unknown;
  constructor(message: string, code: string, status: number, hint?: string, details?: unknown) {
    super(message);
    this.name = 'ApiError'; this.code = code; this.status = status; this.hint = hint; this.details = details;
  }
}

interface ErrEnvelope { ok: false; error: { message: string; code: string; hint?: string; details?: unknown } }
interface OkEnvelope<T> { ok: true; data: T }

async function parse<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try { body = await res.json(); } catch { /* non-JSON response */ }
  if (!res.ok || (body && (body as ErrEnvelope).ok === false)) {
    const e = (body as ErrEnvelope | null)?.error;
    throw new ApiError(e?.message ?? `Request failed (${res.status})`, e?.code ?? 'error', res.status, e?.hint, e?.details);
  }
  return (body as OkEnvelope<T>).data;
}

export async function get<T>(url: string, opts?: RequestInit): Promise<T> {
  return parse<T>(await fetch(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers ?? {}) } }));
}
export async function post<T>(url: string, body?: unknown, opts?: RequestInit): Promise<T> {
  return parse<T>(await fetch(url, {
    method: 'POST', ...opts,
    headers: { 'content-type': 'application/json', accept: 'application/json', ...(opts?.headers ?? {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  }));
}
export async function patch<T>(url: string, body?: unknown): Promise<T> {
  return parse<T>(await fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body ?? {}) }));
}
export async function del<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { method: 'DELETE', headers: { accept: 'application/json' } }));
}
export async function upload<T>(url: string, form: FormData): Promise<T> {
  return parse<T>(await fetch(url, { method: 'POST', body: form }));
}

/** Human-readable message for any failure, including the server's hint. */
export function describeError(err: unknown): { title: string; body?: string } {
  if (err instanceof ApiError) return { title: err.message, body: err.hint };
  if (err instanceof Error) return { title: err.message };
  return { title: 'Something went wrong' };
}
