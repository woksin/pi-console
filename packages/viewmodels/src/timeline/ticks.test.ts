import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineTickStep, timelineTicks } from './ticks.ts';

test('tick steps use readable seconds and minutes at each zoom level', () => {
  assert.equal(timelineTickStep(60_000), 10_000);
  assert.equal(timelineTickStep(180_000), 30_000);
  assert.equal(timelineTickStep(360_000), 60_000);
  assert.equal(timelineTickStep(1_800_000), 300_000);
});

test('ticks align to clock boundaries and stay inside the plot after panning', () => {
  const window = { start: Date.parse('2026-01-01T12:00:17Z'), span: 60_000 };
  const ticks = timelineTicks(window, 120);
  assert.equal(ticks[0].label, '12:00:20');
  assert.ok(ticks.every(tick => tick.at % 10_000 === 0 && tick.column >= 0 && tick.column < 120));
  assert.equal(ticks[1].at - ticks[0].at, 10_000);
});
