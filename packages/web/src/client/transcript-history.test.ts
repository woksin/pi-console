import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Transcript, TranscriptEntry } from '@pi-console/contract';
import { ConsoleStore, type Clock } from './store.ts';
import { createApi, type Api } from './api.ts';

const clock: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
const entry = (cursor: number): TranscriptEntry => ({ id: `e${cursor}`, cursor, sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'assistant', text: `line ${cursor}`, toolCallId: null, resetId: null });

interface PageQuery { around: string | null; after?: number; limit: number; descending: boolean }

function pageQuery(query: URLSearchParams): PageQuery {
  return {
    around: query.get('around'), after: query.has('after') ? Number(query.get('after')) : undefined,
    limit: Number(query.get('limit')), descending: query.get('order') === 'desc',
  };
}

function pageStart({ around, after, limit, descending }: PageQuery, total: number): number {
  if (around) return Math.max(1, Number(around.slice(1)) - Math.floor(limit / 2));
  return descending ? Math.max(1, (after ?? total + 1) - limit) : (after ?? 0) + 1;
}

function historyResponse(query: PageQuery, total: number): Response {
  const { around, after, limit, descending } = query;
  if (around === 'missing') return new Response('', { status: 404 });
  const start = pageStart(query, total);
  const descendingPage = descending && !around;
  const end = descendingPage ? (after ?? total + 1) - 1 : Math.min(total, start + limit - 1);
  const items = Array.from({ length: end - start + 1 }, (_, index) => entry(start + index));
  return Response.json({ items, nextCursor: descending ? start : end, hasMore: descendingPage ? start > 1 : end < total, hasOlder: start > 1 });
}

function rig(total = 8000) {
  const queries: URL[] = [];
  let fail = false;
  const api = createApi('token', '', async (input, init) => {
    const url = new URL(String(input), 'http://localhost'); queries.push(url);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer token');
    assert.equal(init?.cache, 'no-store');
    if (fail) { fail = false; return new Response('', { status: 503 }); }
    return historyResponse(pageQuery(url.searchParams), total);
  });
  return { store: new ConsoleStore(api, clock), queries, fail: () => { fail = true; } };
}

test('tail omits after, older/newer use the visible edges and retain a movable 2500-entry window', async () => {
  const { store, queries } = rig();
  await store.loadTranscript('s1');
  assert.equal(queries.length, 1);
  assert.equal(queries[0].searchParams.get('order'), 'desc');
  assert.equal(queries[0].searchParams.has('after'), false);
  for (let page = 0; page < 6; page++) await store.pageTranscript('s1', 'older');
  let entries = store.getState().transcripts.s1;
  assert.equal(entries.length, 2500);
  assert.equal(entries[0].cursor, 4501);
  assert.equal(entries.at(-1)?.cursor, 7000);
  assert.equal(store.getState().transcriptHistory.s1.newer, true);
  await store.pageTranscript('s1', 'newer');
  assert.equal(queries.at(-1)?.searchParams.get('order'), 'asc');
  assert.equal(queries.at(-1)?.searchParams.get('after'), '7000');
  entries = store.getState().transcripts.s1;
  assert.equal(entries.length, 2500);
  assert.equal(entries[0].cursor, 5001);
  assert.equal(entries.at(-1)?.cursor, 7500);
  assert.equal(new Set(entries.map(item => item.id)).size, entries.length);
});

test('around jumps are direct, repeatable and fall back to a single fresh tail on 404 or failure', async () => {
  const { store, queries, fail } = rig();
  for (let attempt = 0; attempt < 2; attempt++) {
    await store.loadTranscript('s1', 'e42');
    assert.ok(store.getState().transcripts.s1.some(item => item.id === 'e42'));
    assert.equal(queries.at(-1)?.searchParams.get('around'), 'e42');
  }
  await store.loadTranscript('s1', 'missing');
  assert.equal(store.getState().transcripts.s1.at(-1)?.cursor, 8000);
  assert.equal(store.getState().transcriptHistory.s1.lastPage, 'tail');
  fail(); await store.loadTranscript('s1', 'e42');
  assert.equal(store.getState().transcripts.s1.at(-1)?.cursor, 8000);
  assert.equal(queries.length, 6);
});

test('older failures expose retryable status and return-to-live and reopen discard old windows', async () => {
  const { store, queries, fail } = rig();
  await store.loadTranscript('s1');
  fail(); await store.pageTranscript('s1', 'older');
  assert.equal(store.getState().transcriptHistory.s1.error, 'older');
  assert.equal(store.getState().transcripts.s1.length, 500);
  await store.pageTranscript('s1', 'older');
  assert.equal(store.getState().transcriptHistory.s1.error, undefined);
  assert.equal(store.getState().transcripts.s1.length, 1000);
  await store.returnToLiveTranscript('s1');
  assert.equal(store.getState().transcripts.s1.length, 500);
  store.closeTranscript('s1'); await store.loadTranscript('s1');
  assert.equal(queries.at(-1)?.searchParams.has('after'), false);
  assert.equal(store.getState().transcriptHistory.s1.lastPage, 'tail');
});

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}

test('overlapping paging is deduplicated, and close or another session cancels stale reads', async () => {
  const reads: { signal?: AbortSignal; result: ReturnType<typeof deferred<Transcript>> }[] = [];
  const api = { transcript: (_id, _after, _limit, options) => {
    const result = deferred<Transcript>(); reads.push({ signal: options?.signal, result }); return result.promise;
  } } satisfies Pick<Api, 'transcript'>;
  const store = new ConsoleStore(api as Api, clock);
  const first = store.loadTranscript('s1');
  const second = store.loadTranscript('s2');
  assert.equal(reads[0].signal?.aborted, true);
  reads[0].result.resolve({ items: [entry(1)], nextCursor: 1, hasMore: true }); await first;
  assert.deepEqual(store.getState().transcripts.s1, []);
  reads[1].result.resolve({ items: [entry(2)], nextCursor: 2, hasMore: true }); await second;
  const older = store.pageTranscript('s2', 'older');
  await store.pageTranscript('s2', 'older');
  assert.equal(reads.length, 3);
  store.closeTranscript('s2');
  assert.equal(reads[2].signal?.aborted, true);
  reads[2].result.resolve({ items: [entry(1)], nextCursor: 1, hasMore: false }); await older;
  assert.deepEqual(store.getState().transcripts.s2.map(item => item.cursor), [2]);
});
