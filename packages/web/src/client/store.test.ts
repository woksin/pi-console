import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import type { Event, MemoryItem, SessionMemory, SessionUpdate, TranscriptEntry } from '@pi-console/contract';
import { clockNow } from '../app/hooks.ts';
import { ConsoleStore, reconnectDelays, staleAfterMs, type Clock } from './store.ts';
import { createApi, type Api } from './api.ts';

const clock: Clock = { now: () => 0, setTimeout: () => 0, clearTimeout: () => undefined };

const entry = (cursor: number): TranscriptEntry => ({
  id: `e${String(cursor)}`, cursor, sessionId: 's1', at: '2026-01-01T00:00:00.000Z', kind: 'assistant', text: `line ${String(cursor)}`,
  toolCallId: null, resetId: null, requestId: null, toolResult: null,
});

/** A daemon with `total` entries, served by the real paging contract (`after` cursor, `limit`, `hasMore`). */
function history(total: number, failFirst = 0): { api: Api; calls: () => number } {
  let calls = 0;
  const api = {
    transcript: (_session: string, after: number | undefined, limit: number, options?: { order?: string }) => {
      calls++;
      if (calls <= failFirst) return Promise.reject(new Error('unreachable'));
      const descending = options?.order === 'desc';
      const end = descending ? (after ?? total + 1) - 1 : Math.min(total, (after ?? 0) + limit);
      const start = descending ? Math.max(1, end - limit + 1) : (after ?? 0) + 1;
      const items = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => entry(start + index));
      return Promise.resolve({ items, nextCursor: descending ? start : end, hasMore: descending ? start > 1 : end < total });
    },
  } as unknown as Api;
  return { api, calls: () => calls };
}

test('opening a long session fetches just one descending tail page', async () => {
  const { api, calls } = history(6000);
  const store = new ConsoleStore(api, clock);
  await store.loadTranscript('s1');
  const loaded = store.getState().transcripts.s1 ?? [];
  assert.equal(calls(), 1);
  assert.equal(loaded.length, 500);
  assert.equal(loaded.at(-1)?.cursor, 6000, 'the tail is present');
  assert.equal(loaded[0]?.cursor, 5501);
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

function windowedSnapshot(jobs: ReturnType<typeof job>[], total: number): Extract<Event, { type: 'snapshot' }> {
  const base = { version: 0 as const, generatedAt: '2026-06-01T00:00:00.000Z', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs, resets: [], transcriptCursors: [], interventions: [] };
  return { seq: 5, type: 'snapshot' as const, occurredAt: base.generatedAt, payload: { ...base, totals: { sessions: 0, requests: 0, questions: 0, messages: 0, jobs: total, resets: 0 }, bounded: ['jobs' as const] } };
}

function snapshotStream(snapshot: ReturnType<typeof windowedSnapshot>): Api['stream'] {
  return (_seq, _signal, onFrame) => { onFrame(snapshot); return new Promise<void>(() => undefined); };
}

test('a windowed snapshot is paged older-ward on request; pages merge without duplicates and end the paging', async () => {
  const older = [job('j3', 'done', '2026-01-03T00:00:00Z'), job('j2', 'done', '2026-01-02T00:00:00Z')];
  const calls: unknown[] = [];
  const snapshot = windowedSnapshot([job('j4', 'running', '2026-01-04T00:00:00Z'), job('j3', 'done', '2026-01-03T00:00:00Z')], 4);
  const api = {
    page: (_name: string, params: unknown) => { calls.push(params); return Promise.resolve({ ...emptyList, items: older, total: 4 }); },
    stream: snapshotStream(snapshot),
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
  let pending = Promise.withResolvers<[]>();
  let calls = 0;
  const api = {
    needsYou: () => { calls++; return pending.promise; }, health: () => Promise.resolve(null),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  assert.equal(store.getState().needsYouLoaded, false);
  const first = store.refresh();
  assert.equal(store.getState().needsYouError, false, 'pending is not a failure');
  pending.reject(new Error('offline'));
  await first;
  assert.equal(store.getState().needsYouLoaded, false, 'a failed fetch is not a loaded list');
  assert.equal(store.getState().needsYouError, true);
  pending = Promise.withResolvers<[]>();
  const retry = store.refresh();
  assert.equal(calls, 2, 'retry re-issues the same fetch');
  assert.equal(store.getState().needsYouError, false, 'retry clears the error while loading');
  assert.equal(store.getState().needsYouLoaded, false);
  pending.resolve([]);
  await retry;
  assert.equal(store.getState().needsYouLoaded, true);
  pending = Promise.withResolvers<[]>();
  const refresh = store.refresh();
  pending.reject(new Error('offline again'));
  await refresh;
  assert.equal(store.getState().needsYouLoaded, false, 'a later failure invalidates the calm state');
  assert.equal(store.getState().needsYouError, true);
  store.stop();
});

test('a complete (unbounded) snapshot never pages', async () => {
  let calls = 0;
  const store = new ConsoleStore({ page: () => { calls++; return Promise.resolve(null); } } as unknown as Api, clock);
  await store.loadMore('jobs');
  assert.equal(calls, 0);
});

const memorySummary = (sessionId: SessionMemory['sessionId']): SessionMemory => ({
  sessionId, storeDetected: true,
  counts: { active: 0, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 0 },
  proposedConfirmable: 1, unresolved: { lowerBound: 2, atLastHandoff: null }, wider: 0, handoffs: [],
});
const proposedItem: MemoryItem = {
  id: 'item-1', sessionId: 's1', kind: 'order', scope: { kind: 'session', key: 's1' },
  status: 'proposed', statusBasis: 'recorded', text: 'synthetic order', withheld: false,
  sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-01-01T00:00:00.000Z', command: '/memory confirm item-1',
};

test('visible memory loads canonical pairs and readiness once per watch, independent of other sessions', async () => {
  const summaries: string[] = [];
  const availabilityCalls: string[] = [];
  const itemCalls: unknown[] = [];
  const api = {
    memoryActionAvailability: (sessionId: SessionMemory['sessionId']) => { availabilityCalls.push(sessionId); return Promise.resolve(null); },
    sessionMemory: (sessionId: SessionMemory['sessionId']) => { summaries.push(sessionId); return Promise.resolve(memorySummary(sessionId)); },
    memoryItems: (sessionId: SessionMemory['sessionId'], limit: Parameters<Api['memoryItems']>[1]) => { itemCalls.push([sessionId, limit]); return Promise.resolve([proposedItem]); },
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  const close = store.watchSessionMemory('s1');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
  const closeSecond = store.watchSessionMemory('s2');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  close(); store.watchSessionMemory('s1');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.deepEqual(summaries, ['s1', 's2', 's1']);
  assert.deepEqual(itemCalls, [['s1', 100], ['s2', 100], ['s1', 100]]);
  assert.deepEqual(availabilityCalls, ['s1', 's2', 's1']);
  assert.deepEqual(store.getState().memory.s2, memorySummary('s2'));
  closeSecond(); store.stop();
});

function lifecycleStream() {
  const emitters: ((frame: unknown) => void)[] = [];
  const signals: AbortSignal[] = [];
  const disconnects: (() => void)[] = [];
  const lastEventIds: number[] = [];
  const stream: Api['stream'] = (seq, signal, onFrame) => {
    emitters.push(frame => { onFrame(frame as Parameters<typeof onFrame>[0]); });
    signals.push(signal);
    lastEventIds.push(seq);
    return new Promise<void>(resolve => { disconnects.push(resolve); signal.addEventListener('abort', () => { resolve(); }, { once: true }); });
  };
  return { stream, emitters, signals, disconnects, lastEventIds };
}

const settle = () => new Promise<void>(resolve => { setImmediate(resolve); });

function streamingStore(context: TestContext, overrides: object = {}) {
  context.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 0 });
  const connection = lifecycleStream();
  const api = { needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null), stream: connection.stream, ...overrides } as unknown as Api;
  const store = new ConsoleStore(api, {
    now: () => Date.now(),
    setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as number,
    clearTimeout: timer => { clearTimeout(timer); },
  });
  context.after(() => { store.stop(); });
  store.start();
  return { store, ...connection, tick: async (ms: number) => { context.mock.timers.tick(ms); await settle(); } };
}

test('a silent first connection is aborted and retried with backoff on every attempt', async t => {
  const { store, signals, tick } = streamingStore(t);
  for (let attempt = 0; attempt < 2; attempt++) {
    await tick(staleAfterMs);
    assert.equal(signals[attempt].aborted, false);
    await tick(staleAfterMs / 3);
    assert.equal(signals[attempt].aborted, true, 'even an attempt with no first frame must time out');
    assert.equal(store.getState().connection, 'offline');
    await tick(reconnectDelays[attempt] - 1);
    assert.equal(signals.length, attempt + 1, 'the existing backoff is respected');
    await tick(1);
    assert.equal(signals.length, attempt + 2);
    assert.equal(store.getState().connection, 'connecting');
  }
});

test('every frame resets stream silence and a reconnect gets its own full silence window', async t => {
  const { store, signals, emitters, tick } = streamingStore(t);
  emitters[0]('heartbeat');
  await tick(30_000);
  emitters[0]('heartbeat');
  await tick(30_000);
  assert.equal(signals[0].aborted, false, 'recent frames extend the first attempt');
  await tick(30_000);
  assert.equal(signals[0].aborted, true);
  await tick(reconnectDelays[0]);
  const current = store.getState();
  emitters[0]('heartbeat');
  assert.equal(store.getState(), current, 'an aborted attempt cannot send late frames');
  await tick(staleAfterMs);
  assert.equal(signals[1].aborted, false, 'the previous attempt\'s last frame is not the new baseline');
  await tick(staleAfterMs / 3);
  assert.equal(signals[1].aborted, true);
});

test('snapshot time keeps advancing without rewinding when only heartbeats arrive', async t => {
  const { store, emitters, tick } = streamingStore(t);
  await tick(1000);
  emitters[0](windowedSnapshot([], 0));
  const started = clockNow(store.getState(), Date.now());
  const eventTime = store.getState().liveAt;
  let previous = started;
  for (let heartbeat = 1; heartbeat <= 3; heartbeat++) {
    await tick(10_000);
    const before = clockNow(store.getState(), Date.now());
    emitters[0]('heartbeat');
    const after = clockNow(store.getState(), Date.now());
    assert.equal(after, before, 'a heartbeat must not rewind the displayed time');
    assert.equal(after, started + heartbeat * 10_000);
    assert.ok(after > previous, 'ages advance on a quiet stream');
    assert.equal(store.getState().liveAt, eventTime, 'transport activity does not advance event time');
    assert.equal(store.getState().lastFrameAt, Date.now(), 'heartbeats still update transport liveness');
    previous = after;
  }
});

test('the event-time clock anchors at wall time zero and untimed deltas do not reset it', async t => {
  const { store, emitters, tick } = streamingStore(t, { page: () => Promise.resolve({ ...emptyList, total: 1 }) });
  const snapshot = windowedSnapshot([], 0);
  assert.equal(clockNow(store.getState(), Date.now()), 0, 'before an event, use wall time');
  emitters[0](snapshot);
  const eventTime = Date.parse(snapshot.payload.generatedAt);
  assert.equal(clockNow(store.getState(), Date.now()), eventTime);
  await tick(1000);
  emitters[0]({ seq: 6, type: 'job.updated', occurredAt: snapshot.occurredAt, payload: job('j1', 'running', snapshot.occurredAt) });
  assert.equal(clockNow(store.getState(), Date.now()), eventTime + 1000);
  await tick(1000);
  emitters[0]({ seq: 7, type: 'transcript.appended', occurredAt: snapshot.occurredAt, payload: entry(1) });
  assert.equal(clockNow(store.getState(), Date.now()), eventTime + 2000, 'an older entity timestamp is not a new clock anchor');
  const later = { ...entry(2), at: new Date(eventTime + 10_000).toISOString() };
  emitters[0]({ seq: 8, type: 'transcript.appended', occurredAt: later.at, payload: later });
  assert.equal(clockNow(store.getState(), Date.now()), eventTime + 10_000, 'a newer event establishes a new anchor');
  await tick(1000);
  assert.equal(clockNow(store.getState(), Date.now()), eventTime + 11_000);
});

test('heartbeat-only resumes retry failed attention and health reads exactly once per live transition', async t => {
  const attention = (id: string): Awaited<ReturnType<Api['needsYou']>> => [{ id, reason: 'blocking-question', sessionId: 's1', laneId: null, text: id, since: '2026-01-01T00:00:00Z', pointer: null }];
  let needsYou = attention('old');
  let health = { status: 'old' };
  let fail = false;
  const calls = { attention: 0, health: 0 };
  const { store, emitters, disconnects, lastEventIds, tick } = streamingStore(t, {
    needsYou: () => { calls.attention++; return fail ? Promise.reject(new Error('offline')) : Promise.resolve(needsYou); },
    health: () => { calls.health++; return fail ? Promise.reject(new Error('offline')) : Promise.resolve(health); },
  });
  const snapshot = windowedSnapshot([], 0);
  emitters[0](snapshot);
  await tick(350);
  assert.deepEqual(calls, { attention: 1, health: 1 });
  fail = true;
  await store.refresh();
  assert.equal(store.getState().needsYouError, true);
  assert.deepEqual(store.getState().needsYou, needsYou, 'failed reads keep the old attention list');
  assert.deepEqual(store.getState().health, health, 'failed reads keep the old health');
  fail = false;
  const gapCount = store.getState().gapCount;
  for (let transition = 1; transition <= 2; transition++) {
    needsYou = attention(`fresh-${String(transition)}`);
    health = { status: `fresh-${String(transition)}` };
    disconnects[transition - 1]();
    await settle();
    assert.equal(store.getState().connection, 'offline');
    await tick(reconnectDelays[0]);
    assert.equal(store.getState().connection, 'reconnecting');
    emitters[transition]('heartbeat');
    assert.equal(store.getState().connection, 'live');
    await tick(349);
    assert.deepEqual(calls, { attention: transition + 1, health: transition + 1 }, 'resume refresh is debounced');
    emitters[transition]('heartbeat');
    await tick(1);
    assert.deepEqual(calls, { attention: transition + 2, health: transition + 2 });
    assert.deepEqual(store.getState().needsYou, needsYou);
    assert.deepEqual(store.getState().health, health);
    assert.equal(store.getState().needsYouLoaded, true);
    assert.equal(store.getState().needsYouError, false);
    emitters[transition]('heartbeat');
    await tick(1000);
    assert.deepEqual(calls, { attention: transition + 2, health: transition + 2 }, 'live heartbeats do not refresh again');
    assert.equal(lastEventIds[transition], snapshot.seq);
    assert.equal(store.getState().gapCount, gapCount, 'recovery does not need another snapshot');
  }
});

test('pending detail, tail and memory finish after a resumable reconnect; older transcript pages stay explicit', async t => {
  const detail = Promise.withResolvers<Awaited<ReturnType<Api['session']>>>();
  const transcript = Promise.withResolvers<Awaited<ReturnType<Api['transcript']>>>();
  const transcriptQueries: Parameters<Api['transcript']>[] = [];
  const memory = Promise.withResolvers<SessionMemory>();
  const calls = { detail: 0, transcript: 0, memory: 0 };
  const session = { id: 's1', repositoryId: 'r', name: '', laneId: 'l', role: 'main' as const, parentSessionId: null, orchestratorSessionId: 's1',
    branch: '', cwd: '', model: '', status: 'idle' as const, startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [] };
  const { store, emitters, lastEventIds, tick } = streamingStore(t, {
    session: () => { calls.detail++; return detail.promise; },
    transcript: (...params: Parameters<Api['transcript']>) => {
      transcriptQueries.push(params); calls.transcript++;
      return calls.transcript === 1 ? transcript.promise : Promise.resolve({ items: [entry(1)], nextCursor: 1, hasMore: false });
    },
    sessionMemory: () => { calls.memory++; return memory.promise; }, memoryItems: () => Promise.resolve([proposedItem]),
  });
  const snapshot = windowedSnapshot([], 0);
  emitters[0]({ ...snapshot, payload: { ...snapshot.payload, sessions: [session] } });
  const gapCount = store.getState().gapCount;
  const pending = [store.loadSessionDetail('s1'), store.loadTranscript('s1'), store.loadSessionMemory('s1')];
  const clockAnchor = store.getState().liveAtReceivedAt;
  await tick(staleAfterMs + staleAfterMs / 3);
  assert.equal(store.getState().connection, 'offline');
  await tick(reconnectDelays[0]);
  const beforeResume = clockNow(store.getState(), Date.now());
  emitters[1]('heartbeat');
  assert.equal(store.getState().liveAtReceivedAt, clockAnchor, 'resume does not reset the event-time anchor');
  assert.equal(clockNow(store.getState(), Date.now()), beforeResume, 'resume does not rewind the displayed clock');
  assert.deepEqual(lastEventIds, [0, snapshot.seq]);
  assert.equal(store.getState().gapCount, gapCount, 'a resumed stream does not retrigger the session view effects');
  assert.equal(transcriptQueries[0][3]?.signal?.aborted, false, 'the in-flight tail read survives resume');
  detail.resolve({ session, jobs: [job('older', 'done', session.startedAt)], requests: [], questions: [], resets: [], subagents: [] });
  transcript.resolve({ items: [entry(2)], nextCursor: 2, hasMore: true });
  memory.resolve(memorySummary('s1'));
  await Promise.all(pending);
  assert.deepEqual(store.getState().jobs.map(item => item.id), ['older']);
  assert.deepEqual(store.getState().transcripts.s1, [entry(2)], 'the pending tail page completes without scanning older history');
  assert.equal(store.getState().transcriptHistory.s1.older, true, 'descending hasMore means older history is available');
  assert.deepEqual(transcriptQueries[0].slice(0, 3), ['s1', undefined, 500]);
  assert.equal(transcriptQueries[0][3]?.order, 'desc');
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
  assert.deepEqual(calls, { detail: 1, transcript: 1, memory: 1 }, 'the original reads complete without another view load');
  await store.pageTranscript('s1', 'older');
  assert.deepEqual(store.getState().transcripts.s1, [entry(1), entry(2)], 'older navigation still works after resume');
  assert.equal(transcriptQueries[1][1], 2);
  assert.equal(transcriptQueries[1][3]?.order, 'desc');
  assert.deepEqual(calls, { detail: 1, transcript: 2, memory: 1 }, 'only explicit navigation fetches another transcript page');
});

test('pending history stays deduplicated and completes across a resumable reconnect', async t => {
  const page = Promise.withResolvers<Awaited<ReturnType<Api['page']>>>();
  let calls = 0;
  const { store, emitters, disconnects, tick } = streamingStore(t, { page: () => { calls++; return page.promise; } });
  emitters[0](windowedSnapshot([], 1));
  const pending = store.loadMore('jobs');
  disconnects[0]();
  await settle();
  await tick(reconnectDelays[0]);
  emitters[1]('heartbeat');
  assert.equal(store.loadMore('jobs'), pending, 'resume keeps the same pending history request');
  page.resolve({ ...emptyList, items: [job('older', 'done', '2026-01-01T00:00:00Z')], total: 1 });
  await pending;
  assert.equal(calls, 1);
  assert.deepEqual(store.getState().jobs.map(item => item.id), ['older']);
  assert.equal(store.getState().history.jobs?.more, false);
});

test('dirty totals and their debounced derived refresh survive a disconnect and snapshot-free resume', async t => {
  const page = Promise.withResolvers<Awaited<ReturnType<Api['page']>>>();
  const pageParams: unknown[] = [];
  let attentionCalls = 0;
  let healthCalls = 0;
  const { store, emitters, disconnects, lastEventIds, tick } = streamingStore(t, {
    page: (_name: string, params: unknown) => { pageParams.push(params); return page.promise; },
    needsYou: () => { attentionCalls++; return Promise.resolve([]); }, health: () => { healthCalls++; return Promise.resolve(null); },
  });
  emitters[0](windowedSnapshot([], 0));
  await tick(350);
  emitters[0]({ seq: 6, type: 'job.updated', occurredAt: '2026-01-01T00:00:00Z', payload: job('j1', 'running', '2026-01-01T00:00:00Z') });
  const gapCount = store.getState().gapCount;
  disconnects[0]();
  await settle();
  await tick(349);
  assert.equal(attentionCalls, 1, 'the pending refresh is still debounced');
  await tick(1);
  assert.deepEqual(pageParams, [{ limit: 1 }], 'the dirty total still causes a request');
  await tick(reconnectDelays[0] - 350);
  emitters[1]('heartbeat');
  assert.deepEqual(lastEventIds, [0, 6]);
  assert.equal(store.getState().gapCount, gapCount);
  page.resolve({ ...emptyList, total: 1 });
  await settle();
  assert.equal(store.getState().jobs.length, 1);
  assert.equal(store.getState().totals?.jobs, 1, 'the in-flight total refresh remains valid after resume');
  assert.equal(attentionCalls, 2);
  assert.equal(healthCalls, 2, 'the same refresh also updates the derived models');
});

test('a late history page cannot undo a newer snapshot or exhaust its paging', async t => {
  const oldPage = Promise.withResolvers<Awaited<ReturnType<Api['page']>>>();
  let calls = 0;
  const { store, emitters } = streamingStore(t, { page: () => { calls++; return calls === 1 ? oldPage.promise : Promise.resolve({ ...emptyList, total: 2 }); } });
  emitters[0](windowedSnapshot([], 1));
  const pending = store.loadMore('jobs');
  emitters[0]({ ...windowedSnapshot([], 2), seq: 9 });
  oldPage.resolve({ ...emptyList, items: [job('obsolete', 'done', '2026-01-01T00:00:00Z')], total: 1 });
  await pending;
  assert.equal(store.getState().totals?.jobs, 2);
  assert.equal(store.getState().history.jobs, undefined);
  assert.deepEqual(store.getState().jobs, []);
  await store.loadMore('jobs');
  assert.equal(calls, 2, 'the recovered history remains loadable');
});

for (const boundary of ['snapshot', 'restart'] as const) test(`old paging cleanup cannot remove the pending request after a ${boundary}`, async t => {
  const pages = Array.from({ length: 3 }, () => Promise.withResolvers<Awaited<ReturnType<Api['page']>>>());
  let calls = 0;
  const { store, emitters } = streamingStore(t, { page: () => pages[calls++].promise });
  emitters[0](windowedSnapshot([], 1));
  const old = store.loadMore('jobs');
  if (boundary === 'snapshot') emitters[0]({ ...windowedSnapshot([], 2), seq: 9 });
  if (boundary === 'restart') { store.stop(); store.start(); }
  const current = store.loadMore('jobs');
  assert.equal(calls, 2, 'a new generation never shares the old pending request');
  const state = store.getState();
  pages[0].resolve({ ...emptyList, total: 999 });
  await old;
  assert.equal(store.getState(), state, 'the old result is discarded');
  assert.equal(store.loadMore('jobs'), current, 'old cleanup leaves the current request registered');
  assert.equal(calls, 2);
  pages[1].resolve({ ...emptyList, total: 2 });
  await current;
  assert.equal(store.getState().totals?.jobs, 2);
});

test('late transcript history is discarded and cannot issue another page after a resnapshot', async t => {
  const oldPage = Promise.withResolvers<Awaited<ReturnType<Api['transcript']>>>();
  let calls = 0;
  const { store, emitters } = streamingStore(t, { transcript: () => { calls++; return calls === 1 ? oldPage.promise : Promise.resolve({ items: [entry(2)], nextCursor: 2, hasMore: false }); } });
  emitters[0](windowedSnapshot([], 0));
  const old = store.loadTranscript('s1');
  emitters[0]({ ...windowedSnapshot([], 0), seq: 9 });
  oldPage.resolve({ items: [entry(1)], nextCursor: 1, hasMore: true });
  await old;
  assert.equal(calls, 1, 'a stale pagination loop stops');
  assert.deepEqual(store.getState().transcripts.s1 ?? [], []);
  await store.loadTranscript('s1');
  assert.deepEqual(store.getState().transcripts.s1, [entry(2)]);
});

test('old detail failures cannot uncache the current generation\'s session detail', async t => {
  const details = Array.from({ length: 2 }, () => Promise.withResolvers<Awaited<ReturnType<Api['session']>>>());
  let calls = 0;
  const { store, emitters } = streamingStore(t, { session: () => details[calls++].promise });
  emitters[0](windowedSnapshot([], 0));
  const old = store.loadSessionDetail('s1');
  store.stop(); store.start();
  const current = store.loadSessionDetail('s1');
  assert.equal(calls, 2);
  details[0].reject(new Error('offline'));
  await old;
  assert.equal(store.loadSessionDetail('s1'), current);
  details[1].resolve(null);
  await current;
});

test('derived refreshes are scoped to the snapshot and old cleanup does not unlock a current refresh', async t => {
  const reads = Array.from({ length: 3 }, () => Promise.withResolvers<Awaited<ReturnType<Api['needsYou']>>>());
  let calls = 0;
  const { store, emitters } = streamingStore(t, { needsYou: () => reads[calls++].promise });
  emitters[0](windowedSnapshot([], 0));
  const old = store.refresh();
  emitters[0]({ ...windowedSnapshot([], 0), seq: 9 });
  const current = store.refresh();
  assert.equal(calls, 2, 'the new generation does not wait for a stale refresh');
  const state = store.getState();
  reads[0].reject(new Error('offline'));
  await old;
  assert.equal(store.getState(), state, 'a stale failure cannot change the attention baseline');
  await store.refresh();
  assert.equal(calls, 2, 'a current refresh is still in flight');
  reads[1].resolve([]);
  await settle();
  assert.equal(calls, 3, 'the current generation keeps its trailing refresh');
  reads[2].resolve([]);
  await current;
});

test('late total refreshes cannot replace the totals of a resnapshot', async t => {
  const page = Promise.withResolvers<Awaited<ReturnType<Api['page']>>>();
  let calls = 0;
  const { store, emitters } = streamingStore(t, { page: () => { calls++; return page.promise; } });
  emitters[0](windowedSnapshot([], 1));
  emitters[0]({ seq: 6, type: 'job.updated', occurredAt: '2026-01-01T00:00:00Z', payload: job('j1', 'running', '2026-01-01T00:00:00Z') });
  const pending = store.refresh();
  await settle();
  assert.equal(calls, 1);
  emitters[0]({ ...windowedSnapshot([], 2), seq: 9 });
  const state = store.getState();
  page.resolve({ ...emptyList, total: 999 });
  await pending;
  assert.equal(store.getState(), state);
});

test('a resnapshot also discards an in-flight canonical memory pair', async t => {
  const summary = Promise.withResolvers<SessionMemory>();
  const { store, emitters } = streamingStore(t, { sessionMemory: () => summary.promise, memoryItems: () => Promise.resolve([proposedItem]) });
  emitters[0](windowedSnapshot([], 0));
  const pending = store.loadSessionMemory('s1');
  emitters[0]({ ...windowedSnapshot([], 0), seq: 9 });
  const state = store.getState();
  summary.resolve(memorySummary('s1'));
  await pending;
  assert.equal(store.getState(), state);
});

test('StrictMode start-stop-start recreates review tracking without replaying a POST or accepting stale frames', async () => {
  const { stream, emitters, signals } = lifecycleStream();
  let availabilityCalls = 0;
  let posts = 0;
  const api = {
    stream,
    memoryActionAvailability: () => { availabilityCalls++; return Promise.resolve({ version: 1, available: true, providerVersion: 1, generation: 'g1', reason: 'available' }); },
    sessionMemory: () => Promise.resolve(memorySummary('s1')),
    memoryItems: () => Promise.resolve([proposedItem]),
    requestMemoryAction: (_id: unknown, request: object) => { posts++; return Promise.resolve({ ...request, state: 'declined', reason: 'cancelled', eventId: null }); },
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  store.start(); store.stop(); store.start();
  store.watchSessionMemory('s1');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(availabilityCalls, 1);
  assert.equal(store.getState().memoryReviews.get('s1')?.availability?.available, true);
  assert.equal(posts, 0);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  const current = store.getState();
  emitters[0]({ ...windowedSnapshot([], 0), seq: 99 });
  assert.equal(store.getState(), current, 'the disposed stream cannot overwrite the restarted store');
  await store.requestMemoryAction('s1', proposedItem.id, 'confirm');
  assert.equal(posts, 1, 'review remains actionable after StrictMode restart');
  store.stop(); store.start();
  await store.loadSessionMemory('s1');
  assert.equal(posts, 1, 'restart only reloads availability, never redispatches review');
  store.stop();
});

test('a resnapshot invalidates visible memory without touching hidden sessions', async () => {
  let emit: (frame: unknown) => void = () => undefined;
  let calls = 0;
  const api = {
    stream: (_seq: number, _signal: AbortSignal, onFrame: (frame: unknown) => void) => { emit = onFrame; onFrame(windowedSnapshot([], 0)); return new Promise<void>(() => undefined); },
    sessionMemory: () => { calls++; return Promise.resolve(memorySummary('s1')); },
    memoryItems: () => Promise.resolve([proposedItem]),
    needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null),
  } as unknown as Api;
  const timers = new Map<number, () => void>();
  let key = 0;
  const store = new ConsoleStore(api, { ...clock, setTimeout: callback => { timers.set(++key, callback); return key; }, clearTimeout: token => { timers.delete(token); } });
  store.start(); store.watchSessionMemory('s1');
  await new Promise<void>(resolve => { setImmediate(resolve); });
  assert.equal(calls, 1);
  emit({ ...windowedSnapshot([], 0), seq: 9 });
  const pending = [...timers.values()]; timers.clear();
  for (const callback of pending) callback();
  await new Promise<void>(resolve => { setImmediate(resolve); });
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
  now = 5000;
  fail = true;
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'error', message: 'unreachable' });
  assert.equal(store.getState().memory.s1, good.memory.s1);
  assert.equal(store.getState().memoryItems.s1, good.memoryItems.s1);
  fail = false;
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loaded' });
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
  now = 5000;
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'error', message: 'unreachable' });
  assert.equal(store.getState().memory.s1, good.memory.s1);
  assert.equal(store.getState().memoryItems.s1, good.memoryItems.s1);
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loaded' });
  assert.equal(calls, 3);
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
});

for (const endpoint of ['summary', 'items']) test(`a delayed ${endpoint} failure is loading, then error, and a successful retry replaces it`, async () => {
  const pending = Promise.withResolvers<Response>();
  let fail = true;
  const api = createApi('token', '', url => {
    const summary = typeof url === 'string' && url.includes('/sessions/');
    if (fail && summary === (endpoint === 'summary')) return pending.promise;
    return Promise.resolve(Response.json(summary ? memorySummary('s1') : { items: [proposedItem] }));
  });
  const store = new ConsoleStore(api, clock);
  const first = store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loading' });
  pending.resolve(new Response(null, { status: 503 }));
  await first;
  const status = store.getState().memoryStatus.s1;
  assert.equal(status?.status, 'error');
  assert.match(status?.status === 'error' ? status.message : '', /503/);
  assert.equal(store.getState().memory.s1, undefined);
  assert.equal(store.getState().memoryItems.s1, undefined);
  fail = false;
  const retry = store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loading' });
  await retry;
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loaded' });
  assert.deepEqual(store.getState().memory.s1, memorySummary('s1'));
  assert.deepEqual(store.getState().memoryItems.s1, [proposedItem]);
});

test('only a successful canonical read with storeDetected false confirms absence', async () => {
  const absent = { ...memorySummary('s1'), storeDetected: false };
  const api = { sessionMemory: () => Promise.resolve(absent), memoryItems: () => Promise.resolve([]) } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'absent' });
  assert.deepEqual(store.getState().memory.s1, absent);
  assert.deepEqual(store.getState().memoryItems.s1, []);
});

for (const endpoint of ['summary', 'items']) test(`a missing ${endpoint} endpoint is an error, not a confirmed absent store`, async () => {
  const api = createApi('token', '', url => {
    const summary = typeof url === 'string' && url.includes('/sessions/');
    return Promise.resolve(summary === (endpoint === 'summary') ? new Response(null, { status: 404 }) : Response.json(summary ? memorySummary('s1') : { items: [] }));
  });
  const store = new ConsoleStore(api, clock);
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'error', message: 'Memory endpoints unavailable.' });
});

test('a synchronous memory transport failure is recorded and retryable', async () => {
  let fail = true;
  const api = {
    sessionMemory: () => { if (fail) throw new Error('offline'); return Promise.resolve(memorySummary('s1')); },
    memoryItems: () => Promise.resolve([]),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'error', message: 'offline' });
  fail = false;
  await store.loadSessionMemory('s1');
  assert.deepEqual(store.getState().memoryStatus.s1, { status: 'loaded' });
});

test('only marked visible session updates refetch; replacement clears stale rows and marker never persists', async () => {
  let emit!: (event: Event) => void;
  let calls = 0;
  let items = [proposedItem];
  const timers = new Map<number, () => void>(); let key = 0;
  const api = {
    stream: (_seq: Event['seq'], _signal: AbortSignal, event: (frame: Event) => void) => { emit = event; return new Promise(() => undefined); },
    needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null),
    sessionMemory: (id: SessionMemory['sessionId']) => { calls++; return Promise.resolve(memorySummary(id)); },
    memoryItems: () => Promise.resolve(items), memoryAvailability: () => Promise.reject(new Error('unavailable')),
  } as unknown as Api;
  const store = new ConsoleStore(api, { ...clock, setTimeout: callback => { timers.set(++key, callback); return key; }, clearTimeout: token => { timers.delete(token); } });
  const session = { id: 's1', repositoryId: 'r', name: '', laneId: 'l', role: 'main' as const, parentSessionId: null, orchestratorSessionId: 's1',
    branch: '', cwd: '', model: '', status: 'idle' as const, startedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', contextPercent: 0, samples: [] };
  const send = (seq: Event['seq'], payload: Partial<SessionUpdate>) => { emit({ seq, type: 'session.updated', occurredAt: session.updatedAt, payload: { ...session, ...payload } }); };
  const settle = () => new Promise<void>(resolve => { setImmediate(resolve); });
  const tick = async () => { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); await settle(); };
  store.start(); send(1, { memoryChanged: true }); await tick();
  assert.equal(calls, 0, 'hidden marker does no memory work');
  const close = store.watchSessionMemory('s1'); await settle();
  assert.equal(calls, 1);
  send(2, {}); send(3, { id: 's2', memoryChanged: true }); await tick();
  assert.equal(calls, 1, 'heartbeat and sibling marker do no memory work');
  items = [];
  for (let seq = 4; seq < 30; seq++) send(seq, { memoryChanged: true });
  await tick();
  assert.equal(calls, 2);
  assert.deepEqual(store.getState().memoryItems.s1, []);
  assert.equal(Object.hasOwn(store.getState().sessions[0], 'memoryChanged'), false);
  close(); send(30, { memoryChanged: true }); await tick();
  assert.equal(calls, 2);
  store.stop();
});

test('stop and restart generations reject late memory responses', async () => {
  let resolve!: (summary: SessionMemory) => void;
  let calls = 0;
  const api = {
    sessionMemory: () => { calls++; return calls === 1 ? new Promise<SessionMemory>(done => { resolve = done; }) : Promise.resolve(memorySummary('s1')); },
    memoryItems: () => Promise.resolve([proposedItem]), needsYou: () => Promise.resolve([]), health: () => Promise.resolve(null),
    stream: () => new Promise(() => undefined),
  } as unknown as Api;
  const store = new ConsoleStore(api, clock);
  const old = store.loadSessionMemory('s1'); store.stop(); store.start();
  await store.loadSessionMemory('s1');
  const current = store.getState(); resolve({ ...memorySummary('s1'), wider: 999 }); await old;
  assert.equal(store.getState(), current);
  store.stop();
});
