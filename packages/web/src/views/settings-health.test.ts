import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SettingsRow } from '@pi-console/viewmodels';
import { formatBytes, healthGroups, healthSourceRows } from './settings-health.ts';

const available: SettingsRow = { label: 'session-jsonl', value: 'available', tone: 'good' };
const notReported: SettingsRow = { label: 'Source adapters', value: 'availability not reported', tone: 'plain' };
const health = {
  eventLog: { lastSeq: 1200, dbBytes: 4194304 }, stream: { seq: 1200, clients: 2, retained: 512 },
  sources: [{ source: 'session-jsonl', files: 12, lagBytes: 2048, lastPollAt: '2026-05-26T16:24:42Z', errors: 0 }],
};

test('byte sizes use the shortest binary unit', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(4194304), '4.0 MB');
  assert.equal(formatBytes(1536), '1.5 KB');
});

test('health becomes named Sources, Event log and Stream groups in plain units', () => {
  const groups = healthGroups(health, [available]);
  assert.deepEqual(groups.map(group => group.title), ['Sources', 'Event log', 'Stream']);
  assert.deepEqual(groups[0].rows, [{ label: 'session-jsonl', value: 'available · 12 files · 2.0 KB behind · polled 2026-05-26 16:24:42 UTC', tone: 'good' }]);
  assert.deepEqual(groups[1].rows.map(row => [row.label, row.value]), [['Last sequence', '1,200'], ['Database size', '4.0 MB']]);
  assert.deepEqual(groups[2].rows.map(row => [row.label, row.value]), [['Sequence', '1,200'], ['Connected clients', '2'], ['Retained events', '512']]);
});

test('a source with errors is flagged and an unreported one keeps its truthful text', () => {
  const [sources] = healthGroups({ sources: [{ source: 'session-jsonl', errors: 3 }] }, [{ ...available, value: 'unknown', tone: 'plain' }]);
  assert.deepEqual([sources.rows[0].value, sources.rows[0].tone], ['unknown · 3 errors', 'warn']);
  assert.deepEqual(healthGroups(undefined, [notReported]), [{ title: 'Sources', rows: [notReported] }]);
});

test('missing or malformed groups are omitted and malformed numbers show a dash', () => {
  assert.deepEqual(healthGroups({ sources: 'nope', stream: 5 }, [notReported]).map(group => group.title), ['Sources']);
  const groups = healthGroups({ eventLog: { lastSeq: 'x' } }, [notReported]);
  assert.deepEqual(groups[1].rows.map(row => row.value), ['–', '–']);
});

test('source facts pluralise, tone follows errors and unlisted sources get no facts', () => {
  const rows: SettingsRow[] = [available, { label: 'other', value: 'available', tone: 'good' }, { label: 'bad', value: 'unknown', tone: 'plain' }];
  const reported = { sources: [{ source: 'session-jsonl', files: 1, lagBytes: 0, errors: 1 }, { source: 'bad', errors: 2 }, { source: 5 }] };
  const [first, other, bad] = healthSourceRows(reported, rows);
  assert.equal(first.value, 'available · 1 file · no lag · 1 error');
  assert.equal(first.tone, 'good');
  assert.deepEqual(other, rows[1]);
  assert.deepEqual([bad.value, bad.tone], ['unknown · 2 errors', 'warn']);
});

test('named source rows still pick up the facts reported under their daemon id', () => {
  const named: SettingsRow = { label: 'Session transcripts', detail: 'session-jsonl', value: 'available', tone: 'good' };
  const [row] = healthSourceRows(health, [named]);
  assert.equal(row.label, 'Session transcripts');
  assert.match(row.value, /^available · 12 files/);
});
