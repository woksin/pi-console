import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Marker } from '@pi-console/viewmodels';
import { axisCells, gridPart, inWindow, nearby } from './timeline-grid.ts';

const ticks = new Set([3]);
const cell = { column: 1, glyph: '●', color: 'green' } as never;
const marker = (id: string, sessionId: string, at: number) => ({ id, sessionId, at }) as unknown as Marker;

test('a lane cell keeps its glyph and colour and takes the scrub or selection background', () => {
  assert.deepEqual(gridPart(cell, 1, { scrub: undefined, ticks, selected: false }), { text: '●', color: 'green', bold: true, background: undefined });
  assert.equal((gridPart(cell, 1, { scrub: 1, ticks, selected: true }) as { background: string }).background, 'select');
  assert.equal((gridPart(cell, 1, { scrub: 0, ticks, selected: true }) as { background: string }).background, 'panel');
});

test('an empty column is the scrub line, an axis tick or the baseline', () => {
  assert.deepEqual(gridPart(undefined, 2, { scrub: 2, ticks, selected: false }), { text: '│', color: 'cyan', background: 'select', dim: false });
  assert.deepEqual(gridPart(undefined, 3, { scrub: 2, ticks, selected: true }), { text: '┊', color: 'border', background: 'panel', dim: true });
  assert.deepEqual(gridPart(undefined, 4, { scrub: undefined, ticks, selected: false }), { text: '─', color: 'border', background: undefined, dim: true });
});

test('nearby orders one session by distance and drops those out of span', () => {
  const all = [marker('a', 's', 10), marker('b', 's', 13), marker('c', 'other', 11), marker('d', 's', 100)];
  assert.deepEqual(nearby(all, 's', 12, 5).map(m => m.id), ['b', 'a']);
});

test('inWindow keeps the newest six of one session inside the window, newest first', () => {
  const all = Array.from({ length: 8 }, (_, index) => marker(`m${String(index)}`, 's', index)).concat(marker('x', 'o', 3), marker('late', 's', 50));
  assert.deepEqual(inWindow(all, 's', { start: 0, span: 10 }).map(m => m.id), ['m7', 'm6', 'm5', 'm4', 'm3', 'm2']);
});

test('axis labels stay whole: the last one is pulled in from the right edge and a label that would touch its neighbour is dropped', () => {
  const full = axisCells([{ column: 0, label: '09:00:00' }, { column: 19, label: '09:01:00' }], 20).join('');
  assert.equal(full, '09:00:00    09:01:00');
  const crowded = axisCells([{ column: 0, label: '09:00:00' }, { column: 9, label: '09:01:00' }], 10).join('');
  assert.equal(crowded, '09:00:00  ');
});
