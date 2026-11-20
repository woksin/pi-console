import type { Event, TranscriptEntry, Transcript, NeedsYou, AttentionItem } from '@pi-console/contract';
import { FrameParser } from './sse.ts';
import type { Credentials } from './token.ts';

export interface StreamHandlers {
  onEvent: (event: Event) => void;
  onState: (state: { connected: boolean; error: string }) => void;
}

/** The daemon API client: bearer token, loopback only, SSE with resume from the last seen sequence. */
export class DaemonClient {
  private readonly abort = new AbortController();
  private lastSeq: number | undefined;
  readonly credentials: Credentials;

  constructor(credentials: Credentials) {
    this.credentials = credentials;
  }

  private get(path: string, extra: Record<string, string> = {}): Promise<Response> {
    return fetch(`${this.credentials.baseUrl}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${this.credentials.token}`, ...extra }, signal: this.abort.signal,
    });
  }

  private async json<T>(path: string): Promise<T> {
    const response = await this.get(path);
    if (!response.ok) throw new Error(`Daemon answered HTTP ${String(response.status)} for ${path}`);
    return await response.json() as T;
  }

  async needsYou(): Promise<AttentionItem[]> {
    return (await this.json<NeedsYou>('/needs-you')).items;
  }

  /** Backfills a transcript, bounded to `pages` pages so a busy session cannot stall the UI. */
  async transcript(sessionId: string, pages = 5): Promise<TranscriptEntry[]> {
    const entries: TranscriptEntry[] = [];
    let cursor = 0;
    for (let page = 0; page < pages; page++) {
      const body = await this.json<Transcript>(`/sessions/${encodeURIComponent(sessionId)}/transcript?after=${String(cursor)}&limit=1000`);
      entries.push(...body.items);
      cursor = body.nextCursor;
      if (!body.hasMore) break;
    }
    return entries;
  }

  /** Runs until `stop()`. Reconnects with capped backoff and resumes through `Last-Event-ID`. */
  async stream(handlers: StreamHandlers): Promise<void> {
    let delay = 500;
    while (!this.abort.signal.aborted) {
      try {
        const response = await this.get('/stream', this.lastSeq === undefined ? {} : { 'Last-Event-ID': String(this.lastSeq) });
        if (!response.ok || !response.body) throw new Error(`Daemon answered HTTP ${String(response.status)}`);
        handlers.onState({ connected: true, error: '' });
        delay = 500;
        await this.read(response.body, handlers);
        handlers.onState({ connected: false, error: 'Stream closed by the daemon' });
      } catch (error) {
        if (this.abort.signal.aborted) return;
        handlers.onState({ connected: false, error: (error as Error).message });
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * 2, 8000);
    }
  }

  private async read(body: ReadableStream<Uint8Array>, handlers: StreamHandlers): Promise<void> {
    const parser = new FrameParser();
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
        const event = JSON.parse(frame.data) as Event;
        this.lastSeq = event.seq;
        handlers.onEvent(event);
      }
    }
  }

  stop(): void {
    this.abort.abort();
  }
}
