/**
 * Record shapes of the intent-memory store, contract v1.2 section 10 (requests, answers, boundaries), as the console
 * reads them in Phase B (ADR-0008). Types only: the console is a reader and never writes these records. Field
 * meanings are defined by the contract; docs/requests.md lists the Phase B reader specs.
 */

/** Where request facts came from: Phase A derivation from session JSONL, or the store (Phase B). */
export type DerivedFrom = 'session-jsonl' | 'intent-memory';

/** At most 32 ids are listed inline. */
export interface InlineIdSet { count: number; ids: string[] }
/** Larger sets live in `blobs/<sha256>.txt` (sorted ids, one per line); `sha256` is of that text. */
export interface BlobIdSet { count: number; sha256: string; blob: string }
export type IdSet = InlineIdSet | BlobIdSet;

/** A set whose blob is missing or fails its hash check: the reader shows the count only and never guesses members. */
export interface UnresolvedIdSet { unresolved: true; count: number }
export type ResolvedIdSet = InlineIdSet | UnresolvedIdSet;

export interface MemorySessionRef { id: string; file?: string; entryId?: string; role: 'main' | 'subagent' }

export type JournalOrigin = 'human' | 'unattended' | 'launch' | 'injected';
export type InjectedKind = 'lane_message' | 'brief' | 'notice' | 'reminder' | 'relaunch' | 'unknown';

/** A journal entry (`journal/<sessionId>.jsonl`). A request is one with `origin=human`, or `launch` that is not a relaunch. */
export interface JournalEntry {
  schema: 'memory.journal/2';
  id: string;
  at: string;
  session: MemorySessionRef;
  cwd: string;
  origin: JournalOrigin;
  originEvidence: string[];
  injectedKind?: InjectedKind;
  /** Redacted verbatim text; `null` when withheld (the UI shows the gap, never an empty string). */
  text: string | null;
  withheld: 'redactor_failed' | 'too_large' | null;
  textBytes: number;
  sha256: string;
}

/** An answer record (`answers/<sessionId>.jsonl`): immutable, never back-references a boundary. */
export interface AnswerRecord {
  schema: 'memory.answer/2';
  id: string;
  at: string;
  session: MemorySessionRef;
  runId: string;
  /** Requests open when the message started. */
  requests: IdSet;
  kind: 'final' | 'interim';
  stopReason: string;
  text: string | null;
  withheld: 'redactor_failed' | 'too_large' | 'write_failed' | null;
  textBytes: number;
  sha256: string;
}

export type BoundaryKind = 'handoff' | 'emergency' | 'hard' | 'idle' | 'overflow_native' | 'overflow_package' | 'manual' | 'abort';

/** One boundary event per compaction (`events.jsonl`), deduplicated by `compactionEntryId`. */
export interface BoundaryEvent {
  type: 'boundary';
  id: string;
  at: string;
  session: string;
  runId: string;
  kind: BoundaryKind;
  compactionEntryId?: string;
  openRequests: IdSet;
  lastAnswerId?: string;
  /** No human input between `lastAnswerId` and this boundary: that answer is possibly unseen. */
  sameRunAsAnswer: boolean;
}

/** Closes one request; `answered` applies only when `answerId` names an existing answer. */
export interface RequestClose {
  type: 'request_close';
  requestId: string;
  status: 'answered' | 'abandoned';
  answerId?: string;
  reason?: string;
  source?: string;
}
