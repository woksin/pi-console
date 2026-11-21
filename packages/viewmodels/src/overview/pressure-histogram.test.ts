import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pressureHistogram } from './pressure-histogram.ts';
import { fixture } from '../test-support.ts';

const at = (...values: number[]) => values.map(contextPercent => ({ contextPercent }));

test('ten bins over 0–100 %, 100 % in the last bin, bands change on the 60 and 80 ticks', () => {
  const histogram = pressureHistogram(at(0, 9, 10, 59, 60, 79, 80, 100, 100));
  assert.deepEqual(histogram.bins.map(bin => bin.count), [2, 1, 0, 0, 0, 1, 1, 1, 1, 2]);
  assert.deepEqual(histogram.bins.map(bin => bin.band), ['calm', 'calm', 'calm', 'calm', 'calm', 'calm', 'warm', 'warm', 'hot', 'hot']);
  assert.deepEqual(histogram.ticks, [60, 80]);
  assert.equal(histogram.peak, 2);
  assert.equal(histogram.bins[6].label, '60–70%');
});

test('warm and hot counts use the same bands as every pressure bar', () => {
  const histogram = pressureHistogram(at(60, 61, 80, 81, 95, Number.NaN));
  assert.deepEqual([histogram.warm, histogram.hot], [2, 2]);
  assert.equal(histogram.summary, '6 sessions: 2 above 80 %, 2 between 60 and 80 %');
  assert.equal(pressureHistogram([]).peak, 1);
  assert.equal(pressureHistogram(fixture.sessions).bins.reduce((sum, bin) => sum + bin.count, 0), fixture.sessions.length);
});
