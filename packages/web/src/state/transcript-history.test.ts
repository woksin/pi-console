import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptEntry } from '@pi-console/contract';
import { emptyProgress, transcriptArrival, transcriptPage } from './transcript-history.ts';

const entry = (cursor: number): TranscriptEntry => ({ id: `e${cursor}`, cursor, sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'assistant', text: String(cursor), toolCallId: null, resetId: null });

test('live arrivals never splice a non-contiguous tail into a historical or pending-around window', () => {
  for (const progress of [{ ...emptyProgress, newer: true }, { ...emptyProgress, loading: 'around' as const }]) {
    const result = transcriptArrival([entry(1)], progress, entry(9000));
    assert.deepEqual(result.entries.map(item => item.cursor), [1]);
    assert.equal(result.progress.newer, true);
    assert.equal(result.progress.observedTail, 9000);
  }
});

test('arrivals while a tail request is pending survive its captured tail response', () => {
  const live = transcriptArrival([], { ...emptyProgress, loading: 'tail' }, entry(1001));
  const result = transcriptPage(live.entries, live.progress, { items: [entry(999), entry(1000)], nextCursor: 999, hasMore: true }, 'tail');
  assert.deepEqual(result.entries.map(item => item.cursor), [999, 1000, 1001]);
  assert.equal(result.progress.newer, false);
  assert.equal(result.progress.older, true);
});

test('around responses retain knowledge of concurrent live arrivals until the gap is paged', () => {
  const live = transcriptArrival([], { ...emptyProgress, loading: 'around' }, entry(101));
  const result = transcriptPage([], live.progress, { items: [entry(99), entry(100)], nextCursor: 100, hasMore: false, hasOlder: true }, 'around');
  assert.equal(result.progress.newer, true);
  const next = transcriptPage(result.entries, result.progress, { items: [entry(101)], nextCursor: 101, hasMore: false }, 'newer');
  assert.equal(next.progress.newer, false);
  assert.deepEqual(next.entries.map(item => item.cursor), [99, 100, 101]);
});

test('live arrivals deduplicate and evict only the oldest edge at the retention bound', () => {
  const current = Array.from({ length: 2500 }, (_, index) => entry(index + 1));
  const result = transcriptArrival(current, emptyProgress, entry(2501));
  assert.equal(result.entries.length, 2500);
  assert.equal(result.entries[0].cursor, 2);
  assert.equal(result.progress.older, true);
  assert.equal(transcriptArrival(result.entries, result.progress, entry(2501)).entries.length, 2500);
});
