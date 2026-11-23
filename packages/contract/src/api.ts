import { readFileSync } from 'node:fs';
import { memoryActionRequestSchema, memoryActionReceiptSchema, memoryActionAvailabilitySchema } from './memory-actions.ts';
import { array, bool, id, int, nullable, oneOf, ref, str, strict, time, excerpt, type Schema } from './schema-dsl.ts';

export interface JsonSchemaDocument { $schema?: string; $id?: string; $defs: Record<string, Schema> }

/** API v0 schemas, exactly as published in docs/api/schemas/api.json. */
export const apiV0Schema = JSON.parse(
  readFileSync(new URL('../../../docs/api/schemas/api.json', import.meta.url), 'utf8'),
) as JsonSchemaDocument;

const toolResult = strict({
  toolName: id, argsExcerpt: excerpt,
  resultKind: oneOf('text', 'json', 'diff', 'error', 'binary', 'none'),
  resultExcerpt: str, truncated: bool, withheld: bool,
});

/** Where a signal lives in the source transcript; `null` on items whose source has no transcript position. */
const sourcePointer = strict({ sessionId: id, entryId: id, fileOffset: int });

const attentionReason = oneOf('open-request', 'answer-possibly-unseen', 'blocking-question', 'lane-waiting-on-user', 'stale-session', 'proposed-memory');

const attentionItem = strict({
  id, reason: ref('attentionReason'), sessionId: nullable(id), laneId: nullable(id), text: str,
  since: time, pointer: nullable(ref('sourcePointer')),
});

/** One fact behind a derived request state (docs/requests.md): which transcript entry or reset, and when. */
const requestEvidence = strict({
  kind: oneOf('prompt', 'answer', 'later-prompt', 'abort', 'reset', 'boundary', 'session-end', 'explicit'),
  entryId: nullable(id), resetId: nullable(id), at: time,
});

/** Why a derived pairing is heuristic; `null` on the request when it is not. */
const requestUncertainty = oneOf('shared-answer', 'reset-then-new-prompt');

const v0Request = apiV0Schema.$defs.request as { properties: Record<string, Schema>; required: string[] };

/** v0 `request` plus the optional derivation fields (docs/requests.md). Every v0 request stays valid. */
const request = strict({
  ...v0Request.properties,
  withheld: bool, answerWithheld: bool, answerPossiblyUnseen: bool,
  uncertain: bool, uncertainReason: nullable(ref('requestUncertainty')),
  evidence: array(ref('requestEvidence')), derivedFrom: oneOf('session-jsonl', 'intent-memory'),
  pointer: nullable(ref('sourcePointer')),
}, v0Request.required);

const v0Question = apiV0Schema.$defs.question as { properties: Record<string, Schema>; required: string[] };

/** One recorded history entry of a question; `excerpt` is the bounded, redacted note or answer text. */
const questionHistoryEntry = strict({
  sequence: int, operation: id, at: time, actor: nullable(str), excerpt, withheld: bool, truncated: bool,
}, ['sequence', 'operation', 'at', 'actor']);

/** v0 `question` plus optional history fields. `history` absent means the source never supplied it (old events). Every v0 question stays valid. */
const question = strict({
  ...v0Question.properties,
  updatedAt: time, history: array(ref('questionHistoryEntry')), links: array(str),
}, v0Question.required);

const memoryStatus = oneOf('active', 'proposed', 'done', 'superseded', 'withdrawn', 'rejected');

/** One intent-memory item as recorded (docs/api/v1.md). `command` is text for a human to run in pi; the console never runs it. */
const memoryItem = strict({
  id, kind: oneOf('directive', 'order', 'decision'), scope: strict({ kind: oneOf('global', 'repo', 'lane', 'session', 'task'), key: str }),
  sessionId: nullable(id), status: ref('memoryStatus'), statusBasis: oneOf('recorded', 'assumed'), text: excerpt, withheld: bool,
  sourceType: oneOf('user_message', 'coordinator_order', 'agent_decision', 'question_item'), sourceMessageId: nullable(id), at: time, command: nullable(str),
});

/** Integers parsed from a handoff file's memory sections; every field is optional in the producer, so each group may be null. */
const memoryHandoff = strict({
  handoffId: id, at: time, degraded: bool,
  memoryIndex: nullable(strict({ items: int, messages: int, unresolved: int, withheld: int, proposed: int, rejected: int })),
  resumeCheck: nullable(strict({ activeDirectives: int, unresolvedMessages: int, proposedItems: int })),
});

const sessionMemory = strict({
  sessionId: id, storeDetected: bool,
  counts: strict({ active: int, proposed: int, done: int, superseded: int, withdrawn: int, rejected: int }),
  proposedConfirmable: int,
  unresolved: strict({ lowerBound: int, atLastHandoff: nullable(strict({ count: int, at: time })) }),
  wider: int, handoffs: array(ref('memoryHandoff')),
});

const graphNode = strict({ laneId: id, label: str, repositoryId: nullable(id) });
const graphEdge = strict({ fromLane: id, toLane: id, kind: oneOf('message', 'spawn', 'waiting-on', 'barred-by'), lastAt: time, count: int });

/** Whether a configured directory can be read; optional everywhere so payloads from older daemons stay valid. Never carries the path. */
const availability = oneOf('available', 'missing', 'unavailable', 'disabled');

/** Daemon health: lag per source, projection queue depth, db size, backfill progress, memory (docs/api/v1.md). */
const health = strict({
  status: oneOf('ok', 'starting', 'degraded'), startedAt: time,
  eventLog: strict({ lastSeq: int, dbBytes: int }),
  projection: strict({ position: int, queueDepth: int, skipped: int }),
  eventLoop: strict({ p50: { type: 'number', minimum: 0 }, p99: { type: 'number', minimum: 0 }, max: { type: 'number', minimum: 0 } }),
  stream: strict({ seq: int, clients: int, retained: int }),
  agentRootAvailability: availability,
  sources: array(strict({ source: id, files: int, lagBytes: int, lastPollAt: nullable(time), errors: int, availability }, ['source', 'files', 'lagBytes', 'lastPollAt', 'errors'])),
  backfill: strict({ complete: bool, windowDays: int }),
  memory: strict({ rssBytes: int, heapUsedBytes: int }),
}, ['status', 'startedAt', 'eventLog', 'projection', 'eventLoop', 'stream', 'sources', 'backfill', 'memory']);

/** Read-only daemon settings. Never paths, tokens or other values that identify the machine beyond the port. */
const settings = strict({
  version: int, bind: oneOf('127.0.0.1'), port: int, backfillWindowDays: int, replayWindow: int, webBundle: bool,
  agentRootAvailability: availability,
  sources: array(strict({ source: id, enabled: bool, availability }, ['source', 'enabled'])),
}, ['version', 'bind', 'port', 'backfillWindowDays', 'replayWindow', 'webBundle', 'sources']);

/**
 * Additive API v1 definitions (the gaps listed in docs/milestones.md M1). `transcriptEntry` and `request` replace the
 * v0 definitions of the same name with optional fields added; every other name is new. v1 = v0 plus these, nothing removed.
 */
const v0Snapshot = apiV0Schema.$defs.snapshot as { properties: Record<string, Schema>; required: string[] };

/**
 * v0 `snapshot` plus the optional bounded-screen-state fields: `totals` are the full collection sizes and `bounded` names
 * the collections that only hold a window (active items plus the newest). Absent `bounded` means every list is complete.
 */
const snapshot = strict({
  ...v0Snapshot.properties,
  totals: strict({ sessions: int, requests: int, questions: int, messages: int, jobs: int, resets: int }),
  bounded: array(oneOf('sessions', 'requests', 'questions', 'messages', 'jobs', 'resets')),
}, v0Snapshot.required);

/** Keyset page of one list endpoint; only returned when the request sends `limit`. `nextCursor` is opaque. */
const pageOf = (item: string) => strict({ items: array(ref(item)), nextCursor: nullable(str), hasMore: bool, total: int });

const v0Session = apiV0Schema.$defs.session as { properties: Record<string, Schema>; required: string[] };
/** Whole session plus an event-local canonical-memory invalidation; never stored on Session. */
const sessionUpdate = strict({ ...v0Session.properties, memoryChanged: bool }, v0Session.required);
const v0Event = apiV0Schema.$defs.event as { oneOf: { properties: Record<string, Schema> }[] };
const event = {
  oneOf: v0Event.oneOf.map(branch => (branch.properties.type as { const: string }).const === 'session.updated'
    ? { ...branch, properties: { ...branch.properties, payload: ref('sessionUpdate') } } : branch),
};

const v1Defs: Record<string, Schema> = {
  sessionUpdate, event,
  memoryActionRequest: memoryActionRequestSchema, memoryActionReceipt: memoryActionReceiptSchema, memoryActionAvailability: memoryActionAvailabilitySchema,
  snapshot, sessionPage: pageOf('session'), requestPage: pageOf('request'), questionPage: pageOf('question'),
  messagePage: pageOf('message'), jobPage: pageOf('job'), memoryItemPage: pageOf('memoryItem'), memoryItems: strict({ items: array(ref('memoryItem')) }), resetPage: pageOf('reset'), resets: strict({ items: array(ref('reset')) }),
  memoryStatus, memoryItem, memoryHandoff, sessionMemory, toolResult, sourcePointer, attentionReason, attentionItem, graphNode, graphEdge, requestEvidence, requestUncertainty, request, questionHistoryEntry, question,
  transcriptQuery: strict({ after: int, limit: { type: 'integer', minimum: 1, maximum: 1000 }, order: { enum: ['asc', 'desc'] }, around: str }, []),
  transcript: strict({ items: array(ref('transcriptEntry')), nextCursor: int, hasMore: bool, hasOlder: bool }, ['items', 'nextCursor', 'hasMore']),
  transcriptEntry: strict({
    id, cursor: int, sessionId: id, at: time,
    kind: oneOf('user', 'thinking', 'assistant.delta', 'assistant', 'tool.call', 'tool.result', 'diff', 'reset'),
    text: str, toolCallId: nullable(id), resetId: nullable(id),
    requestId: nullable(id), toolResult: nullable(ref('toolResult')),
  }, ['id', 'cursor', 'sessionId', 'at', 'kind', 'text', 'toolCallId', 'resetId']),
  needsYou: strict({ items: array(ref('attentionItem')) }),
  graph: strict({ nodes: array(ref('graphNode')), edges: array(ref('graphEdge')) }),
  health, settings,
};

export const apiV1Schema: JsonSchemaDocument = {
  $schema: apiV0Schema.$schema,
  $id: 'https://pi-console.invalid/api/v1/schemas/api.json',
  $defs: { ...apiV0Schema.$defs, ...v1Defs },
};

export const apiVersion = 1;

/** Known SSE names with additive v1 payload fields; sessionUpdate's marker is event-local. */
export const eventPayloads = {
  snapshot: 'snapshot', 'session.updated': 'sessionUpdate', 'transcript.appended': 'transcriptEntry',
  'request.observed': 'request', 'request.interrupted': 'request', 'question.asked': 'question',
  'message.sent': 'message', 'job.updated': 'job', 'job.finished': 'job',
  'reset.occurred': 'reset', 'intervention.recorded': 'intervention',
} as const;
