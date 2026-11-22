import type { Session } from '@pi-console/contract';
import type { ReviewScheduler } from './memory-review-controller.ts';

type SessionId = Session['id'];

interface SessionRefresh {
  watchers: number;
  dirty: boolean;
  inFlight: boolean;
  timer?: unknown;
  forced: (() => void)[];
}
const scheduler: ReviewScheduler = {
  set: (callback, delay) => setTimeout(callback, delay),
  clear: timer => { clearTimeout(timer as ReturnType<typeof setTimeout>); },
};

/** Visibility-gated invalidation with one canonical read per session and a trailing, never dropped, wave. */
export class MemoryRefreshController {
  readonly #reload: (id: SessionId) => Promise<void>;
  readonly #readiness: (id: SessionId) => Promise<void>;
  readonly #timers: ReviewScheduler;
  readonly #sessions = new Map<string, SessionRefresh>();
  #disposed = false;

  constructor(reload: (id: SessionId) => Promise<void>, readiness: (id: SessionId) => Promise<void>, timers: ReviewScheduler = scheduler) {
    this.#reload = reload; this.#readiness = readiness; this.#timers = timers;
  }

  #session(id: SessionId): SessionRefresh {
    let state = this.#sessions.get(id);
    if (!state) { state = { watchers: 0, dirty: false, inFlight: false, forced: [] }; this.#sessions.set(id, state); }
    return state;
  }

  watch(id: SessionId): () => void {
    if (this.#disposed) return () => undefined;
    const state = this.#session(id);
    state.watchers++;
    if (state.watchers === 1) { state.dirty = true; void this.#run(id, state); }
    let closed = false;
    return () => {
      if (closed) return;
      closed = true;
      if (--state.watchers === 0) { state.dirty = false; this.#cancel(state); }
    };
  }

  invalidate(id: SessionId): void {
    const state = this.#sessions.get(id);
    if (this.#disposed || !state?.watchers) return;
    state.dirty = true;
    this.#schedule(id, state);
  }

  invalidateVisible(): void {
    for (const id of this.#sessions.keys()) this.invalidate(id);
  }

  /** Explicit receipt completion is canonical-only, works hidden, and waits for a fresh read after any in-flight one. */
  refresh(id: SessionId): Promise<void> {
    if (this.#disposed) return Promise.resolve();
    const state = this.#session(id);
    const task = new Promise<void>(resolve => { state.forced.push(resolve); });
    this.#cancel(state);
    void this.#run(id, state);
    return task;
  }

  #cancel(state: SessionRefresh): void {
    if (state.timer !== undefined) this.#timers.clear(state.timer);
    state.timer = undefined;
  }

  #schedule(id: SessionId, state: SessionRefresh): void {
    if (state.inFlight || state.timer !== undefined) return;
    state.timer = this.#timers.set(() => { state.timer = undefined; void this.#run(id, state); }, 350);
  }

  async #run(id: SessionId, state: SessionRefresh): Promise<void> {
    if (this.#disposed || state.inFlight) return;
    this.#cancel(state);
    const ready = state.dirty && state.watchers > 0;
    const forced = state.forced.splice(0);
    state.dirty = false;
    state.inFlight = true;
    try {
      await this.#reload(id);
      if (ready && this.#active()) await this.#readiness(id);
    } catch { /* Keep canonical data; a later invalidation or reopen retries. */ }
    finally {
      state.inFlight = false;
      for (const resolve of forced) resolve();
      if (this.#active()) this.#continue(id, state);
    }
  }

  /** Resample disposal after asynchronous work; it can change while a read is pending. */
  #active(): boolean { return !this.#disposed; }

  #continue(id: SessionId, state: SessionRefresh): void {
    if (state.forced.length) void this.#run(id, state);
    else if (state.dirty && state.watchers) this.#schedule(id, state);
  }

  dispose(): void {
    this.#disposed = true;
    for (const state of this.#sessions.values()) {
      this.#cancel(state);
      state.dirty = false;
      for (const resolve of state.forced.splice(0)) resolve();
    }
  }
}
