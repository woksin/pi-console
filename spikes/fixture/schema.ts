// The committed JSON Schemas are generated from this stdlib-only description.
type Schema = Record<string, unknown>;
const string = { type: 'string' };
const id = { type: 'string', minLength: 1 };
const integer = { type: 'integer', minimum: 0 };
const number = { type: 'number', minimum: 0 };
const boolean = { type: 'boolean' };
const time = { type: 'string', format: 'date-time' };
const enumeration = (...values: string[]) => ({ type: 'string', enum: values });
const nullable = (value: Schema) => ({ anyOf: [value, { type: 'null' }] });
const array = (items: Schema) => ({ type: 'array', items });
const ref = (name: string) => ({ $ref: `#/$defs/${name}` });
function object(properties: Record<string, Schema>, required = Object.keys(properties)) {
  return { type: 'object', properties, required, additionalProperties: false };
}
const list = (name: string) => object({ items: array(ref(name)) });
const status = enumeration('working', 'needs-you', 'blocked', 'waiting', 'idle', 'done', 'failed');
const answer = object({ id, text: string, at: time, interim: boolean });
const sample = object({ at: time, contextPercent: { ...number, maximum: 100 }, tokens: integer, costUsd: number });
const session = object({
  id, repositoryId: id, name: string, laneId: id,
  role: enumeration('orchestrator', 'main', 'subagent'), parentSessionId: nullable(id),
  orchestratorSessionId: id, branch: string, cwd: string, model: string, status,
  startedAt: time, updatedAt: time, contextPercent: { ...number, maximum: 100 }, samples: array(sample),
});
const request = object({
  id, sessionId: id, text: string, origin: enumeration('human', 'launch', 'unproven'),
  originLabel: enumeration('Human request', 'Initial prompt', 'Unproven origin'), originEvidence: string,
  status: enumeration('open', 'answered', 'unanswered', 'interrupted'), createdAt: time,
  resetId: nullable(id), answer: nullable(answer), interimAnswers: array(answer),
});
const question = object({
  id, sessionId: id, kind: enumeration('question', 'decision', 'approval', 'fyi'), text: string,
  options: array(string), urgency: enumeration('normal', 'high'), blocking: boolean,
  status: enumeration('open', 'answered', 'deferred', 'closed'), createdAt: time,
});
const message = object({
  id, fromSessionId: id, toSessionId: id, text: string,
  status: enumeration('sent', 'delivered', 'read'), sentAt: time,
});
const job = object({
  id, sessionId: id, kind: enumeration('job', 'phase', 'ci'), name: string,
  status: enumeration('running', 'queued', 'done', 'failed'), startedAt: time, exitCode: nullable({ type: 'integer' }),
});
const reset = object({
  id, sessionId: id, kind: enumeration('handoff', 'compaction', 'relaunch'), at: time,
  carriedRequestIds: array(id), interruptedRequestIds: array(id),
});
const transcriptEntry = object({
  id, cursor: integer, sessionId: id, at: time,
  kind: enumeration('user', 'thinking', 'assistant.delta', 'assistant', 'tool.call', 'tool.result', 'diff', 'reset'),
  text: string, toolCallId: nullable(id), resetId: nullable(id),
});
const interventionFields = {
  type: enumeration('answer', 'steer', 'followUp', 'nextTurn', 'abort'),
  sessionId: id, questionId: id, text: { type: 'string', minLength: 1, maxLength: 10000 }, confirmation: id,
};
const interventionInput = object(interventionFields, ['type', 'sessionId']);
const intervention = object({
  id, type: interventionFields.type, sessionId: id, questionId: nullable(id), text: string,
  confirmation: nullable(id), actor: { const: 'user:dev' }, tokenId: { const: 'dev' },
  origin: string, result: { const: 'mock-only' }, recordedAt: time,
});
const overview = object({
  counts: object({ sessions: integer, repositories: integer, byStatus: object(Object.fromEntries(status.enum.map(s => [s, integer]))) }),
  needsYou: array(object({ id, sessionId: id, kind: enumeration('request', 'question'), text: string })),
  sparkline: array(sample),
});
const snapshot = object({
  version: { const: 0 }, generatedAt: time, repositories: array(object({ id, name: string })),
  sessions: array(ref('session')), requests: array(ref('request')), questions: array(ref('question')),
  messages: array(ref('message')), jobs: array(ref('job')), resets: array(ref('reset')),
  transcriptCursors: array(object({ sessionId: id, cursor: integer })), interventions: array(ref('intervention')),
});
export const eventPayloads = {
  snapshot: 'snapshot', 'session.updated': 'session', 'transcript.appended': 'transcriptEntry',
  'request.observed': 'request', 'request.interrupted': 'request', 'question.asked': 'question',
  'message.sent': 'message', 'job.updated': 'job', 'job.finished': 'job',
  'reset.occurred': 'reset', 'intervention.recorded': 'intervention',
};
export const schema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://pi-console.invalid/api/v0/schemas/api.json',
  $defs: {
    session, request, question, message, job, reset, transcriptEntry, interventionInput, intervention, overview, snapshot,
    sessions: list('session'), requests: list('request'), questions: list('question'), messages: list('message'), jobs: list('job'),
    sessionDetail: object({ session: ref('session'), requests: array(ref('request')), questions: array(ref('question')), jobs: array(ref('job')), resets: array(ref('reset')), subagents: array(ref('session')) }),
    transcript: object({ items: array(ref('transcriptEntry')), nextCursor: integer, hasMore: boolean }),
    error: object({ error: string }),
    event: { oneOf: Object.entries(eventPayloads).map(([type, payload]) => object({
      seq: integer, type: { const: type }, occurredAt: time, payload: ref(payload),
    })) },
  },
};
