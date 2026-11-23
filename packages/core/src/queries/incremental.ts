import type { Reset } from '@pi-console/contract';
import { questionItem, requestItem } from '../attention/needs-you.ts';
import { compareText } from '../projector/canonical.ts';
import type { ProjectionChanges } from '../projector/projector.ts';
import type { ReadModels } from '../projections/index.ts';
import type { ResetModel } from '../projections/sessions.ts';
import { ConsoleQueries } from './console-queries.ts';
import { toSession } from './entities.ts';
import { IncrementalAttention } from './incremental-attention.ts';
import { IncrementalMemory } from './incremental-memory.ts';
import { Owners, rowOf } from './keyed-queue.ts';

export interface IncrementalChanges { sessions: Set<string>; requests: Set<string>; memory: Set<string> }
function bootstrapChanges(models: ReadModels): ProjectionChanges {
  const changes = new Map<string, Map<string, Set<string>>>();
  for (const name of ['sessions', 'requests', 'questions', 'memory'] as const) {
    const collections = new Map<string, Set<string>>();
    const rows = models[name] as unknown as Record<string, Record<string, unknown>>;
    const names = name === 'memory' ? ['items', 'messages'] : [name];
    for (const collection of names) collections.set(collection, new Set(Object.keys(rows[collection])));
    changes.set(name, collections);
  }
  return changes;
}

/** Integer property keys precede other session keys in canonical Object.values order. */
function sessionOrder(id: string, insertion: number): number {
  const index = Number(id) >>> 0;
  return String(index) === id && index < 0xffff_ffff ? index : 0x1_0000_0000 + insertion;
}

export const changedIds = (changes: ProjectionChanges, projection: string, collection: string): ReadonlySet<string> => changes.get(projection)?.get(collection) ?? new Set();

/** Bootstrap once, then update only dirty rows and their reverse dependencies. Full REST queries remain canonical. */
export class IncrementalQueries extends ConsoleQueries {
  readonly #models: () => ReadModels;
  readonly #attention = new IncrementalAttention();
  readonly #memory = new IncrementalMemory();
  readonly #questions = new Owners();
  readonly #children = new Owners();
  readonly #requests = new Map<string, string>();
  readonly #sessions = new Map<string, string>();
  readonly #resets = new Map<string, string>();
  readonly #resetWinners = new Map<string, Reset>();
  readonly #sessionOrder = new Map<string, number>();

  constructor(models: () => ReadModels, now: Date) {
    super(models, () => now);
    this.#models = models;
    const changes = bootstrapChanges(models());
    this.update(changes, now, changedIds(changes, 'sessions', 'sessions'));
  }

  override sessionById(id: string) {
    const models = this.#models();
    const row = rowOf(models.sessions.sessions, id);
    return row ? toSession(models, row, this.#attention.sessions) : undefined;
  }

  override resetById(id: string) {
    const reset = this.#resetWinners.get(id);
    return reset ? { ...reset } : undefined;
  }

  override sessionMemory(id: string) { return rowOf(this.#models().sessions.sessions, id) ? this.#memory.summary(id) : undefined; }

  update(changes: ProjectionChanges, now: Date, resetSessions: Iterable<string> = []): IncrementalChanges {
    const models = this.#models();
    const sessions = new Set<string>(changedIds(changes, 'sessions', 'sessions'));
    const attention = new Set<string>();
    const requests = this.#updateRequests(models, changes, attention);
    this.#updateQuestions(models, changes, sessions, attention);
    const memory = this.#updateMemory(models, changes, attention);
    for (const id of sessions) this.#newSessionMemory(models, id, memory);
    this.#resetMemory(models, resetSessions, memory);
    this.#lineage(models, sessions);
    for (const id of changedIds(changes, 'burn', 'sessions')) sessions.add(id);
    for (const id of sessions) this.#attention.session(models, id, now, attention);
    this.#attention.advance(models, now, attention);
    for (const id of attention) sessions.add(id);
    return { sessions: this.#changedSessions(sessions, attention), requests, memory };
  }

  #newSessionMemory(models: ReadModels, id: string, changed: Set<string>): void {
    if (this.#sessions.has(id) || !rowOf(models.sessions.sessions, id)) return;
    changed.add(id);
    this.#sessionOrder.set(id, sessionOrder(id, this.#sessionOrder.size));
  }

  #changedSessions(sessions: Iterable<string>, attention: Set<string>): Set<string> {
    const updated = new Set<string>(attention);
    for (const id of sessions) {
      if (this.#trackSession(id)) updated.add(id);
    }
    return updated;
  }

  #trackSession(id: string): boolean {
    const session = this.sessionById(id);
    const token = JSON.stringify(session);
    const changed = this.#sessions.get(id) !== token;
    if (session) this.#sessions.set(id, token);
    else this.#sessions.delete(id);
    return changed;
  }

  #resetMemory(models: ReadModels, ids: Iterable<string>, changed: Set<string>): void {
    for (const id of ids) {
      const resets = rowOf(models.sessions.sessions, id)?.resets ?? [];
      const token = JSON.stringify(resets);
      if (this.#resets.get(id) !== token) changed.add(id);
      this.#resets.set(id, token);
      this.#indexResets(id, resets);
    }
  }

  #indexResets(owner: string, resets: ResetModel[]): void {
    for (const reset of resets) {
      const next = { ...reset, sessionId: owner };
      const current = this.#resetWinners.get(reset.id);
      // Session reducers only retain earlier sightings; exact ties keep canonical session order.
      if (!current || this.#compareResets(next, current) < 0) this.#resetWinners.set(reset.id, next);
    }
  }

  #compareResets(next: Reset, current: Reset): number {
    const nextOwner = this.#sessionOrder.get(next.sessionId) ?? 0;
    const currentOwner = this.#sessionOrder.get(current.sessionId) ?? 0;
    return compareText(next.at, current.at) || nextOwner - currentOwner;
  }

  #updateRequests(models: ReadModels, changes: ProjectionChanges, attention: Set<string>): Set<string> {
    const changed = new Set<string>();
    for (const id of changedIds(changes, 'requests', 'requests')) this.#updateRequest(models, id, attention, changed);
    return changed;
  }

  #updateRequest(models: ReadModels, id: string, attention: Set<string>, changed: Set<string>): void {
    const row = rowOf(models.requests.requests, id);
    const token = JSON.stringify(this.requestById(id));
    if (this.#requests.get(id) !== token && row) changed.add(id);
    if (row) this.#requests.set(id, token);
    else this.#requests.delete(id);
    this.#attention.set(`request:${id}`, row ? requestItem(row) : null, attention);
  }

  #updateQuestions(models: ReadModels, changes: ProjectionChanges, sessions: ReadonlySet<string>, attention: Set<string>): void {
    const ids = new Set(changedIds(changes, 'questions', 'questions'));
    for (const id of sessions) this.#newSessionQuestions(id, ids);
    for (const id of ids) {
      const row = rowOf(models.questions.questions, id);
      this.#questions.set(id, row?.asker);
      this.#attention.set(`question:${id}`, row ? questionItem(models, row) : null, attention);
    }
  }

  #newSessionQuestions(id: string, questions: Set<string>): void {
    if (this.#sessions.has(id)) return;
    for (const question of this.#questions.members(id)) questions.add(question);
  }

  #updateMemory(models: ReadModels, changes: ProjectionChanges, attention: Set<string>): Set<string> {
    const changed = new Set<string>();
    const groups = new Set<string>();
    const items = new Set(changedIds(changes, 'memory', 'items'));
    const detected = this.#memory.detected;
    const wider = this.#memory.wider;
    for (const id of changedIds(changes, 'memory', 'messages')) {
      for (const item of this.#memory.sources.members(id)) items.add(item);
      this.#memory.message(models, id, changed);
    }
    for (const id of items) this.#memory.item(models, id, changed, groups);
    for (const owner of groups) this.#attention.set(`memory:${owner}`, this.#memory.attention(owner), attention);
    // These are genuinely global summary fields; their transitions affect every known session.
    if (detected !== this.#memory.detected || wider !== this.#memory.wider) this.#allSessions(models, changed);
    return changed;
  }

  #allSessions(models: ReadModels, changed: Set<string>): void {
    for (const id of Object.keys(models.sessions.sessions)) changed.add(id);
  }

  #lineage(models: ReadModels, sessions: Set<string>): void {
    const roots: string[] = [];
    for (const id of sessions) {
      const parent = rowOf(models.sessions.sessions, id)?.parentSessionId;
      if (!this.#sessions.has(id) || this.#children.get(id) !== (parent ?? undefined)) roots.push(id);
      this.#children.set(id, parent);
    }
    for (const id of this.#children.descendants(roots)) sessions.add(id);
  }
}
