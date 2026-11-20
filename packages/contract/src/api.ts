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

const graphNode = strict({ laneId: id, label: str, repositoryId: nullable(id) });
const graphEdge = strict({ fromLane: id, toLane: id, kind: oneOf('message', 'spawn', 'waiting-on', 'barred-by'), lastAt: time, count: int });

/**
 * Additive API v1 definitions (the gaps listed in docs/milestones.md M1). `transcriptEntry` replaces the v0
 * definition of the same name; every other name is new. v1 = v0 plus these, nothing removed.
 */
const v1Defs: Record<string, Schema> = {
  toolResult, sourcePointer, attentionReason, attentionItem, graphNode, graphEdge,
  transcriptEntry: strict({
    id, cursor: int, sessionId: id, at: time,
    kind: oneOf('user', 'thinking', 'assistant.delta', 'assistant', 'tool.call', 'tool.result', 'diff', 'reset'),
    text: str, toolCallId: nullable(id), resetId: nullable(id),
    requestId: nullable(id), toolResult: nullable(ref('toolResult')),
  }),
  needsYou: strict({ items: array(ref('attentionItem')) }),
  graph: strict({ nodes: array(ref('graphNode')), edges: array(ref('graphEdge')) }),
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
