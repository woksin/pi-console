import { array, bool, excerpt, id, int, nullable, num, oneOf, open, percent, str, time, type Schema } from './schema-dsl.ts';
import { validate } from './validate.ts';

export type EventGroup = 'sessions' | 'requests' | 'questions' | 'messages-lanes' | 'work' | 'memory' | 'system';

export interface EventDefinition {
  type: string;
  /** Current schema version of this event type. */
  version: number;
  group: EventGroup;
  /** Sources that may emit it (event-model section 2). */
  sources: readonly string[];
  payload: Schema;
}

const sessionId = { sessionId: id };
const stringList = array(str);
const defs = (group: EventGroup, sources: readonly string[], entries: Record<string, Schema>): EventDefinition[] =>
  Object.entries(entries).map(([type, payload]) => ({ type, version: 1, group, sources, payload }));

const sessions = defs('sessions', ['session-jsonl', 'context-budget', 'lane-heartbeats', 'extension'], {
  SessionStarted: open(
    { ...sessionId, cwd: str, model: nullable(str), role: oneOf('orchestrator', 'main', 'subagent'), parentSessionId: nullable(id), parentSessionKnown: bool },
    ['sessionId', 'cwd', 'model', 'role', 'parentSessionId'],
  ),
  SessionEnded: open({ ...sessionId, reason: str }),
  ModelChanged: open({ ...sessionId, model: id, previousModel: nullable(str) }),
  ThinkingLevelChanged: open({ ...sessionId, level: id }),
  TurnStarted: open({ ...sessionId, turnId: id }),
  TurnEnded: open({ ...sessionId, turnId: id, stopReason: nullable(str), usage: nullable(open({ inputTokens: int, outputTokens: int })) }, ['sessionId', 'turnId']),
  ContextPressureSampled: open({ ...sessionId, percent, tokens: nullable(int) }, ['sessionId', 'percent']),
  ResetOccurred: open({ ...sessionId, resetId: id, kind: oneOf('handoff', 'compaction', 'relaunch'), carriedRequestIds: array(id), interruptedRequestIds: array(id) }, ['sessionId', 'resetId', 'kind']),
  SessionHeartbeat: open({ ...sessionId, status: str }, ['sessionId']),
});

/** Provenance of request facts (ADR-0008): Phase A derivation from session JSONL, or the intent-memory store (Phase B). */
const derivedFrom = { derivedFrom: oneOf('session-jsonl', 'intent-memory') };
const requests = defs('requests', ['session-jsonl', 'derivation'], {
  RequestObserved: open({ requestId: id, ...sessionId, entryId: id, raw: bool, origin: oneOf('human', 'launch', 'unproven'), originEvidence: str, excerpt, withheld: bool, ...derivedFrom }, ['requestId', 'sessionId', 'origin', 'originEvidence']),
  AnswerObserved: { anyOf: [
    open({ requestId: id, answerId: id, interim: bool, excerpt, withheld: bool, ...derivedFrom }, ['requestId', 'answerId', 'interim']),
    open({ raw: { const: true }, ...sessionId, entryId: id, answerId: id, interim: { const: false }, excerpt, withheld: bool, ...derivedFrom }, ['raw', 'sessionId', 'entryId', 'answerId', 'interim', 'excerpt', 'withheld']),
  ] },
  RequestInterrupted: { anyOf: [
    open({ requestId: id, ...sessionId, resetId: nullable(id), ...derivedFrom }, ['requestId', 'sessionId']),
    open({ raw: { const: true }, ...sessionId, entryId: id, reason: { const: 'aborted' }, ...derivedFrom }, ['raw', 'sessionId', 'entryId', 'reason']),
  ] },
});

const questionId = { questionId: id };
const questions = defs('questions', ['question-store'], {
  QuestionAsked: open({ ...questionId, asker: nullable(str), kind: oneOf('question', 'decision', 'approval', 'fyi'), options: stringList, urgency: oneOf('normal', 'high'), blocking: bool, excerpt }, ['questionId', 'kind', 'urgency', 'blocking']),
  QuestionRevised: open({ ...questionId, excerpt }, ['questionId']),
  QuestionAnswered: open({ ...questionId, excerpt }, ['questionId']),
  QuestionDeferred: open({ ...questionId, until: nullable(time) }, ['questionId']),
  QuestionClosed: open({ ...questionId, reason: str }, ['questionId']),
});

const messageId = { messageId: id };
const messagesAndLanes = defs('messages-lanes', ['lane-messages', 'lane-heartbeats', 'issue-work'], {
  MessageSent: open({ ...messageId, from: id, to: id, excerpt, withheld: bool }, ['messageId', 'from', 'to']),
  MessageDelivered: open({ ...messageId }),
  MessageRead: open({ ...messageId }),
  BroadcastSent: open({ ...messageId, from: id, excerpt, withheld: bool }, ['messageId', 'from']),
  LaneRegistered: open({ laneId: id, name: str, repositoryId: nullable(str) }, ['laneId', 'name']),
  LaneStatusChanged: open({ laneId: id, status: str, waitingOn: nullable(str), barredBy: nullable(str), parked: bool }, ['laneId', 'status']),
  LaneClosed: open({ laneId: id }),
  IssueClaimed: open({ issue: id, laneId: id, owner: nullable(str) }, ['issue', 'laneId']),
  IssueStatusChanged: open({ issue: id, status: str }),
});

const work = defs('work', ['session-jsonl', 'job-logs', 'phase-ledger', 'review-logs'], {
  JobStarted: open({ jobId: id, sessionId: nullable(id), name: str, kind: oneOf('job', 'phase', 'ci') }, ['jobId', 'name', 'kind']),
  JobFinished: open({ jobId: id, status: oneOf('done', 'failed'), exitCode: nullable({ type: 'integer' }) }, ['jobId', 'status']),
  PhaseQueued: open({ phaseId: id, label: str }),
  PhaseStarted: open({ phaseId: id, label: str }),
  PhaseFinished: open({ phaseId: id, label: str, exitCode: nullable({ type: 'integer' }) }, ['phaseId', 'label']),
  SubagentStarted: open({ ...sessionId, parentSessionId: id, name: nullable(str) }, ['sessionId', 'parentSessionId']),
  SubagentFinished: open({ ...sessionId, parentSessionId: id, outcome: str }, ['sessionId', 'parentSessionId']),
  ReviewRecorded: open({ reviewId: id, headSha: id, verdict: str }),
});

/** Read-only intent-memory records (ADR-0008, event-model S3): items, and journal message metadata without text. */
const memoryItemId = { itemId: id };
const memory = defs('memory', ['intent-memory'], {
  MemoryItemRecorded: open({
    ...memoryItemId, kind: oneOf('directive', 'order', 'decision'), scopeKind: oneOf('global', 'repo', 'lane', 'session', 'task'), scopeKey: str,
    sourceType: oneOf('user_message', 'coordinator_order', 'agent_decision', 'question_item'), sourceMessageId: nullable(id),
    authorityMode: nullable(oneOf('auto', 'command', 'none')), supersedes: array(id), excerpt, withheld: bool, gloss: excerpt,
  }, ['itemId', 'kind', 'scopeKind', 'scopeKey', 'sourceType', 'sourceMessageId', 'authorityMode', 'supersedes', 'excerpt', 'withheld']),
  MemoryItemConfirmed: open({ ...memoryItemId, actorKind: str }),
  MemoryItemRetired: open({ ...memoryItemId, status: oneOf('done', 'superseded', 'withdrawn', 'rejected'), actorKind: str, reasonExcerpt: excerpt }),
  MemoryMessageRecorded: open({
    ...messageId, ...sessionId, origin: oneOf('human', 'unattended', 'launch', 'injected'), injectedKind: nullable(str), withheld: bool, textBytes: int,
  }, ['messageId', 'sessionId', 'origin', 'injectedKind', 'withheld', 'textBytes']),
  MemoryMessageClassified: open({ ...messageId, whole: nullable(oneOf('none')), spanCount: int }),
});

const system = defs('system', ['console', 'session-jsonl', 'context-budget', 'lane-messages', 'question-store', 'phase-ledger', 'job-logs', 'intent-memory'], {
  SourceCheckpointAdvanced: open({ source: id, identity: id, generation: int, offset: int }),
  SourceUnavailable: open({ source: id, reason: str }),
  SourceSchemaUnknown: open({ source: id, identity: id, detail: str }),
  BackfillProgressed: open({ source: id, doneFiles: int, totalFiles: int, bytes: num }),
});

/** The M1 event catalogue (event-model section 2, trimmed to what M1 ingests and derives). */
export const catalogue: readonly EventDefinition[] = [...sessions, ...requests, ...questions, ...messagesAndLanes, ...work, ...memory, ...system];

const byType = new Map(catalogue.map(definition => [definition.type, definition]));
export const definitionOf = (type: string): EventDefinition | undefined => byType.get(type);

export function payloadValid(definition: EventDefinition, payload: unknown): string | null {
  try {
    validate(payload, definition.payload);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}
