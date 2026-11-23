import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event, Request, Snapshot } from '@pi-console/contract';
import { generate } from '@pi-console/testkit';
import { Store } from './store.ts';

const fixture = generate().fixture as unknown as Snapshot;
const request = (id: string, status: Request['status'], extra: Partial<Request> = {}): Request => ({
  ...fixture.requests[0], id, status, createdAt: '2026-01-01T00:00:00Z', answerPossiblyUnseen: false, ...extra,
});
const frame = (seq: number, requests: Request[]): Event => ({ seq, occurredAt: fixture.generatedAt, type: 'snapshot', payload: {
  ...fixture, requests, bounded: ['requests'], totals: { sessions: fixture.sessions.length, requests: 7, questions: fixture.questions.length,
    messages: fixture.messages.length, jobs: fixture.jobs.length, resets: fixture.resets.length },
} });

test('a compact reconnect retains historical requests and loaded pages, but never retains omitted actionable requests as live', () => {
  const store = new Store();
  const unseen = request('unseen', 'answered', { origin: 'human', answerPossiblyUnseen: true, answer: { id: 'a', text: 'done', at: fixture.generatedAt, interim: false } });
  const previous = [request('open', 'open'), unseen, request('ended', 'unanswered'), request('interrupted', 'interrupted')];
  const loaded = request('loaded', 'answered');
  const newest = request('newest', 'open');
  try {
    store.apply(frame(1, previous));
    store.mergePage('requests', { items: [loaded], nextCursor: null, hasMore: false, total: 7 });
    store.apply(frame(2, [newest]));
    assert.deepEqual(store.getSnapshot().requests.map(row => row.id), ['ended', 'interrupted', 'loaded', 'newest']);
    assert.deepEqual(store.getSnapshot().history, {}, 'a compacted window invalidates exhausted paging progress');
    const head = [newest, ...previous];
    store.mergePage('requests', { items: head, nextCursor: 'next', hasMore: true, total: 7 });
    store.mergePage('requests', { items: [loaded, request('older', 'unanswered')], nextCursor: null, hasMore: false, total: 7 });
    const ids = store.getSnapshot().requests.map(row => row.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.includes('open') && ids.includes('unseen') && ids.includes('older'));
    assert.equal(store.getSnapshot().totals?.requests, 7);
    assert.equal(ids.length, 7);
    assert.deepEqual(store.getSnapshot().history.requests, { cursor: null, more: false });
  } finally { store.dispose(); }
});
