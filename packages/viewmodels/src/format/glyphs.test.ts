import { test } from 'node:test';
import assert from 'node:assert/strict';
import { glyphs, markerLegend } from './glyphs.ts';

test('shared transcript and marker glyphs need no icon font and occupy one code point', () => {
  assert.deepEqual(glyphs, {
    user: '▍', assistant: '●', thinking: '◌', tool: '⚙', result: '↳', diff: '±', reset: '⟲',
    request: '◆', answer: '●', partial: '◐', question: '?', message: '›', interrupted: '╳',
  });
  assert.ok(Object.values(glyphs).every(glyph => Array.from(glyph).length === 1));
  assert.equal(markerLegend.find(item => item.label === 'reset')?.glyph, glyphs.reset);
});
