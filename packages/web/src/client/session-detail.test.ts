import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Event, SessionDetail } from '@pi-console/contract';
import { createApi, type Api } from './api.ts';
import { ConsoleStore, type Clock } from './store.ts';

const clock: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };
const detail: SessionDetail = {
  session: {
    id: 's1', repositoryId: 'r1', name: 'Session one', laneId: 'L1', role: 'main', parentSessionId: null, orchestratorSessionId: 's1',
    branch: 'main', cwd: '/repo', model: 'model', status: 'idle', startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [],
  },
  requests: [], questions: [], jobs: [], resets: [], subagents: [],
};

function windowedStore(session: Api['session'], sessions: SessionDetail['session'][] = []) {
  const snapshot: Extract<Event, { type: 'snapshot' }> = {
    seq: 1, type: 'snapshot', occurredAt: '2026-01-01T00:00:00Z', payload: {
      version: 0, generatedAt: '2026-01-01T00:00:00Z', repositories: [], sessions, requests: [], questions: [], messages: [], jobs: [], resets: [], transcriptCursors: [], interventions: [], bounded: ['sessions'],
    },
  };
  let emit: (event: Event) => void = () => undefined;
  const store = new ConsoleStore({
    session,
    stream: (_seq, _signal, onFrame) => { emit = onFrame; onFrame(snapshot); return new Promise<void>(() => undefined); },
  } as Api, clock);
  store.start();
  return { store, resnapshot: () => { emit({ ...snapshot, seq: 2 }); } };
}

test('detail loading is observable, shared by concurrent opens, and cached after success', async () => {
  const pending = Promise.withResolvers<SessionDetail>();
  let calls = 0;
  const { store } = windowedStore(() => { calls++; return pending.promise; });
  let notifications = 0;
  store.subscribe(() => { notifications++; });
  assert.equal(store.getSessionDetailStatus('s1'), undefined);
  const load = store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'loading');
  assert.equal(notifications, 1);
  assert.equal(store.loadSessionDetail('s1'), load);
  pending.resolve(detail);
  await load;
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  assert.deepEqual(store.getState().sessions, [detail.session]);
  assert.equal(notifications, 2, 'status and merged detail arrive together');
  await store.loadSessionDetail('s1');
  assert.equal(calls, 1);
  store.stop();
});

test('a failed detail load can be retried, clears the error while pending, and recovers', async () => {
  let pending = Promise.withResolvers<SessionDetail>();
  let calls = 0;
  const { store } = windowedStore(() => { calls++; return pending.promise; });
  const first = store.loadSessionDetail('s1');
  pending.reject(new Error('offline'));
  await first;
  assert.equal(store.getSessionDetailStatus('s1'), 'failed');
  assert.deepEqual(store.getState().sessions, []);
  pending = Promise.withResolvers<SessionDetail>();
  const retry = store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'loading');
  await Promise.resolve();
  assert.equal(calls, 2);
  pending.resolve(detail);
  await retry;
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  store.stop();
});

test('failed detail requests preserve session data already in the snapshot', async () => {
  const { store } = windowedStore(() => Promise.reject(new Error('offline')), [detail.session]);
  await store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'failed');
  assert.deepEqual(store.getState().sessions, [detail.session]);
  store.stop();
});

test('a synchronous transport failure is retryable too', async () => {
  let calls = 0;
  const { store } = windowedStore(() => {
    if (++calls === 1) throw new Error('offline');
    return Promise.resolve(detail);
  });
  await store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'failed');
  await store.loadSessionDetail('s1');
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  assert.equal(calls, 2);
  store.stop();
});

for (const status of [401, 404, 503]) test(`HTTP ${String(status)} is ${status === 404 ? 'not-found' : 'failed'}, even without a bounded snapshot`, async () => {
  const api = createApi('token', '', async () => new Response(null, { status }));
  const store = new ConsoleStore(api, clock);
  await store.loadSessionDetail('missing');
  assert.equal(store.getSessionDetailStatus('missing'), status === 404 ? 'not-found' : 'failed');
  assert.equal(store.getSessionDetailStatus('other'), undefined, 'detail statuses are per session');
});

test('a known session in a complete snapshot still needs no detail request', async () => {
  let calls = 0;
  const store = new ConsoleStore({ session: () => { calls++; return Promise.resolve(detail); } } as unknown as Api, clock);
  await store.loadSessionDetail('s1');
  await store.loadSessionDetail('s1');
  assert.equal(calls, 1);
});

for (const outcome of ['success', 'not-found', 'failure'] as const) test(`a pre-gap detail ${outcome} cannot overwrite the new request`, async () => {
  const previous = Promise.withResolvers<SessionDetail | null>();
  const current = Promise.withResolvers<SessionDetail | null>();
  let calls = 0;
  const { store, resnapshot } = windowedStore(() => ++calls === 1 ? previous.promise : current.promise);
  const oldLoad = store.loadSessionDetail('s1');
  resnapshot();
  assert.equal(store.getSessionDetailStatus('s1'), undefined);
  const newLoad = store.loadSessionDetail('s1');
  if (outcome === 'failure') previous.reject(new Error('old failure'));
  else previous.resolve(outcome === 'success' ? detail : null);
  await oldLoad;
  assert.equal(store.getSessionDetailStatus('s1'), 'loading');
  assert.deepEqual(store.getState().sessions, [], 'obsolete detail is not merged');
  current.resolve(detail);
  await newLoad;
  assert.equal(store.getSessionDetailStatus('s1'), 'loaded');
  store.stop();
});
