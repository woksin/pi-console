import { readFileSync } from 'node:fs';
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

const attentionReason = oneOf('open-request', 'answer-possibly-unseen', 'blocking-question', 'lane-waiting-on-user', 'stale-session');

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

const graphNode = strict({ laneId: id, label: str, repositoryId: nullable(id) });
const graphEdge = strict({ fromLane: id, toLane: id, kind: oneOf('message', 'spawn', 'waiting-on', 'barred-by'), lastAt: time, count: int });

/** Daemon health: lag per source, projection queue depth, db size, backfill progress, memory (docs/api/v1.md). */
const health = strict({
  status: oneOf('ok', 'starting', 'degraded'), startedAt: time,
  eventLog: strict({ lastSeq: int, dbBytes: int }),
  projection: strict({ position: int, queueDepth: int, skipped: int }),
  stream: strict({ seq: int, clients: int, retained: int }),
  sources: array(strict({ source: id, files: int, lagBytes: int, lastPollAt: nullable(time), errors: int })),
  backfill: strict({ complete: bool, windowDays: int }),
  memory: strict({ rssBytes: int, heapUsedBytes: int }),
});

/** Read-only daemon settings. Never paths, tokens or other values that identify the machine beyond the port. */
const settings = strict({
  version: int, bind: oneOf('127.0.0.1'), port: int, backfillWindowDays: int, replayWindow: int, webBundle: bool,
  sources: array(strict({ source: id, enabled: bool })),
});

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

const v1Defs: Record<string, Schema> = {
  snapshot, sessionPage: pageOf('session'), requestPage: pageOf('request'), questionPage: pageOf('question'),
  messagePage: pageOf('message'), jobPage: pageOf('job'), resetPage: pageOf('reset'), resets: strict({ items: array(ref('reset')) }),
  toolResult, sourcePointer, attentionReason, attentionItem, graphNode, graphEdge, requestEvidence, requestUncertainty, request,
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

/** SSE event type to the schema definition of its payload (v0 stream, unchanged in v1). */
export const eventPayloads = {
  snapshot: 'snapshot', 'session.updated': 'session', 'transcript.appended': 'transcriptEntry',
  'request.observed': 'request', 'request.interrupted': 'request', 'question.asked': 'question',
  'message.sent': 'message', 'job.updated': 'job', 'job.finished': 'job',
  'reset.occurred': 'reset', 'intervention.recorded': 'intervention',
} as const;
