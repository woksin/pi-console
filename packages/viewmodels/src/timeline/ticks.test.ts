import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timelineTickStep, timelineTicks } from './ticks.ts';

test('tick steps use readable seconds and minutes at each zoom level', () => {
  assert.equal(timelineTickStep(60_000), 10_000);
  assert.equal(timelineTickStep(180_000), 30_000);
  assert.equal(timelineTickStep(360_000), 60_000);
  assert.equal(timelineTickStep(1_800_000), 300_000);
});

test('minute and longer steps omit seconds while sub-minute steps keep them', () => {
  const start = Date.parse('2026-01-01T12:00:17Z');
  for (const span of [420_000, 1_800_000, 21_600_000]) {
    const ticks = timelineTicks({ start, span }, 120);
    assert.ok(ticks.length > 0);
    assert.ok(ticks.every(tick => /^\d{2}:\d{2}$/.test(tick.label)));
    assert.ok(ticks.every(tick => tick.at % timelineTickStep(span) === 0));
  }
  assert.equal(timelineTicks({ start, span: 210_000 }, 120)[0].label, '12:00:30');
  assert.equal(timelineTicks({ start, span: 210_001 }, 120)[0].label, '12:01');
});

test('tick times are independent of width and include aligned window endpoints', () => {
  const window = { start: Date.parse('2026-01-01T12:00:00Z'), span: 420_000 };
  const ticks = timelineTicks(window, 80);
  assert.equal(ticks[0].at, window.start);
  assert.equal(ticks.at(-1)?.at, window.start + window.span);
  assert.equal(ticks[0].column, 0);
  assert.equal(ticks.at(-1)?.column, 79);
  assert.deepEqual(timelineTicks(window, 20).map(tick => tick.at), ticks.map(tick => tick.at));
});

test('ticks align to clock boundaries and stay inside the plot after panning', () => {
  const window = { start: Date.parse('2026-01-01T12:00:17Z'), span: 60_000 };
  const ticks = timelineTicks(window, 120);
  assert.equal(ticks[0].label, '12:00:20');
  assert.ok(ticks.every(tick => tick.at % 10_000 === 0 && tick.column >= 0 && tick.column < 120));
  assert.equal(ticks[1].at - ticks[0].at, 10_000);
});
