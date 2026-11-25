import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Marker } from '@pi-console/viewmodels';
import { indexMarkers, offsetTimelineMarkers } from './timeline-markers.ts';

const cells = (columns: number[]) => columns.map(column => ({ column, glyph: '◆', color: 'blue' as const, markerId: String(column) }));

test('nearby Timeline glyphs alternate vertically while isolated markers stay on the lane', () => {
  const source = cells([0, 1, 2, 5, 8, 9]);
  const placed = offsetTimelineMarkers(source, 8);
  assert.deepEqual(placed.map(cell => cell.offsetY), [-4, 4, -4, 0, -4, 4]);
  assert.deepEqual(placed.map(({ column, glyph, color, markerId }) => ({ column, glyph, color, markerId })), source);
  assert.ok(source.every(cell => !('offsetY' in cell)), 'the view model is not mutated');
});

test('markers at least 10px apart, single markers and empty lanes need no offset', () => {
  for (const width of [10, 12]) assert.deepEqual(offsetTimelineMarkers(cells([0, 1]), width).map(cell => cell.offsetY), [0, 0]);
  assert.deepEqual(offsetTimelineMarkers(cells([4]), 8).map(cell => cell.offsetY), [0]);
  assert.deepEqual(offsetTimelineMarkers([], 8), []);
});

const marker = (id: string, text = id): Marker => ({ id, text, sessionId: 's1', at: 0, glyph: '▲', kind: 'Request', color: 'blue', rank: 4 });

test('10,000 markers are indexed and resolved with linear source-ID reads', () => {
  let reads = 0;
  const source = Array.from({ length: 10_000 }, (_, index) => ({
    ...marker(String(index)), get id() { reads++; return String(index); },
  }));
  const indexed = indexMarkers(source);
  for (let index = 0; index < source.length; index++) assert.equal(indexed.get(String(index)), source[index]);
  assert.equal(indexed.get('9999'), source.at(-1));
  assert.equal(indexed.get('missing'), undefined);
  assert.ok(reads <= source.length * 2, `expected linear ID reads, got ${String(reads)}`);
});

test('index preserves first-match semantics, handles empty input and refreshes replacement values', () => {
  const first = marker('same', 'first');
  assert.equal(indexMarkers([first, marker('same', 'second')]).get('same'), first);
  assert.equal(indexMarkers([]).size, 0);
  const replacement = marker('same', 'updated');
  assert.equal(indexMarkers([replacement]).get('same'), replacement);
});
