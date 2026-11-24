import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pauseTranscript, resumeTranscript, scrollTranscript, topEntryKey, transcriptWindow, type TranscriptLayout } from './transcript-window.ts';

const layout: TranscriptLayout = { keys: [1, 2, 3], ends: [5, 10, 15] };

test('following starts with a whole entry, and pause and Enter keep that same entry', () => {
  const window = transcriptWindow(layout, resumeTranscript, 7);
  assert.deepEqual(window, { start: 10, end: 15, below: 0, paused: false, dropped: false });
  assert.equal(topEntryKey(layout, resumeTranscript, 7), 3);
  const paused = pauseTranscript(layout, resumeTranscript, 7);
  assert.deepEqual(paused.anchor, { key: 3, offset: 0, limit: 3 });
  assert.deepEqual(transcriptWindow(layout, paused, 7), { ...window, paused: true });
  const appended: TranscriptLayout = { keys: [1, 2, 3, 4], ends: [5, 10, 15, 20] };
  assert.deepEqual(transcriptWindow(appended, paused, 7), { ...window, paused: true, below: 5 });
});

test('line and page scrolling use the aligned live boundary and can return to following', () => {
  for (const motion of [-1, -7]) {
    const moved = scrollTranscript(layout, resumeTranscript, 7, motion);
    assert.equal(transcriptWindow(layout, moved, 7).start, 10 + motion);
    assert.equal(topEntryKey(layout, moved, 7), motion === -1 ? 2 : 1);
    assert.deepEqual(scrollTranscript(layout, moved, 7, -motion), resumeTranscript);
  }
  assert.deepEqual(scrollTranscript(layout, resumeTranscript, 7, 1), resumeTranscript);
});

test('an oversized newest entry opens with its timestamp but remains manually scrollable', () => {
  const oversized: TranscriptLayout = { keys: [1, 2], ends: [2, 14] };
  const window = transcriptWindow(oversized, resumeTranscript, 6);
  assert.deepEqual(window, { start: 2, end: 8, below: 6, paused: false, dropped: false });
  const paused = pauseTranscript(oversized, resumeTranscript, 6);
  assert.deepEqual(transcriptWindow(oversized, paused, 6), { ...window, paused: true });
  const bottom = scrollTranscript(oversized, paused, 6, 100);
  assert.deepEqual(transcriptWindow(oversized, bottom, 6), { start: 8, end: 14, below: 0, paused: true, dropped: false });
  assert.equal(topEntryKey(oversized, bottom, 6), 2);
  assert.deepEqual(scrollTranscript(oversized, bottom, 6, 'bottom'), resumeTranscript);
});

test('date rules may scroll away without discarding the timestamp, and spacers never open the tail', () => {
  const ruled: TranscriptLayout = { keys: [1, 2], ends: [4, 7], leads: [1, 0] };
  assert.equal(transcriptWindow(ruled, resumeTranscript, 6).start, 1);
  assert.equal(topEntryKey(ruled, resumeTranscript, 6), 1);
  const spaced: TranscriptLayout = { keys: [1, 2, 3], ends: [4, 7, 10], spacers: [true, true, true] };
  assert.equal(transcriptWindow(spaced, resumeTranscript, 7).start, 4);
  assert.equal(topEntryKey(spaced, resumeTranscript, 7), 2);
});
