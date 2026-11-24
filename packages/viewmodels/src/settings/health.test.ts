import assert from 'node:assert/strict';
import { test } from 'node:test';
import { daemonHealthRows, formatBytes, healthGroups, healthSourceRows, healthTimestamp, settingsViewModel, type SettingsRow } from './settings.ts';
import { timeDisplay } from '../format/time.ts';
import { golden, now } from '../test-support.ts';

const available: SettingsRow = { label: 'session-jsonl', value: 'available', tone: 'good' };
const notReported: SettingsRow = { label: 'Source adapters', value: 'availability not reported', tone: 'plain' };
const polled = '2026-11-20T11:59:57Z';
const health = {
  startedAt: polled, eventLog: { lastSeq: 1200, dbBytes: 4194304 }, stream: { seq: 1200, clients: 2, retained: 512 },
  projection: { position: 1198, queueDepth: 0 }, eventLoop: { p50: 6.283263, p99: 10, max: 12.78 },
  backfill: { complete: true }, sources: [{ source: 'session-jsonl', files: 12, lagBytes: 2048, lastPollAt: polled, errors: 0 }],
};

test('binary byte units stay short, including zero and negative sizes', () => {
  assert.deepEqual([0, 1023, 1536, 4194304, -1536].map(formatBytes), ['0 B', '1023 B', '1.5 KB', '4.0 MB', '-1.5 KB']);
});

test('timestamps combine relative age with the viewer-local date, time and zone', () => {
  assert.equal(healthTimestamp(polled, now), `3s ago · ${timeDisplay(polled).absolute}`);
  assert.equal(healthTimestamp('not a timestamp', now), null);
  assert.equal(healthTimestamp('2026-99-99T00:00:00Z', now), null);
});

test('shared groups retain source facts and distinct daemon checkpoints without repeating visible groups', () => {
  const groups = healthGroups(health, [available], now);
  assert.deepEqual(groups.map(group => group.title), ['Sources', 'Event log', 'Stream', 'Details']);
  assert.deepEqual(groups[0].rows, [{ ...available, value: 'available · 12 files · 2.0 KB behind', valueDetail: `polled ${healthTimestamp(polled, now)}` }]);
  assert.deepEqual(groups[1].rows.map(row => [row.label, row.value]), [['Database size', '4.0 MB']]);
  assert.deepEqual(groups[2].rows.map(row => [row.label, row.value]), [['Connected clients', '2'], ['Retained events', '512']]);
  assert.ok(!groups.flatMap(group => group.rows).some(row => /sequence/i.test(row.label)));
  assert.deepEqual(groups[3].rows.slice(0, 2), [
    { label: 'Daemon head', value: '1,200', tone: 'plain' },
    { label: 'Projection position', value: '1,198', tone: 'plain' },
  ]);
  assert.ok(!groups.slice(0, 3).flatMap(group => group.rows).some(row => /Daemon head|Projection position/.test(row.label)));
  golden('settings', groups, 'health.golden.json');
  const diagnostics = healthGroups({ sources: [{ source: 'adapter', vendorMs: 3.14 }], constructor: 'safe' }, [], now);
  assert.deepEqual(diagnostics[0].rows.map(row => [row.label, row.value]), [['Constructor', 'safe'], ['Sources · adapter · Vendor Ms', '3.1 ms']]);
});

test('scalar health formats durations, sizes, booleans and non-finite numbers', () => {
  const rows = daemonHealthRows({ eventLoop: { p50: 6.283263, p99: 10 }, lagBytes: 1536, workMs: 2.34, backfill: { complete: false }, enabled: true, paused: false, bad: NaN }, '', now);
  assert.deepEqual(rows.map(row => row.value), ['6.3 ms', '10 ms', '1.5 KB', '2.3 ms', 'In progress', 'Yes', 'No', '–']);
});

test('missing or malformed reports remain truthful and malformed numbers show a dash', () => {
  assert.deepEqual(healthGroups(undefined, [notReported], now), [{ title: 'Sources', rows: [notReported] }]);
  assert.deepEqual(healthGroups({ sources: 'nope', stream: 5 }, [notReported], now).map(group => group.title), ['Sources', 'Details']);
  const groups = healthGroups({ eventLog: { dbBytes: 'x' } }, [notReported], now);
  assert.deepEqual(groups[1].rows.map(row => row.value), ['–']);
});

test('missing daemon checkpoints are not invented, and malformed checkpoint counts show a dash', () => {
  assert.deepEqual(healthGroups({ eventLog: { dbBytes: 0 }, stream: { seq: 12 } }, [], now).map(group => group.title), ['Event log', 'Stream']);
  const details = healthGroups({ eventLog: { lastSeq: 'unknown' }, projection: { position: NaN } }, [], now).find(group => group.title === 'Details');
  assert.deepEqual(details?.rows.map(row => [row.label, row.value]), [['Daemon head', '–'], ['Projection position', '–']]);
});

test('source facts pluralise, warn on errors and match named sources by daemon id', () => {
  const named: SettingsRow = { ...available, label: 'Session transcripts', detail: 'session-jsonl' };
  const rows = healthSourceRows({ sources: [{ source: 'session-jsonl', files: 1, lagBytes: 0, errors: 1 }, { source: 'bad', errors: 2 }, { source: 5 }] }, [named, { label: 'other', value: 'available', tone: 'good' }, { label: 'bad', value: 'unknown', tone: 'plain' }], now);
  assert.deepEqual(rows[0], { ...named, value: 'available · 1 file · no lag · 1 error' });
  assert.equal(rows[1].value, 'available');
  assert.deepEqual([rows[2].value, rows[2].tone], ['unknown · 2 errors', 'warn']);
});

test('untrusted health labels, values, source ids and invalid poll times stay sanitized', () => {
  const esc = String.fromCharCode(27);
  const payload = { [`${esc}[31mcustom`]: `${esc}]0;title\u0007value`, sources: [{ source: `${esc}[31munknown`, availability: 'available', lastPollAt: `${esc}[31mbad\nclock` }] };
  const sources = settingsViewModel({ endpoint: '', connected: true, error: '', tokenSource: '', lastSeq: undefined, lastEventAt: undefined, eventsReceived: 0, now, counts: {}, daemonHealth: payload }).sources;
  const rows = healthGroups(payload, sources, now).flatMap(group => group.rows);
  const text = JSON.stringify(rows);
  assert.ok(!text.includes('\\u001b'));
  assert.ok(!text.includes('\\u0007'));
  assert.ok(rows.some(row => row.label === 'unknown' && row.valueDetail === 'polled bad clock'));
});
