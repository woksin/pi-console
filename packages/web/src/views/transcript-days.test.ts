import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptLine } from '@pi-console/viewmodels';
import { dayGroups } from './transcript-days.ts';

const line = (key: number, at: string): TranscriptLine => ({ id: `e${String(key)}`, key, cursor: key, at, time: '' }) as unknown as TranscriptLine;
const keys = (groups: ReturnType<typeof dayGroups>) => groups.map(group => [group.date, group.lines.map(item => item.key)]);

test('lines are grouped by local calendar day, starting with the first displayed line', () => {
  assert.deepEqual(keys(dayGroups([line(1, '2026-11-19T23:59:59Z'), line(2, '2026-11-20T00:00:00Z'), line(3, '2026-11-20T10:00:00Z')])), [['19 Nov 2026', [1]], ['20 Nov 2026', [2, 3]]]);
  assert.deepEqual(keys(dayGroups([line(7, '2026-11-20T10:00:00Z'), line(8, '2026-11-20T10:00:01Z')])), [['20 Nov 2026', [7, 8]]]);
  assert.deepEqual(dayGroups([]), []);
});

test('a day that reappears out of order gets its own group key; an unreadable time has no heading', () => {
  const groups = dayGroups([line(1, '2026-11-20T10:00:00Z'), line(2, '2026-11-21T10:00:00Z'), line(3, '2026-11-20T11:00:00Z'), line(4, 'nope')]);
  assert.deepEqual(groups.map(group => group.key), ['2026-11-20#0', '2026-11-21#0', '2026-11-20#1', '#0']);
  assert.equal(groups[3].date, '');
});
