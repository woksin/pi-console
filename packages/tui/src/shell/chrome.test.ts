import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banner } from './chrome.ts';
import type { Connection } from '../store/store.ts';

const offline: Connection = { connected: false, error: 'terminated', lastSeq: 42, lastEventAt: Date.parse('2026-11-20T12:00:03Z'), eventsReceived: 1 };

test('reconnect banner shows human wording, as-of time and retrying at 80 columns', () => {
  const text = banner(offline, 80)?.map(part => part.text).join('');
  assert.match(text ?? '', /Daemon unreachable · showing data as of 12:00:03 UTC · retrying/);
  assert.doesNotMatch(text ?? '', /terminated|#42/);
  assert.equal(banner({ ...offline, connected: true }, 80), undefined);
});
