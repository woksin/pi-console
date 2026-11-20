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
  assert.deepEqual(added.sort(), ['attentionItem', 'attentionReason', 'graph', 'graphEdge', 'graphNode', 'needsYou', 'sourcePointer', 'toolResult']);
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

test('graph carries lane edges and no layout coordinates', () => {
  const edge = { fromLane: 'L0', toLane: 'L192', kind: 'message', lastAt: '2026-11-20T09:00:00Z', count: 3 };
  validate({ nodes: [{ laneId: 'L0', label: 'coordinator', repositoryId: null }], edges: [edge] }, apiV1Schema.$defs.graph, apiV1Schema);
  assert.throws(() => validate({ nodes: [{ laneId: 'L0', label: 'x', repositoryId: null, x: 1 }], edges: [] }, apiV1Schema.$defs.graph, apiV1Schema));
});

test('generated TypeScript types match the schemas they are generated from', () => {
  assert.deepEqual(staleFiles(), []);
});
