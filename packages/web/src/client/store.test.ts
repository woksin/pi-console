import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TranscriptEntry } from '@pi-console/contract';
import { ConsoleStore, type Clock } from './store.ts';
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

test('a complete (unbounded) snapshot never pages', async () => {
  let calls = 0;
  const store = new ConsoleStore({ page: () => { calls++; return Promise.resolve(null); } } as unknown as Api, clock);
  await store.loadMore('jobs');
  assert.equal(calls, 0);
});
