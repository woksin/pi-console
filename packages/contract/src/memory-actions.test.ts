import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryActionRequestSchema, parseChannelFrame, reviewValue } from './memory-actions.ts';

test('review request is only an intent, never human provenance or a caller-supplied target', () => {
  const request = { requestId: 'r1', itemId: 'i1', action: 'confirm' };
  assert.deepEqual(reviewValue(request, memoryActionRequestSchema), request);
  for (const key of ['actor', 'human', 'proof', 'text', 'path', 'sessionId', 'generation', 'expiresAt']) {
    assert.throws(() => reviewValue({ ...request, [key]: true }, memoryActionRequestSchema));
  }
  for (const key of ['constructor', '__proto__', 'toString', 'valueOf']) {
    const hostile = JSON.parse(`{"requestId":"r1","itemId":"i1","action":"confirm","${key}":"/etc/passwd"}`);
    assert.throws(() => reviewValue(hostile, memoryActionRequestSchema));
  }
  for (const itemId of ['', '../item', 'a'.repeat(129)]) assert.throws(() => reviewValue({ ...request, itemId }, memoryActionRequestSchema));
});
test('channel rejects unknown, malformed and oversized frames', () => {
  for (const frame of ['null', '{}', '{', JSON.stringify({ type: 'approve', human: true }), ' '.repeat(16_385)]) assert.throws(() => parseChannelFrame(frame));
  assert.throws(() => parseChannelFrame(JSON.stringify({ type: 'cancel', requestId: '../id' })));
  assert.throws(() => parseChannelFrame('{"type":"readiness","value":{"version":1,"available":false,"storeId":"","constructor":"path"}}'));
});
