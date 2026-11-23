import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeometry, indexAt, planSegments, revealOffset, visibleRange, clampRange, resolvePinned } from './virtual-geometry.ts';

const uniform = (count: number, height = 40) => createGeometry(new Uint8Array(count), [height]);
const mounted = (segments: ReturnType<typeof planSegments>) => segments.filter(segment => segment.kind === 'row').length;
const spacerHeight = (segments: ReturnType<typeof planSegments>) => segments.reduce((sum, segment) => sum + (segment.kind === 'spacer' ? segment.height : 0), 0);

test('empty and tiny lists mount nothing or everything without spacers', () => {
  assert.deepEqual(visibleRange(uniform(0), 0, 600, 5), { start: 0, end: 0 });
  assert.deepEqual(planSegments(uniform(0), { start: 0, end: 0 }, null), []);
  const tiny = uniform(3);
  const range = visibleRange(tiny, 0, 600, 5);
  assert.deepEqual(range, { start: 0, end: 3 });
  assert.deepEqual(planSegments(tiny, range, null).map(segment => segment.kind), ['row', 'row', 'row']);
});

test('30k rows mount one viewport plus overscan and the spacers preserve the total height', () => {
  const geometry = uniform(30_000);
  assert.equal(geometry.total, 1_200_000);
  for (const top of [0, 12_345, 600_000, 1_199_400]) {
    const range = visibleRange(geometry, top, top + 600, 5);
    const segments = planSegments(geometry, range, null);
    assert.ok(mounted(segments) <= 15 + 10 + 1, `mounted ${String(mounted(segments))} at ${String(top)}`);
    assert.equal(spacerHeight(segments) + mounted(segments) * 40, geometry.total);
  }
  assert.equal(visibleRange(geometry, 1_199_400, 1_200_000, 0).end, 30_000, 'the final row is reachable');
});

test('mixed row kinds produce exact offsets and lookups', () => {
  const geometry = createGeometry([0, 1, 1, 0, 1], [30, 50]);
  assert.deepEqual([...geometry.offsets], [0, 30, 80, 130, 160, 210]);
  assert.equal(indexAt(geometry, 0), 0);
  assert.equal(indexAt(geometry, 79), 1);
  assert.equal(indexAt(geometry, 80), 2);
  assert.equal(indexAt(geometry, 10_000), 4, 'past the end clamps to the last row');
});

test('resizing the viewport or shortening the list clamps the range', () => {
  const geometry = uniform(100);
  const tall = visibleRange(geometry, 0, 2000, 5);
  const short = visibleRange(geometry, 0, 200, 5);
  assert.ok(tall.end - tall.start > short.end - short.start);
  assert.deepEqual(clampRange({ start: 90, end: 100 }, 20), { start: 20, end: 20 });
  assert.deepEqual(clampRange({ start: 10, end: 30 }, 20), { start: 10, end: 20 });
  assert.deepEqual(visibleRange(uniform(8), 4000, 4600, 5), { start: 2, end: 8 }, 'a stale scroll beyond a shortened list still ends on the last rows');
});

test('a pinned focused row far outside the range stays mounted with correct spacers', () => {
  const geometry = uniform(1000);
  const range = { start: 500, end: 520 };
  for (const pinned of [3, 900, 499, 520]) {
    const segments = planSegments(geometry, range, pinned);
    assert.equal(mounted(segments), 21);
    assert.equal(spacerHeight(segments) + 21 * 40, geometry.total);
    const rows = segments.filter(segment => segment.kind === 'row').map(segment => segment.index);
    assert.deepEqual(rows, [...rows].sort((a, b) => a - b), 'document order follows logical order');
    assert.ok(rows.includes(pinned));
  }
  assert.equal(mounted(planSegments(geometry, range, 510)), 20, 'a pinned row inside the range adds nothing');
});

test('revealing a row far outside the slice moves the least distance and respects the sticky header', () => {
  const geometry = uniform(30_000);
  assert.equal(revealOffset(geometry, 29_999, { scroll: 0, viewport: 600, inset: 28 }), 1_200_000 - 600);
  assert.equal(revealOffset(geometry, 0, { scroll: 5000, viewport: 600, inset: 28 }), -28);
  assert.equal(revealOffset(geometry, 10, { scroll: 0, viewport: 600, inset: 28 }), 0, 'already visible rows do not scroll');
  assert.equal(revealOffset(geometry, 1, { scroll: 40, viewport: 600, inset: 28 }), 12, 'a row under the sticky header is brought below it');
});

test('a pinned row is followed by key when rows are inserted above it and dropped when its key disappears', () => {
  const before = new Map(['a', 'b', 'c', 'd'].map((key, index) => [key, index]));
  assert.equal(resolvePinned(before, 'd'), 3);
  const after = new Map(['new', 'a', 'b', 'c', 'd'].map((key, index) => [key, index]));
  assert.equal(resolvePinned(after, 'd'), 4, 'the same row, not the neighbour now at the old index');
  assert.equal(resolvePinned(new Map([['a', 0]]), 'd'), null, 'a removed row is no longer pinned');
  assert.equal(resolvePinned(after, null), null);
  const geometry = uniform(5);
  assert.equal(mounted(planSegments(geometry, { start: 0, end: 2 }, resolvePinned(after, 'd'))), 3);
});
