import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { SessionDetail, Snapshot, TranscriptEntry } from '@pi-console/contract';
import type { DaemonClient, TranscriptTail } from './api/client.ts';
import { Store } from './store/store.ts';
import { TranscriptLoader } from './transcript-loader.ts';

const pending = () => ({ signal: undefined as AbortSignal | undefined, detail: Promise.withResolvers<SessionDetail>(), tail: Promise.withResolvers<TranscriptTail>() });
const fixture = generate().fixture as unknown as Snapshot;
const detail = (id: string): SessionDetail => ({ session: { ...fixture.sessions[0], id }, requests: [], questions: [], jobs: [], resets: [], subagents: [] });

test('superseded backfills abort and cannot merge late success or failure; close and shutdown abort too', async () => {
  const requests = new Map<string, ReturnType<typeof pending>>();
  const request = (id: string, signal?: AbortSignal) => {
    const current = requests.get(id) ?? pending();
    current.signal = signal;
    requests.set(id, current);
    return current;
  };
  const client = {
    session: (id: string, signal?: AbortSignal) => request(id, signal).detail.promise,
    transcriptTail: (input: { sessionId: string; signal?: AbortSignal }) => request(input.sessionId, input.signal).tail.promise,
  } as unknown as DaemonClient;
  const store = new Store();
  const mergedDetails: string[] = [];
  const mergedTranscripts: { id: string; entries: readonly TranscriptEntry[] }[] = [];
  store.mergeDetail = value => { mergedDetails.push(value.session.id); };
  store.setTranscriptPage = (id, page) => { mergedTranscripts.push({ id, entries: page.items }); };
  const loader = new TranscriptLoader(store, client);
  try {
    loader.load('a');
    const a = requests.get('a')!;
    assert.ok(a.signal instanceof AbortSignal);
    const closeB = loader.load('b');
    assert.equal(a.signal.aborted, true);
    a.detail.resolve(detail('a'));
    a.tail.resolve({ entries: [], truncated: true });
    const b = requests.get('b')!;
    b.detail.resolve(detail('b'));
    b.tail.resolve({ entries: [], truncated: true });
    await Promise.all([a.detail.promise, a.tail.promise, b.detail.promise, b.tail.promise]);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(mergedDetails, ['b']);
    assert.deepEqual(mergedTranscripts, [{ id: 'b', entries: [] }]);
    closeB();
    const closeC = loader.load('c');
    closeC();
    const c = requests.get('c')!;
    assert.equal(c.signal!.aborted, true);
    c.detail.resolve(detail('c'));
    c.tail.reject(new Error('aborted load'));
    await Promise.allSettled([c.detail.promise, c.tail.promise]);
    assert.deepEqual(mergedDetails, ['b']);
    assert.equal(mergedTranscripts.length, 1, 'an aborted failure must not mark the transcript loaded');
    loader.load('d');
    loader.stop();
    assert.equal(requests.get('d')!.signal!.aborted, true);
  } finally { loader.stop(); store.dispose(); }
});
