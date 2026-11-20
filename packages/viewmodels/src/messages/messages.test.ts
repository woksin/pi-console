import { test } from 'node:test';
import assert from 'node:assert/strict';
import { messagesViewModel } from './messages.ts';
import { fixture, golden, now } from '../test-support.ts';

test('messages are newest first with a delivery glyph', () => {
  const model = messagesViewModel({ messages: fixture.messages, sessions: fixture.sessions, now });
  assert.equal(model.rows.length, fixture.messages.length);
  const times = model.rows.map(row => row.time);
  assert.deepEqual(times, [...times].sort().reverse());
  golden('messages', model);
});
