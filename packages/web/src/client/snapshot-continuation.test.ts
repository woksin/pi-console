import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event, Request, Snapshot } from '@pi-console/contract';
import { generate } from '@pi-console/testkit';
import type { Api } from './api.ts';
import { ConsoleStore } from './store.ts';

const fixture = generate().fixture as unknown as Snapshot;
const rows: Request[] = Array.from({ length: 9 }, (_, n) => ({
  ...fixture.requests[0], id: `r${n}`, status: n === 0 || n > 5 ? 'open' : 'unanswered', createdAt: `2026-01-0${n + 1}T00:00:00Z`,
  answer: null, answerPossiblyUnseen: false,
}));
const snapshot = (seq: number, requests: Request[]): Event => ({ seq, occurredAt: fixture.generatedAt, type: 'snapshot', payload: {
  ...fixture, requests, bounded: ['requests'], totals: { sessions: fixture.sessions.length, requests: rows.length, questions: fixture.questions.length,
    messages: fixture.messages.length, jobs: fixture.jobs.length, resets: fixture.resets.length },
} });

test('a compact reconnect preserves inactive history, drops missing live rows, and restarts continuation at the collection head', async () => {
  let emit: (frame: unknown) => void = () => undefined;
  const cursors: (string | null)[] = [];
  const api = {
    needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null), graph: () => Promise.resolve(null),
    stream: (_seq: number, _signal: AbortSignal, onFrame: (frame: unknown) => void) => { emit = onFrame; return new Promise<void>(() => undefined); },
    page: (_collection: string, options: { after: string | null }) => {
      cursors.push(options.after);
      const offset = Number(options.after ?? 0);
      const items = rows.slice().reverse().slice(offset, offset + 3);
      const next = offset + items.length;
      return Promise.resolve({ items, nextCursor: next < rows.length ? String(next) : null, hasMore: next < rows.length, total: rows.length });
    },
  } as unknown as Api;
  const store = new ConsoleStore(api, { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined });
  try {
    store.start();
    emit(snapshot(1, [rows[0], rows[1], rows[8]]));
    await store.loadMore('requests');
    assert.equal(store.getState().history.requests?.cursor, '3');
    emit(snapshot(2, [rows[8]]));
    assert.ok(!store.getState().requests.some(row => row.id === rows[0].id), 'missing live work is not kept stale');
    assert.ok(store.getState().requests.some(row => row.id === rows[1].id), 'historical unanswered rows survive');
    assert.deepEqual(store.getState().history, {});
    do { await store.loadMore('requests'); } while (store.getState().history.requests?.more);
    assert.deepEqual(cursors, [null, null, '3', '6']);
    assert.deepEqual(store.getState().requests.map(row => row.id), rows.map(row => row.id));
    assert.equal(store.getState().totals?.requests, rows.length);
  } finally { store.stop(); }
});
