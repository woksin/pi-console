import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daemonHealthRows, settingsViewModel } from './settings.ts';
import { golden, now } from '../test-support.ts';

const input = { endpoint: 'http://127.0.0.1:4777', connected: true, error: '', tokenSource: 'token file', lastSeq: 42, lastEventAt: now - 3000, eventsReceived: 40, now, counts: { sessions: 30, requests: 6 } };

test('settings reports health, lag tone and data counts', () => {
  const model = settingsViewModel(input);
  assert.equal(model.health.find(row => row.label === 'Stream')?.tone, 'good');
  assert.equal(model.health.find(row => row.label === 'Last event')?.value, '3s ago');
  golden('settings', model);
});

test('nested daemon health has readable labels, byte units and no object coercion', () => {
  const rows = daemonHealthRows({ eventLog: { lastSeq: 42, dbBytes: 1048576 }, memory: { rssBytes: 2097152 }, backfill: { complete: true }, unknownField: null });
  assert.deepEqual(rows.map(row => [row.label, row.value]), [
    ['Event log · Last sequence', '42'], ['Event log · Database size', '1.0 MB'],
    ['Memory · Resident memory', '2.0 MB'], ['Backfill · Complete', 'true'], ['Unknown Field', '–'],
  ]);
  assert.deepEqual(daemonHealthRows(null), []);
});

test('disconnected and stale states are flagged', () => {
  const model = settingsViewModel({ ...input, connected: false, error: 'Reconnecting…', lastEventAt: now - 120_000 });
  assert.equal(model.health.find(row => row.label === 'Stream')?.tone, 'bad');
  assert.equal(model.health.find(row => row.label === 'Last event')?.tone, 'bad');
});
