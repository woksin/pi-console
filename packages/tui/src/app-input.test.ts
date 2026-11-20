import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectionToLoad, countsOf } from './app-input.ts';
import type { Data } from './store/store.ts';

test('history loads only for a list section at its end and outside a session', () => {
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: null }, true), 'sessions');
  assert.equal(collectionToLoad({ section: 'work', sessionId: null }, true), 'jobs');
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: null }, false), undefined);
  assert.equal(collectionToLoad({ section: 'fleet', sessionId: 's1' }, true), undefined);
  assert.equal(collectionToLoad({ section: 'timeline', sessionId: null }, true), undefined);
});

test('counts prefer the daemon totals and fall back to what is loaded, in display order', () => {
  const data = { sessions: [1, 2], requests: [1], questions: [], messages: [1], jobs: [1, 2, 3], resets: [1], needsYou: [1, 2], totals: null } as unknown as Data;
  assert.deepEqual(Object.entries(countsOf(data)), [['sessions', 2], ['requests', 1], ['questions', 0], ['messages', 1], ['jobs', 3], ['resets', 1], ['needs you', 2]]);
  const bounded = { ...data, totals: { sessions: 50, requests: 9, questions: 8, messages: 7, jobs: 6 } } as unknown as Data;
  assert.deepEqual(Object.values(countsOf(bounded)), [50, 9, 8, 7, 6, 1, 2]);
});
