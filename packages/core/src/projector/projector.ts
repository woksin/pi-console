import { decode, type EventEnvelope, type EventLog, type SkipReason } from '@pi-console/contract';
import { MemoryProjectionStore, type AnyProjection, type ProjectionRecord, type ProjectionStore } from './projection.ts';

interface Slot { projection: AnyProjection; state: unknown; position: number }

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

  constructor(log: EventLog, projections: readonly AnyProjection[], store: ProjectionStore = new MemoryProjectionStore()) {
    this.#log = log;
    this.#store = store;
    this.#slots = projections.map(projection => restore(store, projection));
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

  /** Applies every stored event the projections have not seen yet, then saves snapshots. */
  async catchUp(): Promise<number> {
    let applied = 0;
    for await (const event of this.#log.readFrom(this.#position)) {
      this.#apply(event);
      applied++;
    }
    this.flush();
    return applied;
  }

  /** Catches up, then follows the log live. */
  async start(): Promise<void> {
    await this.catchUp();
    this.#unsubscribe = this.#log.subscribe(this.#position, event => { this.#applyLive(event); });
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.flush();
  }

  /** Called after each live event is folded into every projection. */
  onApplied(listener: AppliedListener): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  /** Saves every projection snapshot with its position. */
  flush(): void {
    if (this.#unsaved === 0) return;
    const records: ProjectionRecord[] = this.#slots.map(({ projection, state, position }) => ({
      name: projection.name, version: projection.version, position, state,
    }));
    records.push({ name: skippedName, version: 1, position: this.#skipped.position, state: this.#skipped });
    this.#store.save(records);
    this.#unsaved = 0;
  }

  #applyLive(event: EventEnvelope): void {
    if (event.seq <= this.#position) return;
    this.#apply(event);
    if (this.#unsaved >= 1000) this.flush();
    for (const listener of this.#listeners) listener(event);
  }

  #apply(stored: EventEnvelope): void {
    const decoded = decode(stored);
    if (decoded.kind === 'skipped') this.#countSkip(stored.seq, decoded.reason);
    for (const slot of this.#slots) {
      if (slot.position >= stored.seq) continue;
      if (decoded.kind === 'ok') slot.state = slot.projection.apply(slot.state, decoded.event);
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
function restore(store: ProjectionStore, projection: AnyProjection): Slot {
  const record = store.load(projection.name);
  if (record?.version !== projection.version) return { projection, state: projection.initial(), position: 0 };
  return { projection, state: record.state, position: record.position };
}
