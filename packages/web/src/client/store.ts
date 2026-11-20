import type { Event as ApiEvent } from '@pi-console/contract';
import { applyEvent, mergeTranscript } from '../state/reduce.ts';
import { emptyState, type Connection, type ConsoleState } from '../state/state.ts';
import { Unauthorized, type Api } from './api.ts';

export interface Clock { now(): number; setTimeout(callback: () => void, ms: number): number; clearTimeout(id: number): void }

const realClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: id => { window.clearTimeout(id); },
};

export const reconnectDelays = [400, 800, 1600, 3200, 5000] as const;
export const staleAfterMs = 45_000;
const refreshDebounceMs = 350;
const historyPageSize = 1000;
/** Enough pages to reach the tail of any realistic session (the TUI pages the same way); only the newest entries are retained. */
const maxHistoryPages = 60;

type Listener = () => void;

/**
 * The client's single source of truth: server-sent state plus connection status. It owns the stream loop (resume by
 * Last-Event-ID, snapshot refetch on gap, backoff) and the derived-model refresh (`/needs-you`, `/health`).
 */
/** Paging stops at the end of history, or as soon as the entry being jumped to has been loaded. */
const isLastPage = (result: { hasMore: boolean; items: readonly { id: string }[] }, focus: string | null): boolean =>
  !result.hasMore || (focus !== null && result.items.some(item => item.id === focus));

export class ConsoleStore {
  #state: ConsoleState = emptyState();
  readonly #listeners = new Set<Listener>();
  readonly #api: Api;
  readonly #clock: Clock;
  #abort: AbortController | null = null;
  #refresh: number | null = null;
  /** A refresh requested while one is in flight is not dropped: it runs again once the current one lands (a trailing refresh, never overlapping, so an older answer cannot overwrite a newer one). */
  #refreshing = false;
  #refreshAgain = false;
  #watchTimer: number | null = null;
  #attempt = 0;
  #stopped = false;
  /** Read through methods: both flags change across awaits, which control-flow narrowing cannot see. */
  #isStopped(): boolean { return this.#stopped; }
  #takeRefreshAgain(): boolean { const again = this.#refreshAgain; this.#refreshAgain = false; return again; }
  readonly #loaded = new Map<string, Promise<void>>();

  constructor(api: Api, clock: Clock = realClock) {
    this.#api = api;
    this.#clock = clock;
  }

  readonly subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  };

  readonly getState = (): ConsoleState => this.#state;

  #set(next: ConsoleState): void {
    this.#state = next;
    for (const listener of this.#listeners) listener();
  }

  #connection(connection: Connection): void {
    if (this.#state.connection !== connection) this.#set({ ...this.#state, connection });
  }

  start(): void {
    this.#stopped = false;
    void this.#run();
  }

  stop(): void {
    this.#stopped = true;
    this.#abort?.abort();
    this.#unwatch();
    if (this.#refresh !== null) this.#clock.clearTimeout(this.#refresh);
  }

  async #run(): Promise<void> {
    while (!this.#stopped) {
      this.#abort = new AbortController();
      this.#connection(this.#state.seq > 0 ? 'reconnecting' : 'connecting');
      this.#watch(this.#abort);
      try {
        await this.#api.stream(this.#state.seq, this.#abort.signal, frame => { this.#frame(frame); });
      } catch (error) {
        if (error instanceof Unauthorized) { this.#connection('unauthorized'); return; }
      } finally { this.#unwatch(); }
      if (this.#isStopped()) return;
      this.#connection('offline');
      await this.#sleep(reconnectDelays[Math.min(this.#attempt++, reconnectDelays.length - 1)]);
    }
  }

  #watch(controller: AbortController): void {
    const check = (): void => {
      if (this.#state.lastFrameAt > 0 && this.#clock.now() - this.#state.lastFrameAt > staleAfterMs) controller.abort();
      else this.#watchTimer = this.#clock.setTimeout(check, staleAfterMs / 3);
    };
    this.#watchTimer = this.#clock.setTimeout(check, staleAfterMs / 3);
  }

  #unwatch(): void {
    if (this.#watchTimer !== null) this.#clock.clearTimeout(this.#watchTimer);
    this.#watchTimer = null;
  }

  #sleep(ms: number): Promise<void> {
    return new Promise(resolve => { this.#clock.setTimeout(resolve, ms); });
  }

  #frame(frame: ApiEvent | 'heartbeat'): void {
    this.#attempt = 0;
    const now = this.#clock.now();
    if (frame === 'heartbeat') { this.#set({ ...this.#state, lastFrameAt: now, connection: 'live', received: this.#state.received + 1 }); return; }
    this.#set({ ...applyEvent(this.#state, frame), lastFrameAt: now, connection: 'live', received: this.#state.received + 1 });
    this.#scheduleRefresh();
  }

  #scheduleRefresh(): void {
    if (this.#refresh !== null) return;
    this.#refresh = this.#clock.setTimeout(() => { this.#refresh = null; void this.refresh(); }, refreshDebounceMs);
  }

  /** Refetches the daemon-derived read models. Failures keep the last good copy (the stream banner reports connectivity). */
  async refresh(): Promise<void> {
    if (this.#refreshing) { this.#refreshAgain = true; return; }
    this.#refreshing = true;
    try {
      do { this.#refreshAgain = false; await this.#fetchDerived(); } while (this.#takeRefreshAgain());
    } finally { this.#refreshing = false; }
  }

  async #fetchDerived(): Promise<void> {
    const [needsYou, health] = await Promise.all([this.#api.needsYou().catch(() => null), this.#api.health().catch(() => null)]);
    this.#set({ ...this.#state, needsYou: needsYou ?? this.#state.needsYou, health: health ?? this.#state.health });
  }
  /** Loads a session's transcript history once per gap; the live tail arrives over the stream. History is paged to its end (only the newest entries are kept), or, with `focus`, until that entry is present. A failed load is forgotten so the next open retries it. */
  loadTranscript(sessionId: string, focus: string | null = null): Promise<void> {
    const key = `${sessionId}:${String(this.#state.gapCount)}:${focus ?? ''}`;
    const existing = this.#loaded.get(key);
    if (existing) return existing;
    const task = this.#fetchTranscript(sessionId, focus).then(complete => { if (!complete) this.#loaded.delete(key); });
    this.#loaded.set(key, task);
    return task;
  }

  /** Returns false when a page could not be fetched. */
  async #fetchTranscript(sessionId: string, focus: string | null): Promise<boolean> {
    let after = 0;
    for (let page = 0; page < maxHistoryPages; page++) {
      const result = await this.#api.transcript(sessionId, after, historyPageSize).catch(() => null);
      if (!result) return false;
      this.#set(mergeTranscript(this.#state, sessionId, result.items, focus !== null));
      if (isLastPage(result, focus)) return true;
      after = result.nextCursor;
    }
    return true;
  }
}
