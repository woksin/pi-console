import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionStatuses, statusTaxonomy } from '@pi-console/contract';
import { glyphs, markerLegend, requestOriginGlyphs } from './glyphs.ts';

test('shared transcript and marker glyphs need no icon font and occupy one code point', () => {
  assert.deepEqual(glyphs, {
    user: '▍', assistant: '●', thinking: '◌', tool: '⚙', result: '↳', diff: '±', reset: '⟲',
    request: '◆', answer: '●', partial: '◐', question: '?', message: '›', interrupted: '/',
  });
  assert.ok(Object.values(glyphs).every(glyph => Array.from(glyph).length === 1));
  assert.equal(markerLegend.find(item => item.label === 'reset')?.glyph, glyphs.reset);
});

test('Requests origins and adjacent status glyphs cannot be confused without colour', () => {
  assert.deepEqual(requestOriginGlyphs, { human: '●', launch: '◆', unproven: '○' });
  const origins = Object.values(requestOriginGlyphs);
  assert.equal(new Set(origins).size, origins.length);
  const statuses = Object.values(statusTaxonomy).map(token => token.glyph);
  for (const origin of origins) assert.ok(!statuses.includes(origin), origin);
});

test('Timeline markers are distinct from one another and the session statuses on lanes', () => {
  const markers = markerLegend.map(item => item.glyph);
  assert.equal(new Set(markers).size, markers.length);
  const statuses = sessionStatuses.map(status => statusTaxonomy[status].glyph);
  for (const marker of markers) assert.ok(!statuses.includes(marker), marker);
  assert.equal(glyphs.interrupted, statusTaxonomy.interrupted.glyph);
});
