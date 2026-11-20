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

/**
 * Turns applied log events into SSE deltas. Events applied in the same tick are coalesced: each touched entity is
 * published once, as its state after the whole batch, in the order it was first touched.
 */
export class DeltaBatcher {
  readonly #models: () => ReadModels;
  readonly #publish: (delta: Delta) => void;
  readonly #now: () => Date;
  #pending: EventEnvelope[] = [];
  #derived: Map<string, string>;

  constructor(models: () => ReadModels, publish: (delta: Delta) => void, now: () => Date = () => new Date()) {
    this.#models = models;
    this.#publish = publish;
    this.#now = now;
    this.#derived = derivedSessions(new BatchQueries(models, now));
  }

  get pending(): number {
    return this.#pending.length;
  }

  add(event: EventEnvelope): void {
    if (this.#pending.length === 0) setImmediate(() => { this.flush(); });
    this.#pending.push(event);
  }

  flush(): void {
    const events = this.#pending;
    if (events.length === 0) return;
    this.#pending = [];
    const queries = new BatchQueries(this.#models, this.#now);
    const deltas = new Map<string, Delta>();
    for (const event of events) {
      const delta = deltaFor(queries, event);
      if (delta && !deltas.has(keyOf(delta))) deltas.set(keyOf(delta), delta);
    }
    this.#addDerivedSessions(queries, deltas);
    for (const delta of deltas.values()) this.#publish(delta);
  }

  #addDerivedSessions(queries: ConsoleQueries, deltas: Map<string, Delta>): void {
    const derived = derivedSessions(queries);
    for (const session of queries.sessions()) {
      if (this.#derived.get(session.id) === derived.get(session.id)) continue;
      const delta = { type: 'session.updated', payload: session };
      deltas.set(keyOf(delta), delta);
    }
    this.#derived = derived;
  }
}
