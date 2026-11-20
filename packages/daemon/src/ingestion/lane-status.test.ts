import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneStatusJson } from './lane-status.ts';

test('the lane comes from the file name and the line is the first line, trimmed and bounded', () => {
  assert.deepEqual(JSON.parse(laneStatusJson(Buffer.from('  working since 2026-11-20T09:00:00Z \nsecond\n'), '/x/L0.status')), { lane: 'L0', line: 'working since 2026-11-20T09:00:00Z' });
  const long = JSON.parse(laneStatusJson(Buffer.from('x'.repeat(5000)), '/x/L1.status')) as { line: string };
  assert.equal(long.line.length, 1024);
});
