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
  const loaded = store.getState().transcripts['s1'] ?? [];
  assert.equal(loaded.length, 2500);
  assert.equal(loaded.at(-1)?.cursor, 6000, 'the tail is present');
  assert.equal(loaded[0]?.cursor, 3501);
});

test('a failed history load is retried on the next open instead of being cached', async () => {
  const { api } = history(10, 1);
  const store = new ConsoleStore(api, clock);
  await store.loadTranscript('s1');
  assert.equal((store.getState().transcripts['s1'] ?? []).length, 0);
  await store.loadTranscript('s1');
  assert.equal((store.getState().transcripts['s1'] ?? []).length, 10);
});
