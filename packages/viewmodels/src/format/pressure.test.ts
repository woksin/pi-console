import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeTokens, dawnOverrides } from '@pi-console/contract';
import { pressureColor, pressureGradient } from './pressure.ts';

test('OKLCH ramp has exact calm, soft and handoff anchors and clamps', () => {
  for (const colors of [themeTokens, { ...themeTokens, ...dawnOverrides }]) {
    assert.equal(pressureColor(-10, colors), colors.green);
    assert.equal(pressureColor(0, colors), colors.green);
    assert.equal(pressureColor(60, colors), colors.amber);
    assert.equal(pressureColor(80, colors), colors.red);
    assert.equal(pressureColor(120, colors), colors.red);
    assert.notEqual(pressureColor(51, colors), colors.green);
    assert.notEqual(pressureColor(51, colors), colors.amber);
    assert.ok(pressureGradient(colors).includes(`${pressureColor(51, colors)} 51%`));
  }
});

test('ramp is continuous across the thresholds', () => {
  const channels = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  for (const anchor of [60, 80]) {
    const a = channels(pressureColor(anchor - 0.001));
    const b = channels(pressureColor(anchor + 0.001));
    assert.ok(a.every((channel, index) => Math.abs(channel - b[index]) <= 1));
  }
});
