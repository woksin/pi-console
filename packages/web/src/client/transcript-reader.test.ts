import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Transcript, TranscriptEntry } from '@pi-console/contract';
import type { Api } from './api.ts';
import { TranscriptHistory } from './transcript-history.ts';
import { readerTransition, type ReaderView } from './transcript-reader.ts';
import { emptyState } from '../state/state.ts';
import { applyEvent } from '../state/reduce.ts';

const view: ReaderView = { sessionId: 's1', focus: null, snapshotLoaded: true, gapCount: 1 };
const entry = (cursor: number): TranscriptEntry => ({ id: `e${cursor}`, cursor, sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'assistant', text: String(cursor), toolCallId: null, resetId: null });
const cursors = (first: number, length: number): number[] => Array.from({ length }, (_, index) => first + index);
function page(values: readonly number[], extra: Partial<Transcript> = {}): Transcript {
  return { items: values.map(entry), nextCursor: values.at(-1) ?? 0, hasMore: false, ...extra };
}

function rig() {
  let state = emptyState();
  const reads: { params: Parameters<Api['transcript']>; result: ReturnType<typeof Promise.withResolvers<Transcript>> }[] = [];
  const api: Pick<Api, 'transcript'> = { transcript: (...params) => {
    const result = Promise.withResolvers<Transcript>(); reads.push({ params, result }); return result.promise;
  } };
  const reader = new TranscriptHistory(api as Api, () => state, next => { state = next; });
  return {
    reader, reads, state: () => state,
    reconcile: (change: Partial<ReaderView> = {}) => reader.reconcile({ ...view, ...change }),
    arrive: (cursor: number) => { state = applyEvent(state, { type: 'transcript.appended', seq: cursor, occurredAt: entry(cursor).at, payload: entry(cursor) }); },
    entries: () => state.transcripts.s1?.map(item => item.cursor),
  };
}

test('reader planning opens once when the first snapshot changes readiness and gap together', () => {
  assert.deepEqual(readerTransition(undefined, { ...view, snapshotLoaded: false, gapCount: 0 }, 1), { action: 'wait' });
  const opening = readerTransition(undefined, { ...view, focus: 'e42' }, 1);
  assert.ok(opening.action === 'open');
  assert.equal(opening.reader.id, 1);
  assert.equal(readerTransition(opening.reader, { ...view, focus: 'e42' }, 2).action, 'keep');
  const gap = readerTransition(opening.reader, { ...view, focus: 'e42', gapCount: 2 }, 2);
  assert.ok(gap.action === 'refresh');
  assert.equal(gap.reader.id, 1);
});

test('replacement and gap in one render choose only open and allocate a new reader generation', () => {
  const reader = { id: 4, sessionId: 's1', focus: null, gapCount: 1 };
  const focus = readerTransition(reader, { ...view, focus: 'e42', gapCount: 2 }, 5);
  assert.deepEqual(focus, { action: 'open', reader: { ...reader, id: 5, focus: 'e42', gapCount: 2 } });
  const session = readerTransition(reader, { ...view, sessionId: 's2', gapCount: 2 }, 6);
  assert.deepEqual(session, { action: 'open', reader: { ...reader, id: 6, sessionId: 's2', gapCount: 2 } });
});

test('a direct around link opens with the gap-changing first snapshot and is not refreshed by the same render', async () => {
  const r = rig();
  await r.reconcile({ snapshotLoaded: false, gapCount: 0, focus: 'e42' });
  assert.equal(r.reads.length, 0);
  const opening = r.reconcile({ focus: 'e42' });
  await r.reconcile({ focus: 'e42' });
  assert.equal(r.reads.length, 1);
  assert.equal(r.reads[0].params[3]?.around, 'e42');
  assert.equal(r.reads[0].params[3]?.signal?.aborted, false);
  r.reads[0].result.resolve(page([40, 41, 42])); await opening;
  assert.deepEqual(r.entries(), [40, 41, 42]);
});

test('replacing a reader in a gap render starts only the requested around page', async () => {
  const r = rig();
  const initial = r.reconcile(); r.reads[0].result.resolve(page([100])); await initial;
  const replacement = r.reconcile({ focus: 'e42', gapCount: 2 });
  await r.reconcile({ focus: 'e42', gapCount: 2 });
  assert.equal(r.reads.length, 2);
  assert.equal(r.reads[1].params[3]?.around, 'e42');
  assert.equal(r.reads[1].params[3]?.signal?.aborted, false);
  r.reads[1].result.resolve(page([42])); await replacement;
  assert.deepEqual(r.entries(), [42]);
});

test('a later gap retries an in-flight around intent and excludes both its stale response and the live tail', async () => {
  const r = rig();
  const first = r.reconcile({ focus: 'e42' });
  r.arrive(1000); r.reader.invalidate();
  const retry = r.reconcile({ focus: 'e42', gapCount: 2 });
  await r.reconcile({ focus: 'e42', gapCount: 2 });
  assert.equal(r.reads.length, 2);
  assert.equal(r.reads[0].params[3]?.signal?.aborted, true);
  assert.equal(r.reads[1].params[3]?.around, 'e42');
  r.reads[0].result.resolve(page([999])); await first;
  assert.deepEqual(r.entries(), []);
  r.reads[1].result.resolve(page([40, 41, 42])); await retry;
  assert.deepEqual(r.entries(), [40, 41, 42]);
  assert.equal(r.state().transcriptHistory.s1?.newer, true);
});

test('a paused initial tail still retries on a gap because no established window exists yet', async () => {
  const r = rig();
  const opening = r.reconcile();
  r.reader.following({ sessionId: 's1', following: false }); r.reader.invalidate();
  const retry = r.reconcile({ gapCount: 2 });
  assert.equal(r.reads.length, 2);
  assert.equal(r.reads[1].params[3]?.order, 'desc');
  r.reads[0].result.resolve(page([1])); await opening;
  r.reads[1].result.resolve(page([1000])); await retry;
  assert.deepEqual(r.entries(), [1000]);
});

test('a gap during a missing jump fallback retries the tail intent instead of preserving an empty window', async () => {
  const r = rig();
  const opening = r.reconcile({ focus: 'missing' });
  r.reads[0].result.reject(new Error('not found'));
  await new Promise<void>(resolve => { queueMicrotask(resolve); });
  assert.equal(r.reads[1].params[3]?.around, undefined);
  r.reader.invalidate();
  const retry = r.reconcile({ focus: 'missing', gapCount: 2 });
  assert.equal(r.reads[2].params[3]?.around, undefined);
  r.reads[1].result.resolve(page([1])); await opening;
  assert.deepEqual(r.entries(), []);
  r.reads[2].result.resolve(page([1000])); await retry;
  assert.deepEqual(r.entries(), [1000]);
});

test('a new generation rejects an out-of-order response from a replaced focus', async () => {
  const r = rig();
  const old = r.reconcile({ focus: 'e42' });
  const current = r.reconcile({ focus: 'e7' });
  r.reads[1].result.resolve(page([7])); await current;
  r.reads[0].result.resolve(page([42])); await old;
  assert.deepEqual(r.entries(), [7]);
  r.reader.close('s1');
  const reopened = r.reconcile({ focus: 'e7' });
  r.reads[2].result.resolve(page([7, 8])); await reopened;
  assert.deepEqual(r.entries(), [7, 8]);
});

test('a gap aborts older paging without losing its boundary or deferred arrivals; explicit retry remains contiguous', async () => {
  const r = rig();
  const initial = r.reconcile(); r.reads[0].result.resolve(page(cursors(7501, 2500), { hasMore: true })); await initial;
  r.reader.following({ sessionId: 's1', following: false });
  const older = r.reader.page('s1', 'older');
  r.arrive(10001); r.reader.invalidate(); await r.reconcile({ gapCount: 2 });
  assert.equal(r.reads.length, 2);
  r.reads[1].result.resolve(page(cursors(7001, 500), { hasMore: true })); await older;
  assert.deepEqual(r.entries(), cursors(7501, 2500));
  assert.equal(r.state().transcriptHistory.s1?.loading, undefined);
  const retry = r.reader.page('s1', 'older');
  assert.equal(r.reads[2].params[1], 7501);
  r.reads[2].result.resolve(page(cursors(7001, 500), { hasMore: true })); await retry;
  assert.deepEqual(r.entries(), cursors(7001, 2500));
  assert.equal(r.state().transcriptHistory.s1?.observedTail, 10001);
  assert.equal(r.state().transcriptHistory.s1?.newer, true);
});

test('a gap during newer paging preserves the historical edge and excludes deferred live arrivals', async () => {
  const r = rig();
  const initial = r.reconcile({ focus: 'e42' });
  r.reads[0].result.resolve(page([40, 41, 42], { hasMore: true })); await initial;
  const newer = r.reader.page('s1', 'newer');
  r.arrive(1000); r.reader.invalidate(); await r.reconcile({ focus: 'e42', gapCount: 2 });
  r.reads[1].result.resolve(page([43])); await newer;
  assert.deepEqual(r.entries(), [40, 41, 42]);
  const retry = r.reader.page('s1', 'newer');
  assert.equal(r.reads[2].params[1], 42);
  r.reads[2].result.resolve(page([43, 44])); await retry;
  assert.deepEqual(r.entries(), [40, 41, 42, 43, 44]);
  assert.equal(r.state().transcriptHistory.s1?.newer, true);
});

test('pausing an established tail refresh before another gap preserves the visible window and anchor revision', async () => {
  const r = rig();
  const initial = r.reconcile(); r.reads[0].result.resolve(page([1000])); await initial;
  const revision = r.state().transcriptHistory.s1?.revision;
  r.reader.invalidate(); const refresh = r.reconcile({ gapCount: 2 });
  r.reader.following({ sessionId: 's1', following: false }); r.arrive(1001);
  r.reader.invalidate(); await r.reconcile({ gapCount: 3 });
  r.reads[1].result.resolve(page([999])); await refresh;
  assert.equal(r.reads.length, 2);
  assert.deepEqual(r.entries(), [1000, 1001]);
  assert.equal(r.state().transcriptHistory.s1?.revision, revision);
  assert.equal(r.state().transcriptHistory.s1?.newer, true);
});

test('resume during older paging and a subsequent gap never reopen the route focus or accept stale pages', async () => {
  const r = rig();
  const initial = r.reconcile({ focus: 'e42' });
  r.reads[0].result.resolve(page([40, 41, 42], { hasOlder: true, hasMore: true })); await initial;
  const older = r.reader.page('s1', 'older');
  const resume = r.reader.resume({ sessionId: 's1' });
  assert.equal(r.reads[1].params[3]?.signal?.aborted, true);
  assert.equal(r.reads[2].params[3]?.around, undefined);
  r.reader.invalidate();
  const refresh = r.reconcile({ focus: 'e42', gapCount: 2 });
  assert.equal(r.reads[3].params[3]?.around, undefined);
  r.reads[1].result.resolve(page([1])); await older;
  r.reads[2].result.resolve(page([900])); await resume;
  r.arrive(1001);
  r.reads[3].result.resolve(page([999, 1000])); await refresh;
  assert.deepEqual(r.entries(), [999, 1000, 1001]);
});

test('a retried jump can fall back to tail, and later gaps refresh that tail rather than replay the route jump', async () => {
  const r = rig();
  const first = r.reconcile({ focus: 'missing' }); r.reader.invalidate();
  const retry = r.reconcile({ focus: 'missing', gapCount: 2 });
  r.reads[0].result.resolve(page([1])); await first;
  r.reads[1].result.reject(new Error('not found'));
  await new Promise<void>(resolve => { queueMicrotask(resolve); });
  assert.equal(r.reads[2].params[3]?.around, undefined);
  r.reads[2].result.resolve(page([1000])); await retry;
  const revision = r.state().transcriptHistory.s1?.revision;
  r.reader.invalidate();
  const refresh = r.reconcile({ focus: 'missing', gapCount: 3 });
  assert.equal(r.reads[3].params[3]?.around, undefined);
  assert.deepEqual(r.entries(), [1000]);
  r.reads[3].result.resolve(page([1001])); await refresh;
  assert.deepEqual(r.entries(), [1001]);
  assert.equal(r.state().transcriptHistory.s1?.revision, revision);
});
