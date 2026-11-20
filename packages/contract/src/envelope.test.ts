import { test } from 'node:test';
import assert from 'node:assert/strict';
import { idempotencyKey, validateEnvelope, type EventEnvelope } from './envelope.ts';

const valid: EventEnvelope = {
  seq: 1, id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', type: 'SessionStarted', version: 1,
  occurredAt: '2026-11-20T09:00:00Z', recordedAt: '2026-11-20T09:00:01.250Z', source: 'session-jsonl',
  idempotencyKey: 'k', subject: 'session:s1', actor: 'system',
  payload: {}, refs: { file: 'a.jsonl', offset: 0, entryId: null },
};

test('a well-formed envelope validates and is returned unchanged', () => {
  const result = validateEnvelope(valid);
  assert.deepEqual(result, { ok: true, event: valid });
});

test('envelopes with a bad shape, id, subject, actor, version or timestamp are rejected', () => {
  const bad: unknown[] = [
    null, {}, { ...valid, seq: -1 }, { ...valid, id: 'not-a-uuid' },
    { ...valid, id: '0190a1b2-c3d4-4e5f-8a9b-0c1d2e3f4a5b' },
    { ...valid, subject: 'nothing' }, { ...valid, subject: 'planet:earth' }, { ...valid, actor: 'robot' },
    { ...valid, version: 0 }, { ...valid, occurredAt: 'yesterday' }, { ...valid, refs: { file: 'a', offset: 1.5, entryId: null } },
    { ...valid, extra: true },
  ];
  for (const value of bad) assert.equal(validateEnvelope(value).ok, false, JSON.stringify(value));
});

test('user and agent actors and a null refs pointer are accepted', () => {
  for (const actor of ['user:dev', 'agent:s2'] as const) assert.equal(validateEnvelope({ ...valid, actor, refs: null }).ok, true);
});

test('idempotency key is deterministic, distinguishes every part, and cannot be forged by separators', () => {
  const parts = { source: 'session-jsonl', identity: 'dev1:ino2:birth3', generation: 0, offset: 120, type: 'TurnEnded' };
  assert.equal(idempotencyKey(parts), idempotencyKey({ ...parts }));
  const variants = [{ source: 'x' }, { identity: 'x' }, { generation: 1 }, { offset: 121 }, { offset: 'entry-1' }, { type: 'TurnStarted' }];
  const keys = new Set([idempotencyKey(parts), ...variants.map(change => idempotencyKey({ ...parts, ...change }))]);
  assert.equal(keys.size, variants.length + 1);
  assert.notEqual(
    idempotencyKey({ ...parts, source: 'a|b', identity: 'c' }),
    idempotencyKey({ ...parts, source: 'a', identity: 'b|c' }),
  );
});
