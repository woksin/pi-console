import type { EventEnvelope, Job, Message, Question, Request, Reset, Session } from '@pi-console/contract';
import { ConsoleQueries, deltaFor, type AttentionItem, type Delta, type ReadModels, type RequestFilter } from '@pi-console/core';

/** Queries memoised for one flush: read models do not change while a batch of deltas is being computed. */
class BatchQueries extends ConsoleQueries {
  readonly #cache = new Map<string, unknown>();

  #memo<T>(key: string, compute: () => T): T {
    if (!this.#cache.has(key)) this.#cache.set(key, compute());
    return this.#cache.get(key) as T;
  }

  override needsYou(): AttentionItem[] { return this.#memo('needsYou', () => super.needsYou()); }
  override sessions(): Session[] { return this.#memo('sessions', () => super.sessions()); }
  override requests(filter: RequestFilter = 'all'): Request[] { return this.#memo(`requests:${filter}`, () => super.requests(filter)); }
  override questions(): Question[] { return this.#memo('questions', () => super.questions()); }
  override messages(): Message[] { return this.#memo('messages', () => super.messages()); }
  override jobs(): Job[] { return this.#memo('jobs', () => super.jobs()); }
  override resets(): Reset[] { return this.#memo('resets', () => super.resets()); }
}

const keyOf = (delta: Delta): string => `${delta.type}:${String((delta.payload as { id?: unknown }).id)}`;

/** Only the derived fields: ordinary session changes already have a catalogue route. */
function derivedSessions(queries: ConsoleQueries): Map<string, string> {
  const attention = new Map<string, AttentionItem[]>();
  for (const item of queries.needsYou()) {
    if (item.sessionId === null) continue;
    const items = attention.get(item.sessionId) ?? [];
    items.push(item);
    attention.set(item.sessionId, items);
  }
  return new Map(queries.sessions().map(session => [session.id, JSON.stringify([session.status, attention.get(session.id) ?? []])]));
}

interface DerivedState {
  sessions: Map<string, string>;
  requests: Map<string, string>;
}

/** Detached fingerprints preserve the last visible state even when projection rows are mutated in place. */
function derivedState(queries: ConsoleQueries): DerivedState {
  return {
    sessions: derivedSessions(queries),
    requests: new Map(queries.requests().map(request => [request.id, JSON.stringify(request)])),
  };
}

/** Flushes may take at most this share of the event loop: after a flush of d ms the next waits (1 / share - 1) × d. */
const maxDutyShare = 0.2;
/** Longest a pending delta waits behind an expensive flush. */
const maxFlushDelayMs = 2_000;

export interface DeltaBatcherOptions {
  /** Monotonic milliseconds; injectable for specs. */
  clock?: () => number;
  /** Skip unused queries only after the owner has made omitted deltas non-replayable. */
  discard?: () => boolean;
}

/**
 * Turns applied log events into SSE deltas. Events applied in the same tick are coalesced: each touched entity is
 * published once, as its state after the whole batch, in the order it was first touched.
 *
 * Every flush rebuilds whole-state queries, so during a backfill flushes are paced to a duty cycle: after an expensive
 * flush, the next one waits proportionally and events keep coalescing meanwhile. Deltas are the same final states,
 * only later; after a cheap flush (the live case) the wait is a few milliseconds at most.
 */
export class DeltaBatcher {
  readonly #models: () => ReadModels;
  readonly #publish: (delta: Delta) => void;
  readonly #now: () => Date;
  readonly #clock: () => number;
  readonly #discard: (() => boolean) | undefined;
  #pending: EventEnvelope[] = [];
  /** Derived entity state as the observing clients last saw it; `undefined` after unobserved batches until `rebase`. */
  #derived: DerivedState | undefined;
  #nextFlushAt = 0;
  #timer: NodeJS.Timeout | undefined;

  constructor(models: () => ReadModels, publish: (delta: Delta) => void, now: () => Date = () => new Date(), options: DeltaBatcherOptions = {}) {
    this.#models = models;
    this.#publish = publish;
    this.#now = now;
    this.#clock = options.clock ?? (() => performance.now());
    this.#discard = options.discard;
    this.#derived = derivedState(new BatchQueries(models, now));
  }

  get pending(): number {
    return this.#pending.length;
  }

  /**
   * Call when a client takes a snapshot: after unobserved batches the snapshot, not the last published delta, is what
   * clients have seen, so later batches compare derived state against it.
   */
  rebase(): void {
    this.#derived ??= derivedState(new BatchQueries(this.#models, this.#now));
  }

  add(event: EventEnvelope): void {
    if (this.#pending.length === 0) this.#schedule();
    this.#pending.push(event);
  }

  flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    const events = this.#pending;
    if (events.length === 0) return;
    this.#pending = [];
    const started = this.#clock();
    if (this.#discard?.()) this.#derived = undefined;
    else this.#flushEvents(events);
    const ended = this.#clock();
    this.#nextFlushAt = ended + Math.min(maxFlushDelayMs, (ended - started) * (1 / maxDutyShare - 1));
  }

  #schedule(): void {
    const wait = this.#nextFlushAt - this.#clock();
    if (wait <= 0) setImmediate(() => { this.flush(); });
    else this.#timer = setTimeout(() => { this.flush(); }, wait);
  }

  #flushEvents(events: readonly EventEnvelope[]): void {
    const queries = new BatchQueries(this.#models, this.#now);
    const deltas = new Map<string, Delta>();
    const seen = new Set<string>();
    for (const event of events) {
      const delta = deltaFor(queries, event, seen);
      if (delta && !deltas.has(keyOf(delta))) deltas.set(keyOf(delta), delta);
    }
    this.#addDerivedEntities(queries, deltas);
    for (const delta of deltas.values()) this.#publish(delta);
  }

  #addDerivedEntities(queries: ConsoleQueries, deltas: Map<string, Delta>): void {
    const derived = derivedState(queries);
    const before = this.#derived ?? derived;
    this.#addDerivedRequests(queries, before, derived, deltas);
    for (const session of queries.sessions()) {
      if (before.sessions.get(session.id) === derived.sessions.get(session.id)) continue;
      const delta = { type: 'session.updated', payload: session };
      deltas.set(keyOf(delta), delta);
    }
    this.#derived = derived;
  }

  #addDerivedRequests(queries: ConsoleQueries, before: DerivedState, derived: DerivedState, deltas: Map<string, Delta>): void {
    for (const request of queries.requests()) {
      if (before.requests.get(request.id) === derived.requests.get(request.id)) continue;
      // Catalogue routes already cover explicitly linked events; do not duplicate their request entities.
      if (deltas.has(`request.observed:${request.id}`) || deltas.has(`request.interrupted:${request.id}`)) continue;
      const delta = { type: request.status === 'interrupted' ? 'request.interrupted' : 'request.observed', payload: request };
      deltas.set(keyOf(delta), delta);
    }
  }
}
