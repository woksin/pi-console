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
    ['Memory · Resident memory', '2.0 MB'], ['Backfill · Complete', 'Complete'], ['Unknown Field', '–'],
  ]);
  assert.deepEqual(daemonHealthRows(null), []);
});

test('disconnected and stale states are flagged', () => {
  const model = settingsViewModel({ ...input, connected: false, error: 'Reconnecting…', lastEventAt: now - 120_000 });
  assert.equal(model.health.find(row => row.label === 'Stream')?.tone, 'bad');
  assert.equal(model.health.find(row => row.label === 'Last event')?.tone, 'bad');
});

const reported = { agentRootAvailability: 'missing', sources: [{ source: 'issue-work', files: 0, errors: 0, availability: 'missing' }, { source: 'context-budget', availability: 'available' }, { source: 'phase-ledger', availability: 'unavailable' }, { source: 'lane-messages' }] };

test('source rows show each reported availability with a warning tone for missing and unavailable directories', () => {
  const rows = settingsViewModel({ ...input, daemonHealth: reported }).sources;
  assert.deepEqual(rows.map(row => [row.label, row.value, row.tone]), [
    ['Agent directory', 'missing directory — check startup paths', 'warn'], ['Issue register', 'missing directory — check startup paths', 'warn'],
    ['Context budget', 'available', 'good'], ['Phase ledger', 'directory unavailable — check startup paths', 'warn'], ['Lane messages', 'availability not reported', 'plain'],
  ]);
  const recovered = settingsViewModel({ ...input, daemonHealth: { agentRootAvailability: 'available', sources: [{ source: 'issue-work', availability: 'available' }] } }).sources;
  assert.deepEqual(recovered.map(row => row.tone), ['good', 'good']);
});

test('source rows name sources for people, keep the id as detail and fall back to an unknown id', () => {
  const rows = settingsViewModel({ ...input, daemonHealth: { sources: [{ source: 'session-jsonl' }, { source: 'issue-work' }, { source: 'lane-messages' }, { source: 'future-source' }] } }).sources;
  assert.deepEqual(rows.slice(1).map(row => [row.label, row.detail]), [['Session transcripts', 'session-jsonl'], ['Issue register', 'issue-work'], ['Lane messages', 'lane-messages'], ['future-source', undefined]]);
});

test('a legacy or malformed health payload reports availability as not reported instead of inventing it', () => {
  for (const daemonHealth of [undefined, null, 'x', [], { sources: [] }, { sources: 'nope', agentRootAvailability: undefined }, { sources: [null, 4] }]) {
    assert.deepEqual(settingsViewModel({ ...input, daemonHealth }).sources, [{ label: 'Source adapters', value: 'availability not reported', tone: 'plain' }]);
  }
  assert.equal(settingsViewModel({ ...input, daemonHealth: { agentRootAvailability: 'bogus', sources: [] } }).sources[0].value, 'availability not reported');
});

test('daemon health rows warn on missing or unavailable availability fields only', () => {
  const rows = daemonHealthRows(reported);
  const tones = Object.fromEntries(rows.map(row => [row.label + '=' + row.value, row.tone]));
  assert.equal(tones['Agent Root Availability=missing'], 'warn');
  assert.equal(tones['Sources · 0 · Availability=missing'], 'warn');
  assert.equal(tones['Sources · 1 · Availability=available'], 'plain');
  assert.equal(tones['Sources · 2 · Availability=unavailable'], 'warn');
});
