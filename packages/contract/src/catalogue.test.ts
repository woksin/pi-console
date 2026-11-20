import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalogue, definitionOf, payloadValid } from './catalogue.ts';
import { decode, upcasters } from './upcast.ts';
import type { EventEnvelope } from './envelope.ts';

const envelope = (over: Partial<EventEnvelope>): EventEnvelope => ({
  seq: 1, id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', type: 'SessionEnded', version: 1,
  occurredAt: '2026-11-20T09:00:00Z', recordedAt: '2026-11-20T09:00:00Z', source: 'session-jsonl',
  idempotencyKey: 'k', subject: 'session:s1', actor: 'system', payload: { sessionId: 's1', reason: 'exit' }, refs: null, ...over,
});

test('the M1 catalogue has unique type names, version 1, and covers every group', () => {
  const types = catalogue.map(definition => definition.type);
  assert.equal(new Set(types).size, types.length);
  assert.ok(catalogue.every(definition => definition.version === 1 && definition.sources.length > 0));
  assert.deepEqual(new Set(catalogue.map(definition => definition.group)), new Set(['sessions', 'requests', 'questions', 'messages-lanes', 'work', 'system']));
  for (const required of ['RequestObserved', 'AnswerObserved', 'RequestInterrupted', 'ResetOccurred', 'ContextPressureSampled', 'SourceSchemaUnknown']) {
    assert.ok(definitionOf(required), required);
  }
});

test('payload schemas require their identity fields and accept additive fields', () => {
  const request = definitionOf('RequestObserved')!;
  const payload = { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'initial prompt' };
  assert.equal(payloadValid(request, payload), null);
  assert.equal(payloadValid(request, { ...payload, addedLater: 1 }), null);
  assert.match(payloadValid(request, { ...payload, origin: 'guess' })!, /enum/);
  assert.match(payloadValid(request, { sessionId: 's1' })!, /missing/);
  assert.match(payloadValid(request, { ...payload, excerpt: 'x'.repeat(201) })!, /maximum/);
});

test('decode returns current events unchanged', () => {
  const event = envelope({});
  assert.deepEqual(decode(event), { kind: 'ok', event });
});

test('decode skips unknown types, unknown (future or zero) versions and invalid payloads instead of throwing', () => {
  assert.deepEqual(decode(envelope({ type: 'FromTheFuture' })), { kind: 'skipped', reason: 'unknown-type', detail: 'FromTheFuture' });
  assert.equal((decode(envelope({ version: 2 })) as { reason: string }).reason, 'unknown-version');
  assert.equal((decode(envelope({ version: 0 })) as { reason: string }).reason, 'unknown-version');
  assert.equal((decode(envelope({ payload: { sessionId: 7 } })) as { reason: string }).reason, 'invalid-payload');
});

test('upcasters are empty in M1 (all types at version 1)', () => {
  assert.deepEqual(upcasters, {});
});
