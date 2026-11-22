import { decode, type EventEnvelope, type EventLog, type SkipReason } from '@pi-console/contract';
import { MemoryProjectionStore, type AnyProjection, type DirtyReporter, type ProjectionRuntime, type ProjectionStore, type ProjectionWrite } from './projection.ts';

interface Slot {
  projection: AnyProjection; state: unknown; position: number; runtime?: ProjectionRuntime;
  dirty: Map<string, Set<string>>; dirtyRows: number; resetRows: boolean; report: DirtyReporter;
}

/** Small enough that one flush (JSON + one SQLite transaction) stays a short slice of the event loop. */
const flushEvents = 500;
const flushRows = 500;
const flushIntervalMs = 250;

export interface SkippedEvents { position: number; counts: Record<SkipReason, number> }

export type AppliedListener = (event: EventEnvelope) => void;

const skippedName = '$skipped';
const noSkips = (): SkippedEvents => ({ position: 0, counts: { 'unknown-type': 0, 'unknown-version': 0, 'invalid-payload': 0 } });

/**
 * Folds the event log into every registered projection, in sequence order, both when catching up and live, so a
 * replay from empty and an incremental run produce identical state. Events the catalogue cannot decode are skipped
 * and counted, never fatal. Snapshots are saved per projection with the position they include.
 */
export class Projector {
  readonly #log: EventLog;
  readonly #store: ProjectionStore;
  readonly #slots: Slot[];
  readonly #listeners = new Set<AppliedListener>();
  #skipped: SkippedEvents;
  #position: number;
  #unsubscribe: (() => void) | undefined;
  #unsaved = 0;
  #flushTimer: ReturnType<typeof setInterval> | undefined;

  constructor(log: EventLog, projections: readonly AnyProjection[], store: ProjectionStore = new MemoryProjectionStore(), runtimes: Readonly<Record<string, ProjectionRuntime>> = {}) {
    this.#log = log;
    this.#store = store;
    this.#slots = projections.map(projection => restore(store, projection, runtimes[projection.name]));
    const skipped = store.load(skippedName);
    this.#skipped = (skipped?.state as SkippedEvents | undefined) ?? noSkips();
    this.#position = Math.min(this.#skipped.position, ...this.#slots.map(slot => slot.position));
  }

  /** Sequence number every projection has reached. */
  get position(): number {
    return this.#position;
  }

  get skipped(): SkippedEvents {
    return structuredClone(this.#skipped);
  }

  /** Current state of one projection. Callers must treat it as read-only. */
  state(name: string): unknown {
    const slot = this.#slots.find(candidate => candidate.projection.name === name);
    if (!slot) throw new Error(`Unknown projection ${name}`);
    return slot.state;
  }

  /** An optional read source supplied by the projection's lifecycle collaborator. */
  querySource(name: string): unknown {
    return this.#slots.find(slot => slot.projection.name === name)?.runtime?.querySource;
  }

  /** Applies every stored event the projections have not seen yet, then saves snapshots. */
  async catchUp(): Promise<number> {
    let applied = 0;
    for await (const event of this.#log.readFrom(this.#position)) {
      this.#apply(event);
      this.#flushIfFull();
      applied++;
    }
    this.flush();
    return applied;
  }

  /** Catches up, then follows the log live. */
  async start(): Promise<void> {
    await this.catchUp();
    this.#unsubscribe = this.#log.subscribe(this.#position, event => { this.#applyLive(event); });
    this.#flushTimer = setInterval(() => { this.flush(); }, flushIntervalMs);
    this.#flushTimer.unref();
  }

  stop(): void {
    clearInterval(this.#flushTimer);
    this.#flushTimer = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.flush();
  }

  /** Called after each live event is folded into every projection. */
  onApplied(listener: AppliedListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Atomically saves dirty rows (or custom projection snapshots) with every replay position. */
  flush(): void {
    if (this.#unsaved === 0) return;
    const records = this.#slots.map(slot => writeFor(slot, this.#store.saveChanges !== undefined));
    records.push({ name: skippedName, version: 1, position: this.#skipped.position, state: this.#skipped });
    if (this.#store.saveChanges) this.#store.saveChanges(records);
    else this.#store.save(records);
    for (const slot of this.#slots) {
      slot.runtime?.afterCommit(slot.dirty);
      slot.dirty.clear();
      slot.dirtyRows = 0;
      slot.resetRows = false;
    }
    this.#unsaved = 0;
  }

  #flushIfFull(): void {
    if (this.#unsaved >= flushEvents || this.#slots.some(slot => slot.dirtyRows >= flushRows)) this.flush();
  }

  #applyLive(event: EventEnvelope): void {
    if (event.seq <= this.#position) return;
    this.#apply(event);
    this.#flushIfFull();
    for (const listener of this.#listeners) listener(event);
  }

  #apply(stored: EventEnvelope): void {
    const decoded = decode(stored);
    if (decoded.kind === 'skipped') this.#countSkip(stored.seq, decoded.reason);
    for (const slot of this.#slots) {
      if (slot.position >= stored.seq) continue;
      if (decoded.kind === 'ok') {
        slot.runtime?.beforeApply(decoded.event);
        slot.state = slot.projection.apply(slot.state, decoded.event, slot.report);
      }
      slot.position = stored.seq;
    }
    this.#skipped.position = Math.max(this.#skipped.position, stored.seq);
    this.#position = stored.seq;
    this.#unsaved++;
  }

  #countSkip(seq: number, reason: SkipReason): void {
    if (seq > this.#skipped.position) this.#skipped.counts[reason]++;
  }
}

/** Loads a snapshot, or starts from empty when there is none or its version is stale. */
function restore(store: ProjectionStore, projection: AnyProjection, runtime?: ProjectionRuntime): Slot {
  const record = runtime ? runtime.restore(projection) : store.load(projection.name);
  const current = record?.version === projection.version;
  const slot: Slot = {
    projection, runtime, state: current ? record.state : projection.initial(), position: current ? record.position : 0,
    dirty: new Map(), dirtyRows: 0, resetRows: !current,
    report(collection, id) {
      let ids = slot.dirty.get(collection);
      if (!ids) { ids = new Set(); slot.dirty.set(collection, ids); }
      if (!ids.has(id)) { ids.add(id); slot.dirtyRows++; }
    },
  };
  runtime?.bind(slot.state, current);
  return slot;
}

function writeFor(slot: Slot, rowStore: boolean): ProjectionWrite {
  const { projection, state, position } = slot;
  const record = { name: projection.name, version: projection.version, position, state };
  if (!rowStore || !projection.collections) return record;
  const collections = state as Record<string, Record<string, unknown>>;
  const rows = projection.collections.flatMap(collection => {
    const items = collections[collection];
    // A rebuild replaces old rows and includes any nonempty initial state. Subsequent flushes visit dirty ids only.
    const ids = slot.resetRows ? Object.keys(items) : [...slot.dirty.get(collection) ?? []];
    return ids.map(id => ({ collection, id, ...(Object.hasOwn(items, id) ? { value: items[id] } : {}) }));
  });
  return { ...record, state: Object.fromEntries(projection.collections.map(collection => [collection, {}])), rows, resetRows: slot.resetRows };
}
