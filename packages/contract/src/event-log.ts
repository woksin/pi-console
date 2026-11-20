import type { EventEnvelope, NewEvent } from './envelope.ts';

/**
 * Shared seam between ingestion (adapters) and the daemon core (ADR-0001, ADR-0004).
 * Types only. `packages/core` implements it on node:sqlite; a Chronicle adapter may follow.
 */

/** Read position of one source file, stored atomically with the events it produced. */
export interface SourceCheckpoint {
  /** Source id, for example `session-jsonl` or `context-budget`. */
  source: string;
  /** Stable file identity: device + inode + birth time (see docs/spikes/ingestion.md). */
  identity: string;
  /** Bumped on size drop (truncation) so idempotency keys stay unique per epoch. */
  generation: number;
  /** Byte offset just after the last complete line that was appended. */
  offset: number;
  path: string;
  size: number;
  mtimeMs: number;
  /** Optional hash of the first bytes, to detect some truncate-and-regrow cases. */
  headHash?: string;
}

export interface AppendResult {
  /** Events newly stored. */
  appended: number;
  /** Events skipped because their idempotency key already exists. */
  duplicates: number;
  /** Highest sequence number in the log after the append (0 when empty). */
  lastSeq: number;
}

export interface EventLog {
  /**
   * Append events and, optionally, checkpoints in ONE transaction: either all
   * new events and the checkpoints are stored, or nothing is. Duplicate
   * idempotency keys are skipped, not errors.
   */
  append(events: readonly NewEvent[], checkpoints?: readonly SourceCheckpoint[]): Promise<AppendResult>;
  /** Events with `seq > afterSeq`, in sequence order. */
  readFrom(afterSeq: number, limit?: number): AsyncIterable<EventEnvelope>;
  /** Live events with `seq > afterSeq`; returns an unsubscribe function. */
  subscribe(afterSeq: number, onEvent: (event: EventEnvelope) => void): () => void;
  /** Stored checkpoints for a source (all identities). */
  checkpoints(source: string): Promise<SourceCheckpoint[]>;
}
