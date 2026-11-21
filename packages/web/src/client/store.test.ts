import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryItem, SessionMemory, TranscriptEntry } from '@pi-console/contract';
import { ConsoleStore, memoryRefreshMs, type Clock } from './store.ts';
import type { Api } from './api.ts';

const clock: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };

const entry = (cursor: number): TranscriptEntry => ({
  id: `e${String(cursor)}`, cursor, sessionId: 's1', at: '2026-01-01T00:00:00.000Z', kind: 'assistant', text: `line ${String(cursor)}`,
  toolCallId: null, resetId: null, requestId: null, toolResult: null,
});

/** A daemon with `total` entries, served by the real paging contract (`after` cursor, `limit`, `hasMore`). */
function history(total: number, failFirst = 0): { api: Api; calls: () => number } {
  let calls = 0;
  const api = {
    transcript: (_session: string, after: number, limit: number) => {
      calls++;
      if (calls <= failFirst) return Promise.reject(new Error('unreachable'));
      const items = Array.from({ length: Math.max(0, Math.min(limit, total - after)) }, (_, index) => entry(after + index + 1));
      const nextCursor = after + items.length;
      return Promise.resolve({ items, nextCursor, hasMore: nextCursor < total });
    },
  } as unknown as Api;
  return { api, calls: () => calls };
}

test('opening a long session loads the newest history, not the oldest: it pages to the end and keeps the last 2,500', async () => {
  const store = new ConsoleStore(history(6000).api, clock);
  await store.loadTranscript('s1');
  const loaded = store.getState().transcripts.s1 ?? [];
  assert.equal(loaded.length, 2500);
  assert.equal(loaded.at(-1)?.cursor, 6000, 'the tail is present');
  assert.equal(loaded[0]?.cursor, 3501);
});

test('a failed history load is retried on the next open instead of being cached', async () => {
  const { api } = history(10, 1);
  const store = new ConsoleStore(api, clock);
  await store.loadTranscript('s1');
  assert.equal((store.getState().transcripts.s1 ?? []).length, 0);
  await store.loadTranscript('s1');
  assert.equal((store.getState().transcripts.s1 ?? []).length, 10);
});

const job = (id: string, status: 'running' | 'done', startedAt: string) => ({ id, sessionId: 's1', kind: 'job' as const, name: id, status, startedAt, exitCode: null });
const emptyList = { items: [], nextCursor: null, hasMore: false, total: 0 };

function windowedSnapshot(jobs: ReturnType<typeof job>[], total: number) {
  const base = { version: 0 as const, generatedAt: '2026-06-01T00:00:00.000Z', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs, resets: [], transcriptCursors: [], interventions: [] };
  return { seq: 5, type: 'snapshot' as const, payload: { ...base, totals: { sessions: 0, requests: 0, questions: 0, messages: 0, jobs: total, resets: 0 }, bounded: ['jobs' as const] } };
}

test('a windowed snapshot is paged older-ward on request; pages merge without duplicates and end the paging', async () => {
  const older = [job('j3', 'done', '2026-01-03T00:00:00Z'), job('j2', 'done', '2026-01-02T00:00:00Z')];
  const calls: unknown[] = [];
  const snapshot = windowedSnapshot([job('j4', 'running', '2026-01-04T00:00:00Z'), job('j3', 'done', '2026-01-03T00:00:00Z')], 4);
  const api = {
    page: (_name: string, params: unknown) => { calls.push(params); return Promise.resolve({ ...emptyList, items: older, total: 4 }); },
    stream: (_seq: number, _signal: AbortSignal, onFrame: (frame: unknown) => void) => { onFrame(snapshot); return new Promise<void>(() => undefined); },
    needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  store.start();
  await store.loadMore('jobs');
  await store.loadMore('jobs');
  store.stop();
  assert.equal(calls.length, 1, 'a complete history is not fetched again');
  assert.deepEqual(store.getState().jobs.map(item => item.id), ['j2', 'j3', 'j4']);
  assert.equal(store.getState().totals?.jobs, 4);
});

test('a resnapshot voids exhausted paging so dropped rows can be reloaded', async () => {
  let emit: (frame: unknown) => void = () => undefined;
  let pages = 0;
  const api = {
    page: () => { pages++; return Promise.resolve({ ...emptyList, items: [job('j1', 'done', '2026-01-01T00:00:00Z')], total: 2 }); },
    stream: (_seq: number, _signal: AbortSignal, onFrame: (frame: unknown) => void) => { emit = onFrame; onFrame(windowedSnapshot([job('j4', 'running', '2026-01-04T00:00:00Z')], 2)); return new Promise<void>(() => undefined); },
    needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  store.start();
  await store.loadMore('jobs');
  assert.equal(store.getState().history.jobs?.more, false);
  await store.loadMore('jobs');
  assert.equal(pages, 1);
  emit({ ...windowedSnapshot([job('j5', 'running', '2026-01-05T00:00:00Z')], 3), seq: 9 });
  assert.equal(store.getState().history.jobs, undefined);
  await store.loadMore('jobs');
  assert.equal(pages, 2);
  store.stop();
});

test('the attention list counts as loaded only once a fetch of it succeeds, so "new since you looked" has a real baseline', async () => {
  let fail = true;
  const api = {
    needsYou: () => (fail ? Promise.reject(new Error('offline')) : Promise.resolve([])), health: () => Promise.resolve(null),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  assert.equal(store.getState().needsYouLoaded, false);
  await store.refresh();
  assert.equal(store.getState().needsYouLoaded, false, 'a failed fetch is not a loaded list');
  fail = false;
  await store.refresh();
  assert.equal(store.getState().needsYouLoaded, true);
});

test('a complete (unbounded) snapshot never pages', async () => {
  let calls = 0;
  const store = new ConsoleStore({ page: () => { calls++; return Promise.resolve(null); } } as unknown as Api, clock);
  await store.loadMore('jobs');
  assert.equal(calls, 0);
});

const memorySummary = (sessionId: string): SessionMemory => ({
  sessionId, storeDetected: true,
  counts: { active: 0, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 0 },
  proposedConfirmable: 1, unresolved: { lowerBound: 2, atLastHandoff: null }, wider: 0, handoffs: [],
});
const proposedItem: MemoryItem = {
  id: 'item-1', sessionId: 's1', kind: 'order', scope: { kind: 'session', key: 's1' },
  status: 'proposed', statusBasis: 'recorded', text: 'synthetic order', withheld: false,
  sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-01-01T00:00:00.000Z', command: '/memory confirm item-1',
};

test('session memory loads summary and bounded items together, sharing requests and throttling per session', async () => {
  let now = 0;
  const summaries: string[] = [];
  const itemCalls: unknown[] = [];
  const api = {
    sessionMemory: (sessionId: string) => { summaries.push(sessionId); return Promise.resolve(memorySummary(sessionId)); },
    memoryItems: (sessionId: string, limit: number) => { itemCalls.push([sessionId, limit]); return Promise.resolve([proposedItem]); },
  } as unknown as Api;
  const store = new ConsoleStore(api, { ...clock, now: () => now });
  const first = store.loadSessionMemory('s1');
  assert.equal(store.loadSessionMemory('s1'), first);
  await first;
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
  now = memoryRefreshMs - 1;
  await store.loadSessionMemory('s1');
  await store.loadSessionMemory('s2');
  assert.deepEqual(summaries, ['s1', 's2']);
  now = memoryRefreshMs;
  await store.loadSessionMemory('s1');
  assert.deepEqual(summaries, ['s1', 's2', 's1']);
  assert.deepEqual(itemCalls, [['s1', 100], ['s2', 100], ['s1', 100]]);
  assert.deepEqual(store.getState().memory.s2, memorySummary('s2'));
});

test('a resnapshot clears the session memory throttle even before its refresh interval expires', async () => {
  let emit: (frame: unknown) => void = () => undefined;
  let calls = 0;
  const api = {
    stream: (_seq: number, _signal: AbortSignal, onFrame: (frame: unknown) => void) => { emit = onFrame; onFrame(windowedSnapshot([], 0)); return new Promise<void>(() => undefined); },
    sessionMemory: () => { calls++; return Promise.resolve(memorySummary('s1')); },
    memoryItems: () => Promise.resolve([proposedItem]),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  store.start();
  await store.loadSessionMemory('s1');
  await store.loadSessionMemory('s1');
  assert.equal(calls, 1);
  emit({ ...windowedSnapshot([], 0), seq: 9 });
  await store.loadSessionMemory('s1');
  store.stop();
  assert.equal(calls, 2);
});

for (const cached of [false, true]) test(`an items failure preserves the ${cached ? 'cached' : 'empty'} memory pair and retries immediately`, async () => {
  let now = 0;
  let calls = 0;
  let fail = false;
  const api = {
    sessionMemory: () => { calls++; return Promise.resolve(memorySummary('s1')); },
    memoryItems: () => fail ? Promise.reject(new Error('unreachable')) : Promise.resolve([proposedItem]),
  } as unknown as Api;
  const store = new ConsoleStore(api, { ...clock, now: () => now });
  if (cached) await store.loadSessionMemory('s1');
  const good = store.getState();
  now = memoryRefreshMs;
  fail = true;
  await store.loadSessionMemory('s1');
  assert.equal(store.getState(), good);
  fail = false;
  await store.loadSessionMemory('s1');
  assert.equal(calls, cached ? 3 : 2);
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
});

test('a failed session memory refresh preserves the last good copy and retries immediately', async () => {
  let now = 0;
  let calls = 0;
  const api = {
    sessionMemory: () => {
      calls++;
      return calls === 2 ? Promise.reject(new Error('unreachable')) : Promise.resolve(memorySummary('s1'));
    },
    memoryItems: () => Promise.resolve([proposedItem]),
  } as unknown as Api;
  const store = new ConsoleStore(api, { ...clock, now: () => now });
  await store.loadSessionMemory('s1');
  const good = store.getState();
  now = memoryRefreshMs;
  await store.loadSessionMemory('s1');
  assert.equal(store.getState(), good);
  await store.loadSessionMemory('s1');
  assert.equal(calls, 3);
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
});
