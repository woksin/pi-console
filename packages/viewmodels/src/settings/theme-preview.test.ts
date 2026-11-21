import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themePreview } from './theme-preview.ts';

test('the theme preview pairs every status colour with its glyph and word, so mono still reads', () => {
  const preview = themePreview();
  assert.deepEqual(preview.statuses.map(sample => sample.text), ['! Needs you', '* Working', '× Blocked', '~ Waiting', '✓ Done', '× Failed', '– Idle']);
  assert.deepEqual(preview.text.map(sample => sample.color), ['text', 'muted', 'faint']);
  assert.deepEqual(preview.ramp, [0, 20, 40, 60, 80, 100]);
});
