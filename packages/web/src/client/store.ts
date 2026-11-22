import type { Event as ApiEvent } from '@pi-console/contract';
import { MemoryRefreshController, MemoryReviewController, type WindowedCollection } from '@pi-console/viewmodels';
import { applyEvent, mergePage, mergeSessionDetail, mergeTranscript } from '../state/reduce.ts';
import { emptyState, type Connection, type ConsoleState, type MemoryReadStatus } from '../state/state.ts';
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
const memoryItemLimit = 100;
const memoryReadError = (error: unknown): string => error instanceof Error ? error.message : 'Memory read failed.';
const historyPageSize = 1000;
/** Rows per history page: newest first, so the first page mostly repeats the snapshot window and later pages go back in time. */
const listPageSize = 500;
const windowedNames: readonly WindowedCollection[] = ['sessions', 'requests', 'questions', 'messages', 'jobs', 'resets'];
/** Enough pages to reach the tail of any realistic session (the TUI pages the same way); only the newest entries are retained. */
const maxHistoryPages = 60;

type Listener = () => void;
export type SessionDetailStatus = 'loading' | 'loaded' | 'failed' | 'not-found';
interface SessionDetailLoad {
  sessionId: string;
  requests: RequestGeneration;
  status: SessionDetailStatus;
  task: Promise<void>;
}

/** Pending reads and their cleanup belong to the current snapshot, even across resumable connections. */
class RequestGeneration {
  readonly loaded = new Map<string, Promise<void>>();
  readonly details = new Map<string, SessionDetailLoad>();
  readonly paging = new Map<WindowedCollection, Promise<void>>();
  /** Bounded collections that gained an id the client had not seen: their snapshot total may have moved, so it is refetched. */
  readonly staleTotals = new Set<WindowedCollection>();
  /** A refresh requested while one is in flight runs again after it lands, never overlapping. */
  refreshing = false;
  refreshAgain = false;
}

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
  #reviews: MemoryReviewController;
  #memoryRefresh: MemoryRefreshController;
  readonly #clock: Clock;
  #abort: AbortController | null = null;
  #refresh: number | null = null;
  #requests = new RequestGeneration();
  #watchTimer: number | null = null;
  #lastActivityAt = 0;
  #attempt = 0;
  #stopped = false;
  #generation = 0;
  /** Read through methods: these flags change across awaits, which control-flow narrowing cannot see. */
  #active(generation: number): boolean { return !this.#stopped && this.#generation === generation; }
  #requestActive(requests: RequestGeneration): boolean { return !this.#stopped && this.#requests === requests; }
  #takeRefreshAgain(requests: RequestGeneration): boolean { const again = requests.refreshAgain; requests.refreshAgain = false; return again; }

  #resetRequests(): void {
    this.#requests = new RequestGeneration();
    if (this.#refresh !== null) this.#clock.clearTimeout(this.#refresh);
    this.#refresh = null;
  }

  constructor(api: Api, clock: Clock = realClock) {
    this.#api = api;
    this.#clock = clock;
    this.#reviews = this.#createReviews();
    this.#memoryRefresh = this.#createMemoryRefresh();
  }

  #createMemoryRefresh(): MemoryRefreshController {
    return new MemoryRefreshController(id => this.#fetchMemory(id), id => this.#reviews.load(id, { fresh: true }), {
      set: (callback, ms = 350) => this.#clock.setTimeout(callback, ms),
      clear: timer => { this.#clock.clearTimeout(timer as number); },
    });
  }

  #createReviews(): MemoryReviewController {
    return new MemoryReviewController(this.#api, (id, review) => {
      this.#set({ ...this.#state, memoryReviews: new Map(this.#state.memoryReviews).set(id, review) });
    }, id => this.#memoryRefresh.refresh(id));
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
    if (this.#stopped) {
      this.#resetRequests();
      this.#reviews = this.#createReviews();
      this.#memoryRefresh = this.#createMemoryRefresh();
      this.#set({ ...this.#state, memoryReviews: new Map() });
    }
    this.#stopped = false;
    void this.#run(++this.#generation);
  }

  stop(): void {
    this.#stopped = true;
    this.#generation++;
    this.#reviews.dispose();
    this.#memoryRefresh.dispose();
    this.#abort?.abort();
    this.#unwatch();
    if (this.#refresh !== null) this.#clock.clearTimeout(this.#refresh);
  }

  async #run(generation: number): Promise<void> {
    while (this.#active(generation)) {
      const controller = new AbortController();
      this.#abort = controller;
      this.#lastActivityAt = this.#clock.now();
      this.#connection(this.#state.seq > 0 ? 'reconnecting' : 'connecting');
      this.#watch(controller);
      try {
        await this.#api.stream(this.#state.seq, controller.signal, frame => { this.#frameWhenActive(generation, controller.signal, frame); });
      } catch (error) {
        if (!this.#active(generation)) return;
        if (error instanceof Unauthorized) { this.#connection('unauthorized'); return; }
      } finally {
        controller.abort();
        if (this.#active(generation)) this.#unwatch();
      }
      if (!this.#active(generation)) return;
      this.#connection('offline');
      await this.#sleep(reconnectDelays[Math.min(this.#attempt++, reconnectDelays.length - 1)]);
    }
  }

  #watch(controller: AbortController): void {
    const check = (): void => {
      if (this.#clock.now() - this.#lastActivityAt > staleAfterMs) controller.abort();
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

  #frameWhenActive(generation: number, signal: AbortSignal, frame: ApiEvent | 'heartbeat'): void {
    if (signal.aborted) return;
    if (this.#active(generation)) this.#frame(frame);
  }

  #frame(frame: ApiEvent | 'heartbeat'): void {
    this.#attempt = 0;
    const now = this.#clock.now();
    this.#lastActivityAt = now;
    if (frame === 'heartbeat') { this.#set({ ...this.#state, lastFrameAt: now, connection: 'live', received: this.#state.received + 1 }); return; }
    if (frame.type === 'snapshot') this.#resetRequests();
    const next = applyEvent(this.#state, frame);
    if (frame.type === 'session.updated') this.#invalidateSessionDetail(frame.payload);
    if (frame.type !== 'snapshot') for (const name of next.bounded) if (next[name].length > this.#state[name].length) this.#requests.staleTotals.add(name);
    this.#set({ ...next, lastFrameAt: now, connection: 'live', received: this.#state.received + 1 });
    if (frame.type === 'snapshot') this.#memoryRefresh.invalidateVisible();
    if (frame.type === 'session.updated' && frame.payload.memoryChanged) this.#memoryRefresh.invalidate(frame.payload.id);
    this.#scheduleRefresh();
  }

  #scheduleRefresh(): void {
    if (this.#refresh !== null) return;
    this.#refresh = this.#clock.setTimeout(() => { this.#refresh = null; void this.refresh(); }, refreshDebounceMs);
  }

  /** Refetches the daemon-derived read models. Failures keep the last good copy (the stream banner reports connectivity). */
  async refresh(): Promise<void> {
    const requests = this.#requests;
    if (requests.refreshing) { requests.refreshAgain = true; return; }
    requests.refreshing = true;
    try {
      do { requests.refreshAgain = false; await this.#fetchDerived(requests); } while (this.#requestActive(requests) && this.#takeRefreshAgain(requests));
    } finally { requests.refreshing = false; }
  }

  async #fetchDerived(requests: RequestGeneration): Promise<void> {
    this.#set({ ...this.#state, needsYouError: false });
    const [needsYou, health] = await Promise.all([this.#api.needsYou().catch(() => null), this.#api.health().catch(() => null)]);
    if (!this.#requestActive(requests)) return;
    this.#set({ ...this.#state, needsYou: needsYou ?? this.#state.needsYou, needsYouLoaded: needsYou !== null, needsYouError: needsYou === null, health: health ?? this.#state.health });
    await this.#refreshTotals(requests);
  }

  /** A `limit=1` page carries the collection's current total; no separate endpoint, no client-side guessing. */
  async #refreshTotals(requests: RequestGeneration): Promise<void> {
    const names = windowedNames.filter(name => requests.staleTotals.delete(name));
    await Promise.all(names.map(async name => {
      const page = await this.#api.page(name, { limit: 1 }).catch(() => null);
      if (!this.#requestActive(requests)) return;
      const totals = this.#state.totals;
      if (!page || !totals) { requests.staleTotals.add(name); return; }
      this.#set({ ...this.#state, totals: { ...totals, [name]: page.total } });
    }));
  }

  /** Loads the next page of a windowed collection's history (the first call starts from the newest); a no-op once it is complete or when the snapshot was not windowed. Concurrent calls share one request; a failed page is simply retried on the next call. */
  loadMore(collection: WindowedCollection): Promise<void> {
    const state = this.#state;
    const progress = state.history[collection];
    if (!state.bounded.includes(collection)) return Promise.resolve();
    if (progress && !progress.more) return Promise.resolve();
    const requests = this.#requests;
    const existing = requests.paging.get(collection);
    if (existing) return existing;
    const task = this.#fetchPage(requests, collection, progress?.cursor ?? null).finally(() => { requests.paging.delete(collection); });
    requests.paging.set(collection, task);
    return task;
  }

  async #fetchPage(requests: RequestGeneration, collection: WindowedCollection, after: string | null): Promise<void> {
    const page = await this.#api.page(collection, { limit: listPageSize, order: 'desc', after }).catch(() => null);
    if (!this.#requestActive(requests)) return;
    if (page) this.#set(mergePage(this.#state, collection, page));
  }

  /** Detail requests have their own status: an absent snapshot row is not evidence of a 404. */
  getSessionDetailStatus(sessionId: string): SessionDetailStatus | undefined {
    return this.#requests.details.get(sessionId)?.status;
  }

  #invalidateSessionDetail(session: { id: string }): void {
    const details = this.#requests.details;
    const load = details.get(session.id);
    if (load?.status === 'not-found' || load?.status === 'failed') details.delete(session.id);
  }

  #clearSessionDetailStatus(load: SessionDetailLoad | undefined): void {
    if (!load) return;
    load.requests.details.delete(load.sessionId);
    this.#set({ ...this.#state });
  }

  #publishSessionDetail(load: SessionDetailLoad, state = this.#state): void {
    if (!this.#requestActive(load.requests)) return;
    if (load.requests.details.get(load.sessionId) !== load) return;
    this.#set({ ...state });
  }

  /** Loads a session's complete jobs, requests, questions and subagents once per gap; missing sessions are checked even with an unbounded snapshot. Failed requests can be retried immediately. */
  loadSessionDetail(sessionId: string): Promise<void> {
    const requests = this.#requests;
    const existing = requests.details.get(sessionId);
    if (this.#state.bounded.length === 0 && this.#state.sessions.some(session => session.id === sessionId)) {
      this.#clearSessionDetailStatus(existing);
      return Promise.resolve();
    }
    if (existing?.status === 'loading' || existing?.status === 'loaded') return existing.task;
    const load: SessionDetailLoad = { sessionId, requests, status: 'loading', task: Promise.resolve() };
    requests.details.set(sessionId, load);
    load.task = this.#fetchSessionDetail(load);
    this.#publishSessionDetail(load);
    return load.task;
  }

  async #fetchSessionDetail(load: SessionDetailLoad): Promise<void> {
    try {
      const detail = await this.#api.session(load.sessionId);
      if (!this.#requestActive(load.requests)) return;
      load.status = detail ? 'loaded' : 'not-found';
      this.#publishSessionDetail(load, detail ? mergeSessionDetail(this.#state, detail) : this.#state);
    } catch {
      // Even a synchronous transport throw settles after the loading state has been registered.
      await Promise.resolve();
      load.status = 'failed';
      this.#publishSessionDetail(load);
    }
  }

  requestMemoryAction(sessionId: string, itemId: string, action: 'confirm' | 'reject'): Promise<void> {
    return this.#reviews.request(sessionId, itemId, action);
  }

  /** Registers a visible panel; reopening always reads canonical data and readiness. */
  watchSessionMemory(sessionId: string): () => void { return this.#memoryRefresh.watch(sessionId); }

  /** Explicit canonical read, serialized with background invalidations and receipt completion. */
  loadSessionMemory(sessionId: string): Promise<void> { return this.#memoryRefresh.refresh(sessionId); }

  #setMemoryStatus(sessionId: string, status: MemoryReadStatus): void {
    this.#set({ ...this.#state, memoryStatus: { ...this.#state.memoryStatus, [sessionId]: status } });
  }

  async #fetchMemory(sessionId: string): Promise<void> {
    const requests = this.#requests;
    this.#setMemoryStatus(sessionId, { status: 'loading' });
    try {
      const [memory, items] = await Promise.all([this.#api.sessionMemory(sessionId), this.#api.memoryItems(sessionId, memoryItemLimit)]);
      if (!this.#requestActive(requests)) return;
      if (!memory || !items) throw new Error('Memory endpoints unavailable.');
      this.#set({
        ...this.#state, memory: { ...this.#state.memory, [sessionId]: memory }, memoryItems: { ...this.#state.memoryItems, [sessionId]: items },
        memoryStatus: { ...this.#state.memoryStatus, [sessionId]: { status: memory.storeDetected ? 'loaded' : 'absent' } },
      });
    } catch (error) {
      if (!this.#requestActive(requests)) return;
      this.#setMemoryStatus(sessionId, { status: 'error', message: memoryReadError(error) });
    }
  }

  /** Loads a session's transcript history once per gap; the live tail arrives over the stream. History is paged to its end (only the newest entries are kept), or, with `focus`, until that entry is present. A failed load is forgotten so the next open retries it. */
  loadTranscript(sessionId: string, focus: string | null = null): Promise<void> {
    const requests = this.#requests;
    const key = `${sessionId}:${String(this.#state.gapCount)}:${focus ?? ''}`;
    const existing = requests.loaded.get(key);
    if (existing) return existing;
    const task = this.#fetchTranscript(requests, sessionId, focus).then(complete => { if (!complete) requests.loaded.delete(key); });
    requests.loaded.set(key, task);
    return task;
  }

  /** Returns false when a page could not be fetched. */
  async #fetchTranscript(requests: RequestGeneration, sessionId: string, focus: string | null): Promise<boolean> {
    let after = 0;
    for (let page = 0; page < maxHistoryPages; page++) {
      const result = await this.#api.transcript(sessionId, after, historyPageSize).catch(() => null);
      if (!this.#requestActive(requests)) return false;
      if (!result) return false;
      this.#set(mergeTranscript(this.#state, sessionId, result.items, focus !== null));
      if (isLastPage(result, focus)) return true;
      after = result.nextCursor;
    }
    return true;
  }
}
