import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot, Transcript, TranscriptEntry } from '@pi-console/contract';
import type { DaemonClient, TranscriptQuery, TranscriptTail } from './api/client.ts';
import { Store } from './store/store.ts';
import { TranscriptLoader } from './transcript-loader.ts';
import { App } from './app.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const id = fixture.sessions[0].id;
const entries = (start: number, end: number): TranscriptEntry[] => Array.from({ length: end - start + 1 }, (_, i) => ({ id: `e${String(start + i)}`, cursor: start + i, sessionId: id, at: fixture.generatedAt, kind: 'assistant', text: `entry ${String(start + i)}`, toolCallId: null, resetId: null }));
const settle = () => new Promise(resolve => setImmediate(resolve));

function setup(tail?: () => Promise<TranscriptTail>) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: fixture });
  store.setConnection(true, ''); store.flush();
  const pages: { query: TranscriptQuery; result: ReturnType<typeof Promise.withResolvers<Transcript>> }[] = [];
  const client = {
    session: async () => { throw new Error('not needed'); },
    transcriptTail: tail ?? (async () => ({ entries: entries(5001, 6000), truncated: false, hasMore: true })),
    transcriptPage: (query: TranscriptQuery) => { const result = Promise.withResolvers<Transcript>(); pages.push({ query, result }); return result.promise; },
  } as unknown as DaemonClient;
  return { store, pages, loader: new TranscriptLoader(store, client) };
}

for (const width of [80, 112]) test(`bidirectional edge paging, retry, follow and around jumps at ${String(width)} columns`, async () => {
  const { store, loader, pages } = setup();
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id }, loadTranscript: loader.load, pageTranscript: loader.page, focusTranscript: loader.focus, loadMemory: () => undefined, onQuit: () => undefined }), { width, height: 30 });
  const publish = async () => { await settle(); store.flush(); await ui.settle(); };
  try {
    await publish();
    assert.match(ui.frame(), /following tail/);
    assert.match(ui.frame(), /older entries above — scroll up to load/);
    await ui.press('g'); await ui.press('k');
    assert.equal(pages.length, 1);
    assert.equal(pages[0].query.after, 5001);
    assert.equal(pages[0].query.order, 'desc');
    pages[0].result.reject(new Error('offline')); await publish();
    assert.match(ui.frame(), /Could not load transcript · r retry/);
    await ui.press('r');
    assert.equal(pages.length, 2);
    assert.equal(pages[1].query.after, 5001);
    pages[1].result.resolve({ items: entries(3001, 5000).reverse(), nextCursor: 3001, hasMore: true }); await publish();
    assert.equal(store.getSnapshot().transcripts.get(id)?.length, 2500);
    assert.equal(store.getSnapshot().transcripts.get(id)?.at(-1)?.cursor, 5500);
    assert.match(ui.frame(), /newer entries below/);
    assert.doesNotMatch(ui.frame(), /following tail/);
    await ui.press('G'); await ui.press('j');
    assert.equal(pages.at(-1)?.query.after, 5500);
    assert.equal(pages.at(-1)?.query.order, 'asc');
    pages.at(-1)!.result.resolve({ items: entries(5501, 6000), nextCursor: 6000, hasMore: false }); await publish();
    assert.doesNotMatch(ui.frame(), /newer entries below/);
    await ui.press('f');
    assert.match(ui.frame(), /following tail/);
    loader.focus(id, 'e100');
    assert.equal(pages.at(-1)?.query.around, 'e100');
    pages.at(-1)!.result.resolve({ items: entries(90, 110), nextCursor: 110, hasMore: true, hasOlder: true }); await publish();
    assert.equal(store.getSnapshot().transcripts.get(id)?.[0]?.cursor, 90);
    assert.match(ui.frame(), /newer entries below/);
    assert.match(ui.frame(), /older entries above — scroll up to load/);
    assert.doesNotMatch(ui.frame(), /following tail/);
    await ui.press('f'); await publish();
    assert.match(ui.frame(), /following tail/);
    assert.equal(store.getSnapshot().transcripts.get(id)?.at(-1)?.cursor, 6000);
    for (const line of ui.frame().split('\n')) assert.ok([...line].length <= width, line);
  } finally { ui.destroy(); loader.stop(); store.dispose(); }
});

test('pausing an empty transcript while its initial tail is loading survives the response', async () => {
  const tail = Promise.withResolvers<TranscriptTail>();
  const { store, loader } = setup(() => tail.promise);
  const ui = await mountHeadless(h(App, { store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id }, loadTranscript: loader.load, pageTranscript: loader.page, focusTranscript: loader.focus, loadMemory: () => undefined, onQuit: () => undefined }), { width: 80, height: 30 });
  try {
    await ui.settle();
    await ui.press('f');
    assert.match(ui.frame(), /paused/);
    tail.resolve({ entries: entries(1, 20), truncated: false, hasMore: false });
    await settle(); store.flush(); await ui.settle();
    assert.match(ui.frame(), /paused/);
    assert.doesNotMatch(ui.frame(), /following tail/);
  } finally { ui.destroy(); loader.stop(); store.dispose(); }
});

test('superseding a page, closing a session and stopping ignore late page success and errors', async () => {
  const { store, loader, pages } = setup();
  try {
    loader.load(id); await settle();
    loader.page(id, 'older');
    const old = pages[0];
    loader.focus(id, 'e100');
    assert.equal(old.query.signal?.aborted, true);
    old.result.resolve({ items: entries(1, 10), nextCursor: 1, hasMore: false });
    pages[1].result.resolve({ items: entries(90, 110), nextCursor: 110, hasMore: true, hasOlder: true }); await settle();
    assert.equal(store.getSnapshot().transcripts.get(id)?.[0]?.cursor, 90);
    loader.page(id, 'newer'); const closing = pages[2]; loader.stop();
    assert.equal(closing.query.signal?.aborted, true);
    closing.result.reject(new Error('late failure')); await settle();
    assert.equal(store.getSnapshot().transcripts.get(id)?.[0]?.cursor, 90);
    assert.equal(store.getSnapshot().transcriptHistory.get(id)?.error, undefined);
    loader.load(id); await settle(); loader.page(id, 'older');
    const stopping = pages.at(-1)!; loader.stop();
    assert.equal(stopping.query.signal?.aborted, true);
    stopping.result.resolve({ items: entries(1, 10), nextCursor: 1, hasMore: false }); await settle();
    assert.equal(store.getSnapshot().transcripts.get(id)?.at(-1)?.cursor, 6000);
  } finally { loader.stop(); store.dispose(); }
});
