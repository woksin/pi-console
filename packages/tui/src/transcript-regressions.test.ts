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
const settle = () => new Promise(resolve => setImmediate(resolve));
const entries = (first: number, last: number): TranscriptEntry[] => Array.from({ length: last - first + 1 }, (_, index) => ({ id: `e${String(first + index)}`, cursor: first + index, sessionId: id, at: fixture.generatedAt, kind: 'assistant', text: `entry ${String(first + index)}`, toolCallId: null, resetId: null }));
const tailPage = (): TranscriptTail => ({ entries: entries(5001, 6000), truncated: false, hasMore: true });
const aroundPage = (): Transcript => ({ items: entries(90, 110), nextCursor: 110, hasMore: true, hasOlder: true });

function scenario(tail: () => Promise<TranscriptTail> = async () => tailPage()) {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: fixture });
  store.setConnection(true, ''); store.flush();
  const pages: { query: TranscriptQuery; result: ReturnType<typeof Promise.withResolvers<Transcript>> }[] = [];
  let tailRequests = 0;
  const client = {
    session: async () => { throw new Error('not needed'); },
    transcriptTail: () => { tailRequests++; return tail(); },
    transcriptPage: (query: TranscriptQuery) => { const result = Promise.withResolvers<Transcript>(); pages.push({ query, result }); return result.promise; },
  } as unknown as DaemonClient;
  return { store, pages, loader: new TranscriptLoader(store, client), tailRequests: () => tailRequests };
}
type Scenario = ReturnType<typeof scenario>;
type Ui = Awaited<ReturnType<typeof mountHeadless>>;

const windowEntries = ({ store }: Scenario): readonly TranscriptEntry[] => store.getSnapshot().transcripts.get(id) ?? [];
const dispose = ({ loader, store }: Scenario) => { loader.stop(); store.dispose(); };
async function publish(context: Scenario, ui: Ui): Promise<void> { await settle(); context.store.flush(); await ui.settle(); }
function open(context: Scenario, { width = 80, focusEntry }: { width?: number; focusEntry?: string } = {}) {
  return mountHeadless(h(App, { store: context.store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { sessionId: id, focusEntry: focusEntry ?? null }, loadTranscript: context.loader.load, pageTranscript: context.loader.page, focusTranscript: context.loader.focus, loadMemory: () => undefined, onQuit: () => undefined }), { width, height: 30 });
}
function cacheHistory({ store }: Scenario): void {
  store.setTranscriptPage(id, aroundPage(), 'around');
  store.flush();
}

for (const width of [80, 112]) test(`reopening a historical session follows its fresh tail at ${String(width)} columns`, async () => {
  const context = scenario();
  cacheHistory(context);
  const ui = await open(context, { width });
  try {
    await publish(context, ui);
    assert.equal(windowEntries(context).at(-1)?.cursor, 6000);
    assert.match(ui.frame(), /following tail/);
    assert.match(ui.frame(), /entry 6000/);
    assert.doesNotMatch(ui.frame(), /newer entries below/);
  } finally { ui.destroy(); dispose(context); }
});

test('a fresh historical reopen still preserves a pause made while the tail is loading', async () => {
  const tail = Promise.withResolvers<TranscriptTail>();
  const context = scenario(() => tail.promise);
  cacheHistory(context);
  const ui = await open(context);
  try {
    await ui.settle();
    assert.equal(windowEntries(context).length, 0, 'the old historical window is not reused');
    await ui.press('f');
    tail.resolve(tailPage());
    await publish(context, ui);
    assert.match(ui.frame(), /paused/);
    assert.doesNotMatch(ui.frame(), /following tail/);
  } finally { ui.destroy(); dispose(context); }
});

test('jumping to the same entry after returning to tail starts another around request', async () => {
  const context = scenario();
  const { loader, pages } = context;
  try {
    loader.load(id); await settle();
    loader.focus(id, 'e100');
    loader.focus(id, 'e100');
    assert.equal(pages.length, 1, 'only an in-flight jump is deduplicated');
    pages[0].result.resolve(aroundPage()); await settle();
    loader.page(id, 'tail'); await settle();
    assert.equal(windowEntries(context).at(-1)?.cursor, 6000);
    loader.focus(id, 'e100');
    assert.equal(pages.length, 2);
    assert.equal(pages[1].query.around, 'e100');
    pages[1].result.resolve(aroundPage()); await settle();
    assert.ok(windowEntries(context).some(entry => entry.id === 'e100'));
  } finally { dispose(context); }
});

test('a failed initial around jump falls back to newest entries instead of retrying an unavailable anchor', async () => {
  const context = scenario();
  const ui = await open(context, { focusEntry: 'missing' });
  try {
    assert.equal(context.pages[0].query.around, 'missing');
    context.pages[0].result.reject(new Error('Daemon answered HTTP 404'));
    await publish(context, ui);
    assert.equal(context.tailRequests(), 1);
    assert.equal(windowEntries(context).at(-1)?.cursor, 6000);
    assert.match(ui.frame(), /entry 6000/);
    assert.doesNotMatch(ui.frame(), /Could not load transcript/);
  } finally { ui.destroy(); dispose(context); }
});

test('a live arrival beyond an in-flight around response keeps newer history available', async () => {
  const context = scenario();
  const { loader, pages, store } = context;
  try {
    loader.load(id); await settle();
    loader.focus(id, 'e6000');
    store.apply({ seq: 2, type: 'transcript.appended', occurredAt: fixture.generatedAt, payload: entries(6001, 6001)[0] });
    store.flush();
    pages[0].result.resolve({ items: entries(5990, 6000), nextCursor: 6000, hasMore: false, hasOlder: true }); await settle();
    assert.equal(store.getSnapshot().transcriptHistory.get(id)?.newer, true);
    loader.page(id, 'newer');
    assert.equal(pages[1].query.after, 6000);
    pages[1].result.resolve({ items: entries(6001, 6001), nextCursor: 6001, hasMore: false }); await settle();
    assert.equal(windowEntries(context).at(-1)?.cursor, 6001);
    assert.equal(store.getSnapshot().transcriptHistory.get(id)?.newer, false);
  } finally { dispose(context); }
});
