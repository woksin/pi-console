import type { EventEnvelope } from '@pi-console/contract';
import { deltaFor, IncrementalQueries, type Delta, type IncrementalChanges, type ProjectionChanges, type ReadModels } from '@pi-console/core';

export interface DeltaBatcherOptions {
  clock?: () => number;
  /** Drop an unobserved batch before reading models (e.g. a stream with no connected clients). */
  discard?: () => boolean;
}

/** Coalesces input events into final entity upserts and dirty-derived session invalidations. */
export class DeltaBatcher {
  readonly #models: () => ReadModels;
  readonly #publish: (delta: Delta) => void;
  readonly #now: () => Date;
  readonly #options: Required<DeltaBatcherOptions>;
  readonly #events = new Map<string, EventEnvelope>();
  readonly #changes = new Map<string, Map<string, Set<string>>>();
  #index: IncrementalQueries | undefined;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #immediate: ReturnType<typeof setImmediate> | undefined;
  #lastFlushed = -Infinity;
  #interval = 0;

  constructor(models: () => ReadModels, publish: (delta: Delta) => void, now: () => Date = () => new Date(), options: DeltaBatcherOptions = {}) {
    this.#models = models;
    this.#publish = publish;
    this.#now = now;
    this.#options = {
      clock: options.clock ?? (() => performance.now()),
      discard: options.discard ?? (() => false),
    };
    this.rebase();
  }

  /** A newly attached client saw current state; later derivations start from this baseline. */
  rebase(): void {
    this.#queries();
  }

  add(event: EventEnvelope, changes: ProjectionChanges): void {
    this.#events.set(eventKey(event), event);
    mergeChanges(this.#changes, changes);
    this.#schedule();
  }

  get pending(): number { return this.#events.size; }

  /** Flushes pending input now, including during shutdown. Never emits snapshots or duplicate whole entities. */
  flush(): void {
    if (this.#events.size === 0) return;
    if (this.#options.discard()) { this.#discard(); return; }
    this.#cancel();
    const started = this.#options.clock();
    const events = [...this.#events.values()];
    const queries = this.#queries();
    const resets = events.filter(event => event.type === 'ResetOccurred').map(event => (event.payload as { sessionId: string }).sessionId);
    const changed = queries.update(this.#changes, this.#now(), resets);
    this.#events.clear();
    this.#changes.clear();
    const deltas = this.#deltas(events, queries, changed);
    for (const delta of deltas.values()) this.#emit(delta, changed.memory);
    const duration = Math.max(0, this.#options.clock() - started);
    this.#interval = Math.min(2_000, duration * (1 / 0.2 - 1));
    this.#lastFlushed = this.#options.clock();
  }

  #queries(): IncrementalQueries {
    if (!this.#index) {
      this.#index = new IncrementalQueries(this.#models, this.#now());
    }
    return this.#index;
  }

  #deltas(events: EventEnvelope[], queries: IncrementalQueries, changed: IncrementalChanges): Map<string, Delta> {
    const deltas = new Map<string, Delta>();
    const seen = new Set<string>();
    for (const event of events) {
      const delta = deltaFor(queries, event, seen);
      if (delta) deltas.set(keyOf(delta), delta);
    }
    this.#requestDeltas(queries, changed.requests, deltas);
    this.#sessionDeltas(queries, changed, deltas);
    return deltas;
  }

  #requestDeltas(queries: IncrementalQueries, ids: Iterable<string>, deltas: Map<string, Delta>): void {
    for (const id of ids) {
      const request = queries.requestById(id);
      if (request) {
        const delta: Delta = { type: request.status === 'interrupted' ? 'request.interrupted' : 'request.observed', payload: request };
        deltas.set(keyOf(delta), delta);
      }
    }
  }

  #sessionDeltas(queries: IncrementalQueries, changed: IncrementalChanges, deltas: Map<string, Delta>): void {
    for (const id of new Set([...changed.sessions, ...changed.memory])) {
      const payload = queries.sessionById(id);
      if (payload) deltas.set(`session.updated:${id}`, { type: 'session.updated', payload });
    }
  }

  #discard(): void {
    this.#cancel();
    this.#events.clear();
    this.#changes.clear();
    this.#index = undefined;
  }

  #emit(delta: Delta, memory: ReadonlySet<string>): void {
    const session = delta.payload as { id: string };
    this.#publish(delta.type === 'session.updated' && memory.has(session.id)
      ? { ...delta, payload: { ...session, memoryChanged: true } } : delta);
  }

  #cancel(): void {
    clearImmediate(this.#immediate);
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#immediate = undefined;
  }

  #schedule(): void {
    if (this.#timer || this.#immediate) return;
    const wait = Math.max(0, this.#lastFlushed + this.#interval - this.#options.clock());
    if (wait === 0) this.#immediate = setImmediate(() => { this.flush(); });
    else this.#timer = setTimeout(() => { this.flush(); }, wait);
    this.#timer?.unref();
    this.#immediate?.unref();
  }
}

function mergeChanges(target: Map<string, Map<string, Set<string>>>, changes: ProjectionChanges): void {
  for (const [name, collections] of changes) {
    let merged = target.get(name);
    if (!merged) { merged = new Map(); target.set(name, merged); }
    mergeCollections(merged, collections);
  }
}

function mergeCollections(target: Map<string, Set<string>>, collections: ReadonlyMap<string, ReadonlySet<string>>): void {
  for (const [collection, ids] of collections) {
    let merged = target.get(collection);
    if (!merged) { merged = new Set(); target.set(collection, merged); }
    for (const id of ids) merged.add(id);
  }
}

function keyOf(delta: Delta): string { return `${delta.type}:${(delta.payload as { id: string }).id}`; }

function eventKey(event: EventEnvelope): string {
  const payload = event.payload as Record<string, unknown>;
  const fields = ['requestId', 'questionId', 'messageId', 'jobId', 'phaseId', 'resetId', 'sessionId', 'itemId'];
  const key = fields.find(field => typeof payload[field] === 'string');
  return `${event.type}:${key ? payload[key] as string : event.id}`;
}
