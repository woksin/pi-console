import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Event, Reset, Snapshot, TranscriptEntry } from '@pi-console/contract';
import { Store } from './store.ts';
import { generate, needsYou } from '@pi-console/testkit';

const fixture = generate().fixture as unknown as { repositories: unknown[]; sessions: { id: string; name: string }[]; requests: unknown[]; questions: unknown[]; messages: unknown[]; jobs: unknown[]; resets: unknown[]; transcript: TranscriptEntry[] };

const entry = (id: string, cursor: number): TranscriptEntry => ({ ...fixture.transcript[0], id, cursor, sessionId: 's1' });
const snapshot = { seq: 1, type: 'snapshot', payload: { repositories: fixture.repositories, sessions: fixture.sessions, requests: fixture.requests, questions: fixture.questions, messages: fixture.messages, jobs: fixture.jobs, resets: fixture.resets } } as unknown as Event;
const settle = async (store: Store) => { store.flush(); await Promise.resolve(); };

const reset = (id: string): Reset => ({ id, sessionId: 's1', at: '2026-01-01T00:00:00Z', kind: 'compaction', carriedRequestIds: [], interruptedRequestIds: [] });
const resetSnapshot = (resets: Reset[]): Snapshot => ({
  version: 0, generatedAt: '2026-01-01T00:00:00Z', repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs: [], resets,
  transcriptCursors: [], interventions: [], totals: { sessions: 0, requests: 0, questions: 0, messages: 0, jobs: 0, resets: 3000 }, bounded: ['resets'],
});

test('reset pages and live rows survive a bounded reconnect without duplicates; complete snapshots replace them', () => {
  const store = new Store();
  store.apply({ seq: 1, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: resetSnapshot([reset('new')]) });
  store.mergePage('resets', { items: [reset('old'), reset('new')], nextCursor: null, hasMore: false, total: 3000 });
  store.apply({ seq: 2, occurredAt: '2026-01-01T00:00:00Z', type: 'reset.occurred', payload: reset('live') });
  store.apply({ seq: 3, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: resetSnapshot([]) });
  assert.deepEqual(store.getSnapshot().resets.map(row => row.id), ['live', 'new', 'old']);
  assert.equal(store.getSnapshot().totals?.resets, 3000);
  assert.deepEqual(store.getSnapshot().history, {});
  store.apply({ seq: 4, occurredAt: '2026-01-01T00:00:00Z', type: 'snapshot', payload: { ...resetSnapshot([]), bounded: [] } });
  assert.deepEqual(store.getSnapshot().resets, []);
  store.dispose();
});

test('attention cache availability survives failed refreshes without changing current-load semantics', () => {
  const store = new Store();
  const state = () => {
    const data = store.getSnapshot();
    return [data.needsYouLoaded, data.needsYouError, data.needsYouCached];
  };
  try {
    assert.deepEqual(state(), [false, false, false]);
    store.setNeedsYouError(true);
    assert.deepEqual(state(), [false, true, false], 'a failed first load has no cache');
    store.setNeedsYouError(false);
    assert.deepEqual(state(), [false, false, false]);
    for (const items of [[], needsYou(generate().fixture).items]) {
      store.setNeedsYou(items);
      assert.deepEqual(state(), [true, false, true]);
      store.setNeedsYouError(true);
      assert.deepEqual(state(), [false, true, true]);
      assert.deepEqual(store.getSnapshot().needsYou, items, 'empty and non-empty cached lists survive');
      store.setNeedsYouError(false);
      assert.deepEqual(state(), [false, false, true], 'a retry keeps its cache but is not yet current');
      store.setNeedsYou(items);
      assert.deepEqual(state(), [true, false, true]);
    }
  } finally { store.dispose(); }
});

test('a snapshot loads every collection and tracks the stream position', async () => {
  const store = new Store();
  store.apply(snapshot);
  await settle(store);
  const data = store.getSnapshot();
  assert.equal(data.loaded, true);
  assert.equal(data.sessions.length, fixture.sessions.length);
  assert.equal(data.connection.lastSeq, 1);
});

test('session updates upsert instead of duplicating', async () => {
  const store = new Store();
  store.apply(snapshot);
  const changed = { ...fixture.sessions[0], name: 'renamed' };
  store.apply({ seq: 2, type: 'session.updated', payload: changed } as unknown as Event);
  await settle(store);
  const data = store.getSnapshot();
  assert.equal(data.sessions.length, fixture.sessions.length);
  assert.equal(data.sessions.find(session => session.id === changed.id)?.name, 'renamed');
  assert.ok(data.fresh.has(changed.id));
});

test('updates are coalesced into one notification', async () => {
  const store = new Store();
  let notifications = 0;
  store.subscribe(() => { notifications += 1; });
  store.apply(snapshot);
  for (let seq = 2; seq < 50; seq++) store.apply({ seq, type: 'session.updated', payload: fixture.sessions[0] } as unknown as Event);
  await new Promise(resolve => setTimeout(resolve, 120));
  assert.equal(notifications, 1);
});

test('transcript pages merge without duplicates and an empty transcript still counts as loaded', async () => {
  const store = new Store();
  store.mergeTranscript('s1', [entry('a', 2), entry('b', 1)]);
  store.mergeTranscript('s1', [entry('a', 2), entry('c', 3)]);
  store.mergeTranscript('s9', []);
  await settle(store);
  const transcripts = store.getSnapshot().transcripts;
  assert.deepEqual(transcripts.get('s1')?.map(item => item.id), ['b', 'a', 'c']);
  assert.equal(transcripts.has('s9'), true);
});

test('connection state is recorded for the banner', async () => {
  const store = new Store();
  store.setConnection(false, 'refused');
  await settle(store);
  assert.deepEqual([store.getSnapshot().connection.connected, store.getSnapshot().connection.error], [false, 'refused']);
});

const jobAt = (id: string, status: string, startedAt: string) => ({ id, sessionId: 's1', kind: 'job', name: id, status, startedAt, exitCode: null });
const windowed = (jobs: unknown[], total: number) => ({
  seq: 3, type: 'snapshot', payload: { repositories: [], sessions: [], requests: [], questions: [], messages: [], jobs, resets: [], totals: { sessions: 0, requests: 0, questions: 0, messages: 0, jobs: total, resets: 0 }, bounded: ['jobs'] },
}) as unknown as Event;

test('a windowed snapshot keeps totals; a history page merges older rows once and records paging progress', async () => {
  const store = new Store();
  store.apply(windowed([jobAt('j4', 'running', '2026-01-04T00:00:00Z'), jobAt('j3', 'done', '2026-01-03T00:00:00Z')], 4));
  store.mergePage('jobs', { items: [jobAt('j3', 'done', '2026-01-03T00:00:00Z'), jobAt('j2', 'done', '2026-01-02T00:00:00Z')], nextCursor: null, hasMore: false, total: 4 });
  await settle(store);
  const data = store.getSnapshot();
  assert.deepEqual(data.jobs.map(job => job.id), ['j2', 'j3', 'j4']);
  assert.equal(data.totals?.jobs, 4);
  assert.deepEqual(data.history.jobs, { cursor: null, more: false });
});

test('a later windowed snapshot keeps loaded history and drops rows that stopped being active', async () => {
  const store = new Store();
  store.apply(windowed([jobAt('j4', 'running', '2026-01-04T00:00:00Z')], 4));
  store.mergePage('jobs', { items: [jobAt('j1', 'done', '2026-01-01T00:00:00Z')], nextCursor: 'c', hasMore: true, total: 4 });
  store.apply({ ...windowed([jobAt('j5', 'running', '2026-01-05T00:00:00Z')], 5), seq: 4 });
  await settle(store);
  assert.deepEqual(store.getSnapshot().jobs.map(job => job.id), ['j1', 'j5']);
});

test('a resnapshot voids exhausted paging progress', async () => {
  const store = new Store();
  store.apply(windowed([jobAt('j4', 'running', '2026-01-04T00:00:00Z')], 2));
  store.mergePage('jobs', { items: [jobAt('j1', 'done', '2026-01-01T00:00:00Z')], nextCursor: null, hasMore: false, total: 2 });
  store.apply({ ...windowed([jobAt('j5', 'running', '2026-01-05T00:00:00Z')], 3), seq: 4 });
  await settle(store);
  assert.deepEqual(store.getSnapshot().history, {});
});
