import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMessageRows, messagesViewModel } from './messages.ts';
import { fixture, golden, now } from '../test-support.ts';

test('messages are newest first with a delivery glyph', () => {
  const model = messagesViewModel({ messages: fixture.messages, sessions: fixture.sessions, now });
  assert.equal(model.rows.length, fixture.messages.length);
  const times = model.rows.map(row => row.time);
  assert.deepEqual(times, [...times].sort().reverse());
  golden('messages', model);
});

test('the filter matches message text and both lane names, ignoring case', () => {
  const { rows } = messagesViewModel({ messages: fixture.messages, sessions: fixture.sessions, now });
  assert.deepEqual(filterMessageRows(rows, ''), rows);
  assert.ok(filterMessageRows(rows, rows[0].text.slice(1, 6).toUpperCase()).includes(rows[0]));
  assert.ok(filterMessageRows(rows, rows[0].from).includes(rows[0]));
  assert.ok(filterMessageRows(rows, rows[0].to).includes(rows[0]));
  assert.deepEqual(filterMessageRows(rows, 'no-such-message-zzz'), []);
});
