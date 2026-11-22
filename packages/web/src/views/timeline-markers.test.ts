import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Marker } from '@pi-console/viewmodels';
import { indexMarkers } from './timeline-markers.ts';

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
