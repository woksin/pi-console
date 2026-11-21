import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionBanner } from './connection.ts';

const lastEventAt = Date.parse('2026-11-20T12:00:03Z');

test('live has no banner; reconnect copy names when the visible data was received', () => {
  assert.equal(connectionBanner({ connected: true, lastEventAt }), undefined);
  assert.equal(connectionBanner({ connected: false, lastEventAt }), 'Daemon unreachable · showing data as of 12:00:03 UTC · retrying');
});

test('first connection distinguishes waiting from a stale snapshot', () => {
  assert.equal(connectionBanner({ connected: false, lastEventAt: undefined }), 'Daemon unreachable · waiting for data · retrying');
});
