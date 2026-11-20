import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Event, TranscriptEntry } from '@pi-console/contract';
import { Store } from './store.ts';
import { generate } from '@pi-console/testkit';

const fixture = generate().fixture as unknown as { repositories: unknown[]; sessions: { id: string; name: string }[]; requests: unknown[]; questions: unknown[]; messages: unknown[]; jobs: unknown[]; resets: unknown[]; transcript: TranscriptEntry[] };

const entry = (id: string, cursor: number): TranscriptEntry => ({ ...fixture.transcript[0], id, cursor, sessionId: 's1' });
const snapshot = { seq: 1, type: 'snapshot', payload: { repositories: fixture.repositories, sessions: fixture.sessions, requests: fixture.requests, questions: fixture.questions, messages: fixture.messages, jobs: fixture.jobs, resets: fixture.resets } } as unknown as Event;
const settle = async (store: Store) => { store.flush(); await Promise.resolve(); };

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
