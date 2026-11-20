import type { DerivedFrom, SourceRef } from '@pi-console/contract';
import type { AnswerModel, RequestModel, RequestsState } from '../projections/requests.ts';

export type Origin = RequestModel['origin'];

/** Common to every observation: its order key (occurredAt, file offset, event id), time and transcript entry. */
interface Observed { key: string; at: string; entryId: string | null }

/** A raw prompt. Its source-stated origin is not kept: raw origin is derived from session facts only (fail closed). */
export interface PromptObservation extends Observed {
  kind: 'prompt'; requestId: string; text: string; withheld: boolean; ref: SourceRef | null; derivedFrom: DerivedFrom;
}
export interface AnswerObservation extends Observed { kind: 'answer'; answerId: string; text: string; withheld: boolean }
export interface AbortObservation extends Observed { kind: 'abort' }
export interface ResetObservation extends Observed { kind: 'reset'; resetId: string }
export interface EndObservation extends Observed { kind: 'end' }

/** Raw, unpaired facts of one session, as the session JSONL adapter reports them. */
export type Observation = PromptObservation | AnswerObservation | AbortObservation | ResetObservation | EndObservation;

/** What the console knows about a session's lineage; origin rules depend on it. */
export interface SessionFacts {
  /** A subagent (child) session: its prompts are written by the parent agent. */
  child: boolean;
  parentSessionId: string | null;
  /** The source established the parent link, so `parentSessionId: null` means the session has no parent. */
  parentSessionKnown: boolean;
}

export interface SessionRecord {
  facts: SessionFacts;
  /** Sorted by `key`, so the derivation is independent of arrival order. */
  observations: Observation[];
  /** Requests stated explicitly (not raw) for this session. */
  explicitIds: string[];
  /** Ids this session contributed to `requests` at its last derivation, so stale ones can be removed. */
  requestIds: string[];
}

/** The pass-through projection's bookkeeping fields; derived requests never use them. */
export const passThroughFields = (): Pick<RequestModel, 'stamps' | 'interruptedResetId'> =>
  ({ stamps: Object.create(null) as Record<string, string>, interruptedResetId: null });

export interface ExplicitAnswer extends AnswerModel { key: string; withheld: boolean }

/**
 * Request facts stated by a source (an extension, later the intent-memory store) rather than derived from raw
 * transcript entries. They override the derivation for the same request id, or for a raw prompt with the same entry.
 */
export interface ExplicitFacts {
  request: RequestModel | null;
  /** Order key of the statement behind `request`: a later statement wins, whatever the arrival order. */
  requestKey: string | null;
  /** The transcript entry of the stated request: a raw prompt for the same entry is this request. */
  entryId: string | null;
  answers: ExplicitAnswer[];
  interruption: { resetId: string | null; key: string } | null;
}

export interface DerivationState extends RequestsState {
  sessions: Record<string, SessionRecord>;
  explicit: Record<string, ExplicitFacts>;
}
