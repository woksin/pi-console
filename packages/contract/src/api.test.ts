import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiV0Schema, apiV1Schema } from './api.ts';
import { validate } from './validate.ts';
import { staleFiles } from './generate-types.ts';

const base = { id: 'e1', cursor: 1, sessionId: 's2', at: '2026-11-20T09:00:00Z', kind: 'user', text: 'hello', toolCallId: null, resetId: null };
const toolResult = { toolName: 'read', argsExcerpt: 'src/a.ts', resultKind: 'text', resultExcerpt: 'x', truncated: false, withheld: false };

test('docs/api/schemas/api.json is valid JSON and v1 only adds to or replaces v0 definitions', () => {
  const published = JSON.parse(readFileSync(new URL('../../../docs/api/schemas/api.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, apiV0Schema);
  for (const name of Object.keys(apiV0Schema.$defs)) assert.ok(name in apiV1Schema.$defs, name);
  const added = Object.keys(apiV1Schema.$defs).filter(name => !(name in apiV0Schema.$defs));
  assert.deepEqual(added.sort(), ['attentionItem', 'attentionReason', 'graph', 'graphEdge', 'graphNode', 'health', 'jobPage', 'memoryActionAvailability', 'memoryActionReceipt', 'memoryActionRequest', 'memoryHandoff', 'memoryItem', 'memoryItemPage', 'memoryItems', 'memoryStatus', 'messagePage', 'needsYou', 'questionPage', 'requestEvidence', 'requestPage', 'requestUncertainty', 'resetPage', 'resets', 'sessionMemory', 'sessionPage', 'sessionUpdate', 'settings', 'sourcePointer', 'toolResult', 'transcriptQuery']);
});

test('session memory invalidation is optional, typed and event-local', () => {
  const session = {
    id: 's1', repositoryId: 'repo', name: '', laneId: 'lane', role: 'main', parentSessionId: null,
    orchestratorSessionId: 's1', branch: '', cwd: '', model: '', status: 'idle',
    startedAt: '2026-11-20T09:00:00Z', updatedAt: '2026-11-20T09:00:00Z', contextPercent: 0, samples: [],
  };
  const frame = { seq: 1, type: 'session.updated', occurredAt: session.updatedAt, payload: session };
  validate(frame, apiV1Schema.$defs.event, apiV1Schema);
  validate(frame, apiV0Schema.$defs.event, apiV0Schema);
  const marked = { ...session, memoryChanged: true };
  validate(marked, apiV1Schema.$defs.sessionUpdate, apiV1Schema);
  validate({ ...frame, payload: marked }, apiV1Schema.$defs.event, apiV1Schema);
  assert.throws(() => validate({ ...frame, payload: { ...marked, memoryChanged: 'true' } }, apiV1Schema.$defs.event, apiV1Schema));
  assert.throws(() => validate(marked, apiV1Schema.$defs.session, apiV1Schema));
});

test('a v0 request is valid under v1, and v1 requests accept the derivation fields', () => {
  const v0 = {
    id: 'r1', sessionId: 's1', text: 'ask', origin: 'launch', originLabel: 'Initial prompt', originEvidence: 'first prompt', status: 'answered',
    createdAt: '2026-11-20T09:00:00Z', resetId: null, answer: { id: 'a1', text: 'done', at: '2026-11-20T09:01:00Z', interim: false }, interimAnswers: [],
  };
  validate(v0, apiV1Schema.$defs.request, apiV1Schema);
  const derived = {
    ...v0, withheld: false, answerWithheld: false, answerPossiblyUnseen: true, uncertain: true, uncertainReason: 'shared-answer',
    evidence: [{ kind: 'prompt', entryId: 'e1', resetId: null, at: '2026-11-20T09:00:00Z' }, { kind: 'boundary', entryId: 'e9', resetId: 'c1', at: '2026-11-20T09:02:00Z' }],
    derivedFrom: 'session-jsonl', pointer: { sessionId: 's1', entryId: 'e1', fileOffset: 120 },
  };
  validate(derived, apiV1Schema.$defs.request, apiV1Schema);
  assert.throws(() => validate({ ...derived, uncertainReason: 'guess' }, apiV1Schema.$defs.request, apiV1Schema));
  assert.throws(() => validate({ ...derived, evidence: [{ kind: 'vibes', entryId: null, resetId: null, at: v0.createdAt }] }, apiV1Schema.$defs.request, apiV1Schema));
  assert.throws(() => validate(derived, apiV0Schema.$defs.request, apiV0Schema));
});

test('a v0 transcript entry is valid under v1 (additive)', () => {
  validate(base, apiV1Schema.$defs.transcriptEntry, apiV1Schema);
  validate(base, apiV0Schema.$defs.transcriptEntry, apiV0Schema);
});

test('v1 transcript entries accept requestId and structured tool results', () => {
  const entry = { ...base, requestId: 'r1', toolResult: null };
  validate(entry, apiV1Schema.$defs.transcriptEntry, apiV1Schema);
  validate({ ...entry, kind: 'tool.result', toolCallId: 'c1', toolResult }, apiV1Schema.$defs.transcriptEntry, apiV1Schema);
});

test('v1 transcript entries reject wrong-typed new fields', () => {
  const schema = apiV1Schema.$defs.transcriptEntry;
  assert.throws(() => validate({ ...base, requestId: 5 }, schema, apiV1Schema));
  assert.throws(() => validate({ ...base, toolResult: { ...toolResult, resultKind: 'video' } }, schema, apiV1Schema));
  assert.throws(() => validate({ ...base, toolResult: 'x' }, schema, apiV1Schema));
});

test('attention items carry an optional transcript pointer and one of the defined reasons', () => {
  const item = { id: 'n1', reason: 'open-request', sessionId: 's2', laneId: null, text: 'Answer needed', since: '2026-11-20T09:00:00Z', pointer: { sessionId: 's2', entryId: 'e1', fileOffset: 10 } };
  const schema = apiV1Schema.$defs.needsYou;
  validate({ items: [item, { ...item, reason: 'blocking-question', pointer: null }] }, schema, apiV1Schema);
  assert.throws(() => validate({ items: [{ ...item, reason: 'unproven-prompt' }] }, schema, apiV1Schema));
  assert.throws(() => validate({ items: [{ ...item, pointer: { sessionId: 's2' } }] }, schema, apiV1Schema));
});

test('a page carries items, an opaque cursor, hasMore and the total; a snapshot may add totals and bounded', () => {
  validate({ items: [], nextCursor: null, hasMore: false, total: 0 }, apiV1Schema.$defs.jobPage, apiV1Schema);
  validate({ items: [], nextCursor: 'abc', hasMore: true, total: 9 }, apiV1Schema.$defs.messagePage, apiV1Schema);
  assert.throws(() => validate({ items: [], nextCursor: null, hasMore: false }, apiV1Schema.$defs.jobPage, apiV1Schema));
  const snapshot = { version: 0, generatedAt: '2026-11-20T09:00:00Z', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets: [], transcriptCursors: [], interventions: [] };
  validate(snapshot, apiV1Schema.$defs.snapshot, apiV1Schema);
  validate({ ...snapshot, totals: { sessions: 1, requests: 2, questions: 3, messages: 4, jobs: 5, resets: 6 }, bounded: ['jobs'] }, apiV1Schema.$defs.snapshot, apiV1Schema);
  validate({ ...snapshot, bounded: ['resets'] }, apiV1Schema.$defs.snapshot, apiV1Schema);
  assert.throws(() => validate({ ...snapshot, bounded: ['unknown'] }, apiV1Schema.$defs.snapshot, apiV1Schema));
  const reset = { id: 'reset-1', sessionId: 's1', kind: 'compaction', at: '2026-11-20T09:00:00Z', carriedRequestIds: [], interruptedRequestIds: [] };
  validate({ items: [reset], nextCursor: null, hasMore: false, total: 1 }, apiV1Schema.$defs.resetPage, apiV1Schema);
  validate({ items: [reset] }, apiV1Schema.$defs.resets, apiV1Schema);
});

test('graph carries lane edges and no layout coordinates', () => {
  const edge = { fromLane: 'L0', toLane: 'L192', kind: 'message', lastAt: '2026-11-20T09:00:00Z', count: 3 };
  validate({ nodes: [{ laneId: 'L0', label: 'coordinator', repositoryId: null }], edges: [edge] }, apiV1Schema.$defs.graph, apiV1Schema);
  assert.throws(() => validate({ nodes: [{ laneId: 'L0', label: 'x', repositoryId: null, x: 1 }], edges: [] }, apiV1Schema.$defs.graph, apiV1Schema));
});

test('generated TypeScript types match the schemas they are generated from', () => {
  assert.deepEqual(staleFiles(), []);
});

const legacyHealth = {
  status: 'ok', startedAt: '2026-11-20T09:00:00Z', eventLog: { lastSeq: 1, dbBytes: 1 }, projection: { position: 1, queueDepth: 0, skipped: 0 },
  eventLoop: { p50: 0, p99: 0, max: 0 }, stream: { seq: 1, clients: 0, retained: 0 },
  sources: [{ source: 'session-jsonl', files: 1, lagBytes: 0, lastPollAt: null, errors: 0 }], backfill: { complete: true, windowDays: 14 }, memory: { rssBytes: 1, heapUsedBytes: 1 },
};
const legacySettings = { version: 1, bind: '127.0.0.1', port: 1, backfillWindowDays: 14, replayWindow: 10, webBundle: false, sources: [{ source: 'session-jsonl', enabled: true }] };

test('health and settings accept payloads without directory availability, and the optional availability values', () => {
  validate(legacyHealth, apiV1Schema.$defs.health, apiV1Schema);
  validate(legacySettings, apiV1Schema.$defs.settings, apiV1Schema);
  validate({ ...legacyHealth, agentRootAvailability: 'missing', sources: [{ ...legacyHealth.sources[0], availability: 'unavailable' }] }, apiV1Schema.$defs.health, apiV1Schema);
  validate({ ...legacySettings, agentRootAvailability: 'disabled', sources: [{ source: 'session-jsonl', enabled: false, availability: 'available' }] }, apiV1Schema.$defs.settings, apiV1Schema);
});

test('health and settings reject an unknown or mistyped availability', () => {
  assert.throws(() => validate({ ...legacyHealth, agentRootAvailability: 'gone' }, apiV1Schema.$defs.health, apiV1Schema));
  assert.throws(() => validate({ ...legacyHealth, sources: [{ ...legacyHealth.sources[0], availability: true }] }, apiV1Schema.$defs.health, apiV1Schema));
  assert.throws(() => validate({ ...legacySettings, sources: [{ source: 'x', enabled: true, availability: 'ok' }] }, apiV1Schema.$defs.settings, apiV1Schema));
  assert.throws(() => validate({ ...legacySettings, agentRootAvailability: 1 }, apiV1Schema.$defs.settings, apiV1Schema));
});
