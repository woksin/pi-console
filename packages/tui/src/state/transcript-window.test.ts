import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptEntry } from '@pi-console/contract';
import { transcriptLines } from '@pi-console/viewmodels';
import { pauseTranscript, resumeTranscript, scrollTranscript, topEntryKey, transcriptWindow, type TranscriptLayout, type TranscriptView } from './transcript-window.ts';

/** Entries with the given wrapped heights and keys `first`, `first + 1`, …. */
const layout = (heights: number[], first = 1): TranscriptLayout => {
  let end = 0;
  return { keys: heights.map((_, index) => first + index), ends: heights.map(height => (end += height)) };
};
const uniform = (count: number, first = 1, height = 2) => layout(Array.from({ length: count }, () => height), first);
const HEIGHT = 6;
const shown = (l: TranscriptLayout, view: TranscriptView) => {
  const window = transcriptWindow(l, view, HEIGHT);
  return { keys: l.keys.filter((_, index) => (index === 0 ? 0 : l.ends[index - 1]) < window.end && l.ends[index] > window.start), window };
};

test('following shows the tail; pausing then appending leaves the view unchanged', () => {
  const before = uniform(10);
  const paused = pauseTranscript(before, resumeTranscript, HEIGHT);
  const first = shown(before, paused);
  for (const count of [11, 15, 40]) {
    const after = shown(uniform(count), paused);
    assert.deepEqual(after.keys, first.keys, `${String(count)} entries`);
    assert.equal(after.window.start, first.window.start);
    assert.equal(after.window.below, (count - 10) * 2);
    assert.equal(after.window.dropped, false);
  }
  assert.deepEqual(shown(before, resumeTranscript).keys, [8, 9, 10]);
});

test('eviction past the cap: view unchanged while the anchor is retained, marker once it is evicted', () => {
  const paused = pauseTranscript(uniform(100), resumeTranscript, HEIGHT);
  const anchor = paused.anchor?.key ?? 0;
  const table: { first: number; count: number; dropped: boolean; top: number }[] = [
    { first: 1, count: 100, dropped: false, top: anchor },
    { first: anchor - 5, count: 100, dropped: false, top: anchor },
    { first: anchor, count: 100, dropped: false, top: anchor },
    { first: anchor + 1, count: 100, dropped: true, top: anchor + 1 },
    { first: anchor + 40, count: 100, dropped: true, top: anchor + 40 },
  ];
  for (const row of table) {
    const l = uniform(row.count, row.first);
    const { keys, window } = shown(l, paused);
    assert.equal(window.dropped, row.dropped, JSON.stringify(row));
    assert.equal(keys[0], row.top, JSON.stringify(row));
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
  const anchorKey = paused.anchor?.key ?? 0;
  for (const heights of [1, 5, 2].map(height => Array.from({ length: 30 }, () => height))) {
    const l = layout(heights);
    const window = transcriptWindow(l, paused, HEIGHT);
    assert.equal(shown(l, paused).keys[0], anchorKey, heights.join());
    assert.ok(window.start <= l.ends[anchorKey - 1] - 1, 'anchor entry starts at or below the top');
  }
});

test('an empty transcript has nothing to pause', () => {
  assert.deepEqual(pauseTranscript(layout([]), resumeTranscript, HEIGHT), { follow: false, anchor: null });
  assert.equal(transcriptWindow(layout([]), { follow: false, anchor: null }, HEIGHT).paused, true);
  assert.deepEqual(transcriptWindow(layout([]), resumeTranscript, HEIGHT), { start: 0, end: 0, below: 0, paused: false, dropped: false });
});

const meta = { sessionId: 's', at: '2026-01-01T00:00:00Z', toolCallId: null, resetId: null, toolResult: null, requestId: 'r1' } as const;
const entry = (cursor: number, kind: TranscriptEntry['kind']): TranscriptEntry => ({ ...meta, id: `e${String(cursor)}`, cursor, kind, text: 'x' });
/** Layout built from real transcript entries through transcriptLines(): nine user lines, a streaming run (or its final entry) of `deltas` deltas, then `newer` user lines. The run line has `runHeight`, all others 2. */
const keyed = (runHeight: number, { deltas = 1, final = false, newer = 0 } = {}): TranscriptLayout => {
  const entries = Array.from({ length: 9 }, (_, i) => entry(i + 1, 'user'));
  for (let i = 0; i < deltas; i++) entries.push(entry(RUN + i, 'assistant.delta'));
  if (final) entries.push(entry(RUN + deltas, 'assistant'));
  for (let i = 0; i < newer; i++) entries.push(entry(RUN + deltas + 1 + i, 'user'));
  let end = 0;
  const lines = transcriptLines(entries);
  return { keys: lines.map(line => line.key), ends: lines.map(line => (end += line.kind === 'assistant' ? runHeight : 2)) };
};
const lineKeys = (l: TranscriptLayout, view: TranscriptView) => {
  const window = transcriptWindow(l, view, HEIGHT);
  return { window, keys: l.keys.filter((_, index) => (index === 0 ? 0 : l.ends[index - 1]) < window.end && l.ends[index] > window.start) };
};
const RUN = 10;

test('pausing during a streaming run: more deltas arriving leave the view unchanged', () => {
  const paused = scrollTranscript(keyed(2), resumeTranscript, HEIGHT, -1);
  const before = lineKeys(keyed(2), paused);
  assert.ok(before.keys.includes(RUN));
  for (const [deltas, runHeight] of [[2, 3], [4, 5], [7, 8]]) {
    const after = lineKeys(keyed(runHeight, { deltas }), paused);
    assert.equal(after.window.start, before.window.start, `run height ${String(runHeight)}`);
    assert.equal(after.window.dropped, false);
  }
});

test('the final assistant entry replacing a run (same key, new height) leaves the view unchanged', () => {
  const paused = scrollTranscript(keyed(4, { deltas: 3 }), resumeTranscript, HEIGHT, -9);
  const before = lineKeys(keyed(4, { deltas: 3 }), paused);
  const final = lineKeys(keyed(6, { deltas: 3, final: true, newer: 1 }), paused);
  assert.equal(final.window.start, before.window.start);
  assert.deepEqual(final.keys.slice(0, 2), before.keys.slice(0, 2));
});

test('an anchor on a run line survives eviction of older entries', () => {
  const full = keyed(4, { deltas: 2, newer: 3 });
  const pinned = scrollTranscript(full, resumeTranscript, HEIGHT, -4);
  assert.equal(pinned.anchor?.key, RUN, 'the view tops at the run line');
  const before = lineKeys(full, pinned);
  assert.equal(before.keys[0], RUN);
  for (const evicted of [3, 6, 9]) {
    const l: TranscriptLayout = { keys: full.keys.slice(evicted), ends: full.ends.slice(evicted).map(end => end - full.ends[evicted - 1]) };
    const after = lineKeys(l, pinned);
    assert.equal(after.keys[0], RUN, `evicted ${String(evicted)}`);
    assert.equal(after.window.dropped, false);
  }
});

const withSpacers = (heights: number[], spacers: boolean[]): TranscriptLayout => ({ ...layout(heights), spacers });
const topAt = (l: TranscriptLayout, key: number, offset: number) => topEntryKey(l, { follow: false, anchor: { key, offset, limit: l.keys.length } }, 2);

test('topEntryKey hands only a real blank spacer row to the entry below', () => {
  const l = withSpacers([3, 3, 3], [true, false, false]);
  assert.equal(topAt(l, 1, 0), 1);
  assert.equal(topAt(l, 1, 1), 1);
  assert.equal(topAt(l, 1, 2), 2);
  assert.equal(topAt(l, 2, 0), 2);
  assert.equal(topAt(l, 3, 0), 3);
});

test('topEntryKey keeps the last content row of a result or diff with its own entry', () => {
  const l = withSpacers([4, 4, 2], [false, false, true]);
  assert.equal(topAt(l, 1, 3), 1, 'last row of a 4-row result (its note row)');
  assert.equal(topAt(l, 2, 3), 2, 'last row of a diff');
  assert.equal(topAt(layout([3, 3]), 1, 2), 1, 'a layout without spacer information has none');
  assert.equal(topAt(l, 3, 1), 3, 'the spacer of the last entry stays with it');
});

test('topEntryKey of an empty or following transcript', () => {
  assert.equal(topEntryKey(layout([]), resumeTranscript, HEIGHT), undefined);
  assert.equal(topEntryKey(layout([3, 3, 3]), resumeTranscript, 20), 1);
});

/** Like `layout`, with a date rule above the entries listed in `ruled` (counted in their heights). */
const ruled = (heights: number[], ruledIndexes: number[], first = 1): TranscriptLayout => ({ ...layout(heights, first), leads: heights.map((_, index) => (ruledIndexes.includes(index) ? 1 : 0)) });

test('a same-day prepend removes the old first rule without moving a paused body line', () => {
  const before = ruled([3, 3, 3], [0], 10);
  const view: TranscriptView = { follow: false, anchor: { key: 10, offset: 1, limit: 12 } };
  assert.equal(transcriptWindow(before, view, 2).start, 2, 'rule row, then content offset 1');
  const after = ruled([3, 3, 3, 3, 3], [0], 8);
  const moved: TranscriptView = { follow: false, anchor: { key: 10, offset: 1, limit: 12 } };
  assert.equal(transcriptWindow(after, moved, 2).start, 7, 'entry 10 starts at row 6 and no longer has a rule: still its content offset 1');
});

test('a cross-day prepend gives the old first entry a rule while its body line stays put', () => {
  const before = ruled([3, 3, 3], [], 10);
  const view: TranscriptView = { follow: false, anchor: { key: 10, offset: 1, limit: 12 } };
  assert.equal(transcriptWindow(before, view, 2).start, 1);
  const after = ruled([4, 3, 3, 3], [0, 1], 9);
  assert.equal(transcriptWindow(after, view, 2).start, 4 + 1 + 1, 'entry 10 starts at row 4, its new rule adds one, then content offset 1');
});

test('scrolling to the very top shows the date rule; an anchor on it resolves to the content row once the rule is gone', () => {
  const withRule = ruled([3, 3, 3], [0, 2]);
  const top = scrollTranscript(withRule, pauseTranscript(withRule, resumeTranscript, 2), 2, 'top');
  assert.equal(transcriptWindow(withRule, top, 2).start, 0);
  assert.deepEqual([top.anchor?.key, top.anchor?.offset], [1, -1]);
  const noRule = ruled([3, 3, 3], []);
  assert.equal(transcriptWindow(noRule, top, 2).start, 0);
  assert.equal(topEntryKey(withRule, top, 2), 1);
});

test('a blank spacer after an entry still hands Enter to the entry below when that entry opens with a date rule', () => {
  const l: TranscriptLayout = { keys: [1, 2], ends: [3, 7], spacers: [true, false], leads: [0, 1] };
  const view: TranscriptView = { follow: false, anchor: { key: 1, offset: 2, limit: 2 } };
  assert.equal(transcriptWindow(l, view, 3).start, 2);
  assert.equal(topEntryKey(l, view, 3), 2);
});
