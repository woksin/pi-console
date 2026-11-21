import { test } from 'node:test';
import assert from 'node:assert/strict';
import { laneLabel } from './lane-label.ts';

test('lane labels always qualify overlapping lane ids with their repository', () => {
  assert.equal(laneLabel('aurora', 'L0'), 'aurora/L0');
  assert.equal(laneLabel('borealis', 'L0'), 'borealis/L0');
  assert.notEqual(laneLabel('aurora', 'L0'), laneLabel('borealis', 'L0'));
});
