import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionMapper } from './mapper.ts';

const record = { type: 'message', id: 'entry', timestamp: '2026-07-01T09:00:00Z' };

test('documented non-answer assistant stop reasons are intentionally ignored', () => {
  for (const stopReason of ['length', 'pending', 'deferred', 'toolUse', 'error']) {
    assert.deepEqual(sessionMapper('s')({ ...record, message: { role: 'assistant', stopReason, content: 'not a completed answer' } }).map(fact => fact.type), ['SessionCostObserved']);
  }
  assert.throws(() => sessionMapper('s')({ ...record, message: { role: 'assistant', stopReason: 'future' } }), /Unknown assistant stop reason/);
});

test('v3 distinguishes known unparented headers from unresolved parent paths', () => {
  const header = { type: 'session', version: 3, id: 's', cwd: '/synthetic', timestamp: record.timestamp };
  const [root] = sessionMapper('s')(header);
  assert.equal(root.payload.parentSessionId, null);
  assert.equal(root.payload.parentSessionKnown, true);
  const [fork] = sessionMapper('s')({ ...header, parentSession: '/synthetic/parent.jsonl' });
  assert.equal(fork.payload.parentSessionId, null);
  assert.equal(fork.payload.parentSessionKnown, false);
  assert.equal(fork.payload.parentSessionPath, '/synthetic/parent.jsonl');
  assert.throws(() => sessionMapper('s')({ ...header, parentSession: 42 }), /Expected string/);
});

test('inherited record types are rejected explicitly rather than invoked as handlers', () => {
  for (const type of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty']) {
    assert.throws(() => sessionMapper('s')({ ...record, type }), /Unknown session entry/);
  }
});
