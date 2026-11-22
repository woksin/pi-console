import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionBanner, tokenRejectedError } from './connection.ts';

const lastEventAt = Date.parse('2026-11-20T12:00:03Z');

test('live has no banner; reconnect copy names when the visible data was received', () => {
  assert.equal(connectionBanner({ connected: true, lastEventAt }), undefined);
  assert.equal(connectionBanner({ connected: false, lastEventAt }), 'Daemon unreachable · showing data as of 12:00:03 UTC · retrying');
});

test('first connection distinguishes waiting from a stale snapshot', () => {
  assert.equal(connectionBanner({ connected: false, lastEventAt: undefined }), 'Daemon unreachable · waiting for data · retrying');
});

test('the last error follows the as-of time when the banner has room', () => {
  assert.equal(connectionBanner({ connected: false, lastEventAt, error: 'terminated' }), 'Daemon unreachable · showing data as of 12:00:03 UTC · terminated · retrying');
  assert.equal(connectionBanner({ connected: false, lastEventAt: undefined, error: '' }), 'Daemon unreachable · waiting for data · retrying');
  assert.equal(connectionBanner({ connected: true, lastEventAt, error: 'terminated' }), undefined);
});

test('a banner that is too narrow keeps the error and drops the as-of time, clipping a long error', () => {
  const narrow = connectionBanner({ connected: false, lastEventAt, error: 'Daemon answered HTTP 500' }, 60);
  assert.equal(narrow, 'Daemon unreachable · Daemon answered HTTP 500 · retrying');
  const clipped = connectionBanner({ connected: false, lastEventAt, error: 'x'.repeat(100) }, 60);
  assert.equal(Array.from(clipped ?? '').length, 60);
  assert.match(clipped ?? '', /^Daemon unreachable · x+… · retrying$/);
  assert.equal(connectionBanner({ connected: false, lastEventAt, error: 'terminated' }, 30), 'Daemon unreachable · showing data as of 12:00:03 UTC · retrying', 'no room for even a short error');
});

test('a rejected token says how to fix it instead of reporting an unreachable daemon', () => {
  const text = connectionBanner({ connected: false, lastEventAt, error: tokenRejectedError }, 60);
  assert.match(text ?? '', /^Token rejected · check PI_CONSOLE_TOKEN or --data-dir/);
  assert.doesNotMatch(text ?? '', /unreachable/);
  assert.ok(Array.from(text ?? '').length <= 64);
});
