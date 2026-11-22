import type { WindowedCollection } from '@pi-console/viewmodels';
import type { Graph, MemoryActionAvailability, MemoryActionReceipt, MemoryActionRequest, Event, MemoryItem, SessionDetail, SessionMemory, TranscriptEntry, Transcript, NeedsYou, AttentionItem } from '@pi-console/contract';
import { FrameParser } from './sse.ts';
import type { Credentials } from './token.ts';

export interface TranscriptTail { entries: TranscriptEntry[]; truncated: boolean; nextCursor?: number; hasMore?: boolean }
export interface TranscriptQuery { sessionId: string; after?: number; order?: 'asc' | 'desc'; around?: string; signal?: AbortSignal }

export interface StreamHandlers {
  onEvent: (event: Event) => void;
  onState: (state: { connected: boolean; error: string }) => void;
}

export interface StreamClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (timer: ReturnType<typeof setTimeout>) => void;
}
const realClock: StreamClock = { now: () => Date.now(), setTimeout: (callback, ms) => setTimeout(callback, ms), clearTimeout: timer => { clearTimeout(timer); } };
const staleAfterMs = 45_000;

/** The daemon API client: bearer token, loopback only, SSE with resume from the last seen sequence. */
export class DaemonClient {
  private readonly abort = new AbortController();
  private lastSeq: number | undefined;
  readonly credentials: Credentials;
  private readonly clock: StreamClock;

  constructor(credentials: Credentials, clock: StreamClock = realClock) {
    this.credentials = credentials;
    this.clock = clock;
  }

  private get(path: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Response> {
    return fetch(`${this.credentials.baseUrl}/api/v1${path}`, {
      headers: { Authorization: `Bearer ${this.credentials.token}`, ...extra }, signal: signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal,
    });
  }

  private async json<T>(path: string, signal?: AbortSignal): Promise<T> {
    const response = await this.get(path, {}, signal);
    if (!response.ok) throw new Error(`Daemon answered HTTP ${String(response.status)} for ${path}`);
    return await response.json() as T;
  }

  async needsYou(): Promise<AttentionItem[]> {
    return (await this.json<NeedsYou>('/needs-you')).items;
  }

  async graph(): Promise<Graph> { return await this.json<Graph>('/graph'); }

  /** One page of a list endpoint, newest first when `order` is `desc`. */
  async page(collection: WindowedCollection, after: string | null, limit = 500): Promise<{ items: { id: string }[]; nextCursor: string | null; hasMore: boolean; total: number }> {
    return await this.json(`/${collection}?limit=${String(limit)}&order=desc${after ? `&after=${encodeURIComponent(after)}` : ''}`);
  }

  async session(sessionId: string, signal?: AbortSignal): Promise<SessionDetail> {
    return await this.json<SessionDetail>(`/sessions/${encodeURIComponent(sessionId)}`, signal);
  }

  async sessionMemory(sessionId: string): Promise<SessionMemory> {
    return await this.json<SessionMemory>(`/sessions/${encodeURIComponent(sessionId)}/memory`);
  }

  private async reviewJson<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`${this.credentials.baseUrl}/api/v1${path}`, {
      ...init, headers: { Authorization: `Bearer ${this.credentials.token}`, 'Content-Type': 'application/json' },
      signal: signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error ?? `HTTP ${String(response.status)}`);
    }
    return await response.json() as T;
  }

  memoryActionAvailability(id: string, signal?: AbortSignal): Promise<MemoryActionAvailability | null> {
    return this.reviewJson<MemoryActionAvailability>(`/sessions/${encodeURIComponent(id)}/memory-actions`, {}, signal).catch(() => null);
  }
  requestMemoryAction(id: string, request: MemoryActionRequest, signal?: AbortSignal): Promise<MemoryActionReceipt> {
    return this.reviewJson(`/sessions/${encodeURIComponent(id)}/memory-actions`, { method: 'POST', body: JSON.stringify(request) }, signal);
  }
  memoryActionReceipt(id: string, signal?: AbortSignal): Promise<MemoryActionReceipt> {
    return this.reviewJson(`/memory-actions/${encodeURIComponent(id)}`, {}, signal);
  }

  /** The newest memory items of one session. */
  async memoryItems(sessionId: string, limit = 100): Promise<MemoryItem[]> {
    return (await this.json<{ items: MemoryItem[] }>(`/memory-items?limit=${String(limit)}&order=desc&sessionId=${encodeURIComponent(sessionId)}`)).items;
  }

  async transcript(sessionId: string, signal?: AbortSignal): Promise<TranscriptEntry[]> {
    return (await this.transcriptTail({ sessionId, signal })).entries;
  }

  /** One newest-first request; retained entries are normalized oldest-first for rendering. */
  async transcriptTail({ sessionId, signal }: TranscriptQuery): Promise<TranscriptTail> {
    const body = await this.transcriptPage({ sessionId, order: 'desc', signal });
    return { entries: [...body.items].reverse(), truncated: false, nextCursor: body.nextCursor, hasMore: body.hasMore };
  }

  async transcriptPage({ sessionId, signal, after, order = 'asc', around }: TranscriptQuery): Promise<Transcript> {
    const active = signal ? AbortSignal.any([signal, this.abort.signal]) : this.abort.signal;
    active.throwIfAborted();
    const query = new URLSearchParams({ limit: '1000', order });
    if (after !== undefined) query.set('after', String(after));
    if (around !== undefined) query.set('around', around);
    const page = await this.json<Transcript>(`/sessions/${encodeURIComponent(sessionId)}/transcript?${query.toString()}`, active);
    active.throwIfAborted();
    return page;
  }

  /** Runs until `stop()`. Reconnects with capped backoff and resumes through `Last-Event-ID`. */
  async stream(handlers: StreamHandlers): Promise<void> {
    let delay = 500;
    while (!this.abort.signal.aborted) {
      try {
        await this.attempt(handlers, () => { delay = 500; });
        handlers.onState({ connected: false, error: 'Stream closed by the daemon' });
      } catch (error) {
        if (this.abort.signal.aborted) return;
        handlers.onState({ connected: false, error: (error as Error).message });
      }
      await this.sleep(delay);
      delay = Math.min(delay * 2, 8000);
    }
  }

  private async attempt(handlers: StreamHandlers, connected: () => void): Promise<void> {
    const controller = new AbortController();
    const signal = AbortSignal.any([this.abort.signal, controller.signal]);
    let lastFrameAt = this.clock.now();
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (this.clock.now() - lastFrameAt > staleAfterMs) controller.abort(new Error('Stream freshness deadline exceeded'));
      else timer = this.clock.setTimeout(check, staleAfterMs / 3);
    };
    timer = this.clock.setTimeout(check, staleAfterMs / 3);
    try {
      const response = await fetch(`${this.credentials.baseUrl}/api/v1/stream`, {
        headers: { Authorization: `Bearer ${this.credentials.token}`, ...(this.lastSeq === undefined ? {} : { 'Last-Event-ID': String(this.lastSeq) }) }, signal,
      });
      if (!response.ok || !response.body) throw new Error(`Daemon answered HTTP ${String(response.status)}`);
      handlers.onState({ connected: true, error: '' });
      connected();
      await this.read(response.body, handlers, () => { lastFrameAt = this.clock.now(); });
    } finally { this.clock.clearTimeout(timer); }
  }

  private sleep(ms: number): Promise<void> {
    if (this.abort.signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      const done = () => { this.clock.clearTimeout(timer); this.abort.signal.removeEventListener('abort', done); resolve(); };
      const timer = this.clock.setTimeout(done, ms);
      this.abort.signal.addEventListener('abort', done, { once: true });
    });
  }

  private async read(body: ReadableStream<Uint8Array>, handlers: StreamHandlers, alive: () => void): Promise<void> {
    const parser = new FrameParser(alive);
    const decoder = new TextDecoder();
    for await (const chunk of body) {
      for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
        alive();
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
