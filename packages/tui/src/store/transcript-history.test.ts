import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { TranscriptEntry } from '@pi-console/contract';
import { Store, TRANSCRIPT_LIMIT } from './store.ts';

const entries = (first: number, last: number): TranscriptEntry[] => Array.from({ length: last - first + 1 }, (_, index) => ({ id: String(first + index), cursor: first + index, sessionId: 's', at: '2026-01-01T00:00:00Z', kind: 'assistant', text: String(first + index), toolCallId: null, resetId: null }));
const page = (items: TranscriptEntry[], hasMore: boolean) => ({ items, nextCursor: items.at(-1)?.cursor ?? 0, hasMore });

test('movable history trims the opposite edge, excludes live entries away from tail, and resumes at tail', () => {
  const store = new Store();
  try {
    store.setTranscriptPage('s', page(entries(3001, 4000).reverse(), true), 'tail');
    store.setTranscriptPage('s', page(entries(2001, 3000).reverse(), true), 'older');
    store.setTranscriptPage('s', page(entries(1001, 2000).reverse(), true), 'older');
    let data = store.getSnapshot();
    assert.equal(data.transcripts.get('s')?.length, TRANSCRIPT_LIMIT);
    assert.equal(data.transcripts.get('s')?.at(-1)?.cursor, 3500);
    assert.equal(data.transcriptHistory.get('s')?.newer, true);
    store.mergeTranscript('s', entries(4001, 4001)); store.flush();
    assert.equal(store.getSnapshot().transcripts.get('s')?.at(-1)?.cursor, 3500, 'live events cannot displace the historical window');
    store.mergeTranscript('s', entries(4002, 4002)); store.flush();
    store.setTranscriptPage('s', page(entries(3501, 4001), false), 'newer');
    assert.equal(store.getSnapshot().transcriptHistory.get('s')?.newer, true, 'an arrival beyond the captured EOF keeps newer history available');
    store.setTranscriptPage('s', page(entries(4002, 4002), false), 'newer');
    data = store.getSnapshot();
    assert.equal(data.transcripts.get('s')?.length, TRANSCRIPT_LIMIT);
    assert.equal(data.transcripts.get('s')?.at(-1)?.cursor, 4002);
    assert.equal(data.transcriptHistory.get('s')?.newer, false);
    store.mergeTranscript('s', entries(4003, 4003)); store.flush();
    assert.equal(store.getSnapshot().transcripts.get('s')?.at(-1)?.cursor, 4003);
    assert.equal(store.getSnapshot().transcriptHistory.get('s')?.older, true);
  } finally { store.dispose(); }
});

test('around-entry pages replace the window and preserve both history directions', () => {
  const store = new Store();
  try {
    store.setTranscriptPage('s', page(entries(9001, 10_000).reverse(), true), 'tail');
    store.setTranscriptPage('s', { ...page(entries(100, 200), true), hasOlder: true }, 'around');
    assert.deepEqual(store.getSnapshot().transcripts.get('s')?.map(e => e.cursor), entries(100, 200).map(e => e.cursor));
    assert.equal(store.getSnapshot().transcriptHistory.get('s')?.older, true);
    assert.equal(store.getSnapshot().transcriptHistory.get('s')?.newer, true);
    store.setTranscriptPage('s', page([], false), 'older');
    assert.equal(store.getSnapshot().transcriptHistory.get('s')?.older, false);
  } finally { store.dispose(); }
});
