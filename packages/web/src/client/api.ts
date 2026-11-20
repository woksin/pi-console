import type { Event as ApiEvent, AttentionItem, Job, Message, NeedsYou, Question, Request, Session, SessionDetail, Transcript, TranscriptEntry } from '@pi-console/contract';
import type { WindowedCollection } from '@pi-console/viewmodels';
import type { HealthRecord } from '../state/state.ts';
import { SseParser } from './sse.ts';

export class Unauthorized extends Error {}

export interface ListItems { sessions: Session; requests: Request; questions: Question; messages: Message; jobs: Job }
/** One keyset page of a list endpoint (`limit` sent); `nextCursor` is opaque. */
export interface ListPage<C extends WindowedCollection = WindowedCollection> { items: ListItems[C][]; nextCursor: string | null; hasMore: boolean; total: number }
export interface PageParams { limit: number; after?: string | null; order?: 'asc' | 'desc' }

export interface Api {
  needsYou(): Promise<AttentionItem[]>;
  health(): Promise<HealthRecord | null>;
  transcript(sessionId: string, after: number, limit: number): Promise<Transcript>;
  /** A page of one list, in order; `null` when the daemon does not know the route. */
  page<C extends WindowedCollection>(collection: C, params: PageParams): Promise<ListPage<C> | null>;
  /** Complete per-session detail (its jobs, requests, questions, resets, subagents). */
  session(id: string): Promise<SessionDetail | null>;
  /** Opens the event stream; resolves when the stream ends or throws on failure. */
  stream(lastEventId: number, signal: AbortSignal, onFrame: (event: ApiEvent | 'heartbeat') => void): Promise<void>;
}

export function createApi(token: string, base = '', fetcher: typeof fetch = (...args) => fetch(...args)): Api {
  const headers = (extra: Record<string, string> = {}): Record<string, string> => ({ Authorization: `Bearer ${token}`, Accept: 'application/json', ...extra });

  async function get<T>(path: string): Promise<T | null> {
    const response = await fetcher(`${base}/api/v1${path}`, { headers: headers(), cache: 'no-store' });
    if (response.status === 401) throw new Unauthorized();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GET ${path} failed: ${String(response.status)}`);
    return await response.json() as T;
  }

  return {
    async needsYou() { return (await get<NeedsYou>('/needs-you'))?.items ?? []; },
    async health() { return await get<HealthRecord>('/health'); },
    async transcript(sessionId, after, limit) {
      const page = await get<Transcript>(`/sessions/${encodeURIComponent(sessionId)}/transcript?after=${String(after)}&limit=${String(limit)}`);
      return page ?? { items: [] as TranscriptEntry[], nextCursor: after, hasMore: false };
    },
    async page(collection, params) {
      const query = new URLSearchParams({ limit: String(params.limit), order: params.order ?? 'asc' });
      if (params.after) query.set('after', params.after);
      return await get(`/${collection}?${query.toString()}`);
    },
    async session(id) { return await get<SessionDetail>(`/sessions/${encodeURIComponent(id)}`); },
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
