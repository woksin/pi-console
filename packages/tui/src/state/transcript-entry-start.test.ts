import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openTranscript, pauseTranscript, resumeTranscript, scrollTranscript, topEntryKey, transcriptWindow, type TranscriptLayout } from './transcript-window.ts';

const layout: TranscriptLayout = { keys: [1, 2, 3], ends: [5, 10, 15] };

test('initial open starts with a whole entry, and pause and Enter keep that same entry', () => {
  const opened = openTranscript(layout, 7);
  const window = transcriptWindow(layout, opened, 7);
  assert.deepEqual(window, { start: 10, end: 15, below: 0, paused: false, dropped: false });
  assert.equal(topEntryKey(layout, opened, 7), 3);
  const paused = pauseTranscript(layout, opened, 7);
  assert.deepEqual(paused.anchor, { key: 3, offset: 0, limit: 3 });
  assert.deepEqual(transcriptWindow(layout, paused, 7), { ...window, paused: true });
  const appended: TranscriptLayout = { keys: [1, 2, 3, 4], ends: [5, 10, 15, 20] };
  assert.deepEqual(transcriptWindow(appended, paused, 7), { ...window, paused: true, below: 5 });
  assert.equal(transcriptWindow(appended, opened, 7).start, 13);
  assert.deepEqual(scrollTranscript(appended, opened, 7, 1), resumeTranscript);
  assert.equal(pauseTranscript(appended, opened, 7).anchor?.limit, 4);
});

test('line and page scrolling use the initial-open coordinates and return to the real live bottom', () => {
  const opened = openTranscript(layout, 7);
  for (const motion of [-1, -7]) {
    const moved = scrollTranscript(layout, opened, 7, motion);
    assert.equal(transcriptWindow(layout, moved, 7).start, 10 + motion);
    assert.equal(topEntryKey(layout, moved, 7), motion === -1 ? 2 : 1);
    assert.deepEqual(scrollTranscript(layout, moved, 7, -motion), resumeTranscript);
  }
  assert.deepEqual(scrollTranscript(layout, opened, 7, 1), resumeTranscript);
  assert.equal(transcriptWindow(layout, resumeTranscript, 7).start, 8);
});

test('an oversized newest entry opens at the live bottom; down, page down and End resume there', () => {
  const oversized: TranscriptLayout = { keys: [1, 2], ends: [2, 14] };
  const opened = openTranscript(oversized, 6);
  const window = transcriptWindow(oversized, opened, 6);
  assert.deepEqual(window, { start: 8, end: 14, below: 0, paused: false, dropped: false });
  const paused = pauseTranscript(oversized, opened, 6);
  assert.deepEqual(transcriptWindow(oversized, paused, 6), { ...window, paused: true });
  const above = scrollTranscript(oversized, paused, 6, -1);
  for (const motion of [1, 6, 'bottom'] as const) {
    const bottom = scrollTranscript(oversized, above, 6, motion);
    assert.deepEqual(bottom, resumeTranscript);
    assert.deepEqual(transcriptWindow(oversized, bottom, 6), window);
    assert.equal(topEntryKey(oversized, bottom, 6), 2);
  }
});

test('a growing entry follows every new bottom line without jumping back to its beginning', () => {
  const before: TranscriptLayout = { keys: [1, 2, 3], ends: [5, 10, 18] };
  const opened = openTranscript(before, 10);
  assert.equal(transcriptWindow(before, opened, 10).start, 10);
  for (const end of [19, 20, 21, 22]) {
    const grown = { ...before, ends: [5, 10, end] };
    const window = transcriptWindow(grown, opened, 10);
    assert.deepEqual(window, { start: end - 10, end, below: 0, paused: false, dropped: false });
    const paused = pauseTranscript(grown, opened, 10);
    assert.equal(transcriptWindow(grown, paused, 10).start, window.start);
  }
});

test('date rules may scroll away without discarding the timestamp, and spacers never open the tail', () => {
  const ruled: TranscriptLayout = { keys: [1, 2], ends: [4, 7], leads: [1, 0] };
  const opened = openTranscript(ruled, 6);
  assert.equal(transcriptWindow(ruled, opened, 6).start, 1);
  assert.equal(topEntryKey(ruled, opened, 6), 1);
  const spaced: TranscriptLayout = { keys: [1, 2, 3], ends: [4, 7, 10], spacers: [true, true, true] };
  const spacedOpen = openTranscript(spaced, 7);
  assert.equal(transcriptWindow(spaced, spacedOpen, 7).start, 4);
  assert.equal(topEntryKey(spaced, spacedOpen, 7), 2);
});
