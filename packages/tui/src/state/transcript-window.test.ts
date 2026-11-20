import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pauseTranscript, resumeTranscript, scrollTranscript, transcriptWindow, type TranscriptLayout, type TranscriptView } from './transcript-window.ts';

/** Entries with the given wrapped heights and cursors `first`, `first + 1`, …. */
const layout = (heights: number[], first = 1): TranscriptLayout => {
  let end = 0;
  return { cursors: heights.map((_, index) => first + index), ends: heights.map(height => (end += height)) };
};
const uniform = (count: number, first = 1, height = 2) => layout(Array.from({ length: count }, () => height), first);
const HEIGHT = 6;
const shown = (l: TranscriptLayout, view: TranscriptView) => {
  const window = transcriptWindow(l, view, HEIGHT);
  return { cursors: l.cursors.filter((_, index) => (index === 0 ? 0 : l.ends[index - 1]) < window.end && l.ends[index] > window.start), window };
};

test('following shows the tail; pausing then appending leaves the view unchanged', () => {
  const before = uniform(10);
  const paused = pauseTranscript(before, resumeTranscript, HEIGHT);
  const first = shown(before, paused);
  for (const count of [11, 15, 40]) {
    const after = shown(uniform(count), paused);
    assert.deepEqual(after.cursors, first.cursors, `${String(count)} entries`);
    assert.equal(after.window.start, first.window.start);
    assert.equal(after.window.below, (count - 10) * 2);
    assert.equal(after.window.dropped, false);
  }
  assert.deepEqual(shown(before, resumeTranscript).cursors, [8, 9, 10]);
});

test('eviction past the cap: view unchanged while the anchor is retained, marker once it is evicted', () => {
  const paused = pauseTranscript(uniform(100), resumeTranscript, HEIGHT);
  const anchor = paused.anchor?.cursor ?? 0;
  const table: { first: number; count: number; dropped: boolean; top: number }[] = [
    { first: 1, count: 100, dropped: false, top: anchor },
    { first: anchor - 5, count: 100, dropped: false, top: anchor },
    { first: anchor, count: 100, dropped: false, top: anchor },
    { first: anchor + 1, count: 100, dropped: true, top: anchor + 1 },
    { first: anchor + 40, count: 100, dropped: true, top: anchor + 40 },
  ];
  for (const row of table) {
    const l = uniform(row.count, row.first);
    const { cursors, window } = shown(l, paused);
    assert.equal(window.dropped, row.dropped, JSON.stringify(row));
    assert.equal(cursors[0], row.top, JSON.stringify(row));
    if (row.dropped) assert.equal(window.start, 0);
  }
});

test('scroll bounds while paused with a growing live transcript: cannot reach unseen lines', () => {
  const paused = pauseTranscript(uniform(20), resumeTranscript, HEIGHT);
  const grown = uniform(50);
  const atBottom = scrollTranscript(grown, paused, HEIGHT, 1_000);
  assert.equal(atBottom.follow, false, 'new lines exist, so the view stays paused');
  const window = transcriptWindow(grown, atBottom, HEIGHT);
  assert.equal(window.end, 40, 'bottom is the last entry seen at pause');
  assert.equal(window.below, 60);
  assert.deepEqual(scrollTranscript(grown, atBottom, HEIGHT, 1), atBottom);
  assert.equal(transcriptWindow(grown, scrollTranscript(grown, paused, HEIGHT, 'top'), HEIGHT).start, 0);
  assert.equal(transcriptWindow(grown, scrollTranscript(grown, paused, HEIGHT, -1_000), HEIGHT).start, 0);
});

test('scroll table: up, down, page, top and bottom share one coordinate system', () => {
  const l = uniform(20);
  const tail = transcriptWindow(l, resumeTranscript, HEIGHT).start;
  const rows: [string, TranscriptView, number | 'top' | 'bottom', number | 'follow'][] = [
    ['up from tail', resumeTranscript, -1, tail - 1],
    ['page up from tail', resumeTranscript, -HEIGHT, tail - HEIGHT],
    ['down at tail', resumeTranscript, 1, 'follow'],
    ['top', resumeTranscript, 'top', 0],
    ['bottom', scrollTranscript(l, resumeTranscript, HEIGHT, 'top'), 'bottom', 'follow'],
    ['down back to live', scrollTranscript(l, resumeTranscript, HEIGHT, -1), 1, 'follow'],
  ];
  for (const [name, view, motion, expected] of rows) {
    const next = scrollTranscript(l, view, HEIGHT, motion);
    if (expected === 'follow') assert.deepEqual(next, resumeTranscript, name);
    else assert.equal(transcriptWindow(l, next, HEIGHT).start, expected, name);
  }
});

test('resuming follows the tail, including lines that arrived while paused', () => {
  const paused = pauseTranscript(uniform(10), resumeTranscript, HEIGHT);
  const grown = uniform(30);
  assert.equal(transcriptWindow(grown, paused, HEIGHT).paused, true);
  const resumed = transcriptWindow(grown, resumeTranscript, HEIGHT);
  assert.equal(resumed.end, 60);
  assert.equal(resumed.paused, false);
});

test('rewrapping keeps the anchor entry at the top of the view', () => {
  const narrow = uniform(30, 1, 3);
  const paused = scrollTranscript(narrow, resumeTranscript, HEIGHT, -30);
  const anchorCursor = paused.anchor?.cursor ?? 0;
  for (const heights of [1, 5, 2].map(height => Array.from({ length: 30 }, () => height))) {
    const l = layout(heights);
    const window = transcriptWindow(l, paused, HEIGHT);
    assert.equal(shown(l, paused).cursors[0], anchorCursor, heights.join());
    assert.ok(window.start <= l.ends[anchorCursor - 1] - 1, 'anchor entry starts at or below the top');
  }
});

test('an empty transcript has nothing to pause', () => {
  assert.deepEqual(pauseTranscript(layout([]), resumeTranscript, HEIGHT), { follow: false, anchor: null });
  assert.equal(transcriptWindow(layout([]), { follow: false, anchor: null }, HEIGHT).paused, true);
  assert.deepEqual(transcriptWindow(layout([]), resumeTranscript, HEIGHT), { start: 0, end: 0, below: 0, paused: false, dropped: false });
});
