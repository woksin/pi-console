import type { EventEnvelope } from '@pi-console/contract';

/**
 * A read model built by folding the event log. `apply` must be pure: no clock, no IO, no randomness, no dependence on
 * anything but `state` and `event`. It may mutate and return `state` (the projector owns it exclusively), and the state
 * must be plain JSON so it can be snapshotted and compared byte for byte. Bump `version` to force a rebuild.
 */
export interface Projection<State = unknown> {
  readonly name: string;
  readonly version: number;
  initial(): State;
  /** Dictionary collections persisted as independent rows; omitted for snapshot-only custom projections. */
  readonly collections?: readonly string[];
  apply(state: State, event: EventEnvelope, dirty?: DirtyReporter): State;
}

/** Erases the state type so differently-typed projections can live in one list. */
export type AnyProjection = Projection;

export interface ProjectionRecord {
  name: string;
  version: number;
  /** Sequence number of the last event folded into `state`. */
  position: number;
  state: unknown;
}

export type DirtyReporter = (collection: string, id: string) => void;

export interface ProjectionRow {
  collection: string;
  id: string;
  /** Absent for a tombstone. */
  value?: unknown;
}

export interface ProjectionWrite extends ProjectionRecord {
  rows?: readonly ProjectionRow[];
  resetRows?: boolean;
}

/** Where projection snapshots live between restarts. */
export interface ProjectionStore {
  load(name: string): ProjectionRecord | undefined;
  save(records: readonly ProjectionRecord[]): void;
  /** Optional row-aware persistence. Snapshot-only stores remain supported. */
  saveChanges?(records: readonly ProjectionWrite[]): void;
}

/** Store that forgets on restart; for specs and replay comparisons. */
export class MemoryProjectionStore implements ProjectionStore {
  readonly #records = new Map<string, string>();

  load(name: string): ProjectionRecord | undefined {
    const text = this.#records.get(name);
    return text === undefined ? undefined : JSON.parse(text) as ProjectionRecord;
  }

  save(records: readonly ProjectionRecord[]): void {
    for (const record of records) this.#records.set(record.name, JSON.stringify(record));
  }
}
