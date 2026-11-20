import type { Event as ApiEvent, AttentionItem, NeedsYou, Transcript, TranscriptEntry } from '@pi-console/contract';
import type { HealthRecord } from '@pi-console/viewmodels';
import { SseParser } from './sse.ts';

export class Unauthorized extends Error {}

export interface Api {
  needsYou(): Promise<AttentionItem[]>;
  health(): Promise<HealthRecord | null>;
  transcript(sessionId: string, after: number, limit: number): Promise<Transcript>;
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
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const parser = new SseParser();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    for (const frame of parser.push(value)) {
      if (frame.comment) onFrame('heartbeat');
      else onFrame(JSON.parse(frame.data) as ApiEvent);
    }
  }
}
