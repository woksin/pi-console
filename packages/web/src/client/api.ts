import type { MemoryActionAvailability, MemoryActionReceipt, MemoryActionRequest, Event as ApiEvent, AttentionItem, Job, MemoryItem, Message, NeedsYou, Question, Request, Reset, Session, SessionDetail, SessionMemory, Transcript, TranscriptEntry } from '@pi-console/contract';
import type { WindowedCollection } from '@pi-console/viewmodels';
import type { HealthRecord } from '../state/state.ts';
import { SseParser } from './sse.ts';

export class Unauthorized extends Error {}

export interface ListItems { sessions: Session; requests: Request; questions: Question; messages: Message; jobs: Job; resets: Reset }
/** One keyset page of a list endpoint (`limit` sent); `nextCursor` is opaque. */
export interface ListPage<C extends WindowedCollection = WindowedCollection> { items: ListItems[C][]; nextCursor: string | null; hasMore: boolean; total: number }
export interface PageParams { limit: number; after?: string | null; order?: 'asc' | 'desc' }

export interface Api {
  needsYou(): Promise<AttentionItem[]>;
  health(): Promise<HealthRecord | null>;
  transcript(sessionId: string, after: number | undefined, limit: number, options?: { order?: 'asc' | 'desc'; around?: string; signal?: AbortSignal }): Promise<Transcript>;
  /** A page of one list, in order; `null` when the daemon does not know the route. */
  page<C extends WindowedCollection>(collection: C, params: PageParams): Promise<ListPage<C> | null>;
  /** Complete per-session detail (its jobs, requests, questions, resets, subagents). */
  session(id: string): Promise<SessionDetail | null>;
  /** The session's memory summary; `null` against a daemon without the route or for an unknown session. */
  sessionMemory(id: string): Promise<SessionMemory | null>;
  /** The newest memory items of one session (read-only; the console never writes memory). */
  memoryItems(sessionId: string, limit: number): Promise<MemoryItem[] | null>;
  memoryActionAvailability(id: string, signal?: AbortSignal): Promise<MemoryActionAvailability | null>;
  requestMemoryAction(id: string, request: MemoryActionRequest, signal?: AbortSignal): Promise<MemoryActionReceipt>;
  memoryActionReceipt(id: string, signal?: AbortSignal): Promise<MemoryActionReceipt>;
  /** Opens the event stream; resolves when the stream ends or throws on failure. */
  stream(lastEventId: number, signal: AbortSignal, onFrame: (event: ApiEvent | 'heartbeat') => void): Promise<void>;
}

export function createApi(token: string, base = '', fetcher: typeof fetch = (...args) => fetch(...args)): Api {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra });

  async function get<T>(path: string, signal?: AbortSignal): Promise<T | null> {
    const response = await fetcher(`${base}/api/v1${path}`, { headers: headers(), cache: 'no-store', signal });
    if (response.status === 401) throw new Unauthorized();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${path} failed: ${String(response.status)}`);
    return await response.json() as T;
  }

  async function reviewJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetcher(`${base}/api/v1${path}`, { ...init, headers: headers({ 'Content-Type': 'application/json' }), cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
    }
    return await response.json() as T;
  }

  return {
    memoryActionAvailability: (id, signal) => reviewJson<MemoryActionAvailability>(`/sessions/${encodeURIComponent(id)}/memory-actions`, { signal }).catch(() => null),
    requestMemoryAction: (id, request, signal) => reviewJson(`/sessions/${encodeURIComponent(id)}/memory-actions`, { method: 'POST', body: JSON.stringify(request), signal }),
    memoryActionReceipt: (id, signal) => reviewJson(`/memory-actions/${encodeURIComponent(id)}`, { signal }),
    async needsYou() { return (await get<NeedsYou>('/needs-you'))?.items ?? []; },
    async health() { return await get<HealthRecord>('/health'); },
    async transcript(sessionId, after, limit, options = {}) {
      const query = new URLSearchParams({ limit: String(limit) });
      if (after !== undefined) query.set('after', String(after));
      if (options.order) query.set('order', options.order);
      if (options.around) query.set('around', options.around);
      const page = await get<Transcript>(`/sessions/${encodeURIComponent(sessionId)}/transcript?${query.toString()}`, options.signal);
      if (!page && options.around) throw new Error('Transcript entry not found.');
      return page ?? { items: [] as TranscriptEntry[], nextCursor: after ?? 0, hasMore: false };
    },
    async page(collection, params) {
      const query = new URLSearchParams({ limit: String(params.limit), order: params.order ?? 'asc' });
      if (params.after) query.set('after', params.after);
      return await get(`/${collection}?${query.toString()}`);
    },
    async session(id) { return await get<SessionDetail>(`/sessions/${encodeURIComponent(id)}`); },
    async sessionMemory(id) { return await get<SessionMemory>(`/sessions/${encodeURIComponent(id)}/memory`); },
    async memoryItems(sessionId, limit) {
      const page = await get<{ items: MemoryItem[] }>(`/memory-items?limit=${String(limit)}&order=desc&sessionId=${encodeURIComponent(sessionId)}`);
      return page?.items ?? null;
    },
    async stream(lastEventId, signal, onFrame) {
      const extra: Record<string, string> = { Accept: 'text/event-stream' };
      if (lastEventId > 0) extra['Last-Event-ID'] = String(lastEventId);
      const response = await fetcher(`${base}/api/v1/stream`, { headers: headers(extra), cache: 'no-store', signal });
      if (response.status === 401) throw new Unauthorized();
      if (!response.ok || !response.body) throw new Error(`stream failed: ${String(response.status)}`);
      await pump(response.body, onFrame);
    },
  };
}

async function pump(body: ReadableStream<Uint8Array>, onFrame: (event: ApiEvent | 'heartbeat') => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
      if (frame.comment) onFrame('heartbeat');
      else onFrame(JSON.parse(frame.data) as ApiEvent);
    }
  }
}
