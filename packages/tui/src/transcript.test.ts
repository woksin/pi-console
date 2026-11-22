import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generate } from '@pi-console/testkit';
import type { Snapshot, TranscriptEntry } from '@pi-console/contract';
import { App, type AppProps } from './app.ts';
import { DaemonClient } from './api/client.ts';
import { Store, TRANSCRIPT_LIMIT } from './store/store.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;
const sessions = fixture.sessions.slice(0, 2).map((session, index) => ({ ...session, name: `Cancellation session ${String(index)}` }));

function transcriptStore(count: number): Store {
  const store = new Store();
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: { ...fixture, sessions } });
  const entries: TranscriptEntry[] = Array.from({ length: count }, (_, cursor) => ({
    id: `entry-${String(cursor)}`, cursor: cursor + 1, sessionId: sessions[0].id, at: fixture.generatedAt,
    kind: 'assistant', text: `tail ${String(cursor)}`, toolCallId: null, resetId: null, requestId: null, toolResult: null,
  }));
  store.mergeTranscript(sessions[0].id, entries);
  store.setConnection(true, '');
  store.flush();
  return store;
}

async function mountSession(store: Store, width: number, loadTranscript: AppProps['loadTranscript'] = () => undefined) {
  const ui = await mountHeadless(h(App, {
    store, endpoint: 'http://localhost', tokenSource: 'test', animate: false,
    initialState: { sessionId: sessions[0].id }, loadTranscript, loadMemory: () => undefined, onQuit: () => undefined,
  }), { width, height: 30 });
  await ui.settle();
  return ui;
}

for (const width of [80, 112]) {
  test(`cap notice and paused/follow hint remain visible at ${String(width)} columns`, async () => {
    const store = transcriptStore(TRANSCRIPT_LIMIT + 1);
    const ui = await mountSession(store, width);
    try {
      assert.match(ui.frame(), /capped at newest 2500/);
      await ui.press('f');
      assert.match(ui.frame(), /capped at newest 2500/);
      assert.match(ui.frame(), /paused.*f to follow/);
      await ui.press('f');
      assert.match(ui.frame(), /following tail/);
    } finally { ui.destroy(); store.dispose(); }
  });
}

test('exactly 2500 entries do not claim truncation; a later live entry does', async () => {
  const store = transcriptStore(TRANSCRIPT_LIMIT);
  const ui = await mountSession(store, 112);
  try {
    assert.doesNotMatch(ui.frame(), /capped at newest/);
    const last = store.getSnapshot().transcripts.get(sessions[0].id)!.at(-1)!;
    store.apply({ seq: 2, type: 'transcript.appended', occurredAt: fixture.generatedAt, payload: { ...last, id: 'live', cursor: last.cursor + 1 } });
    store.flush();
    await ui.settle();
    assert.match(ui.frame(), /capped at newest 2500/);
  } finally { ui.destroy(); store.dispose(); }
});

test('switching sessions, closing the view and unmounting clean up the previous load', async () => {
  const store = transcriptStore(1);
  const loads: { id: string; controller: AbortController }[] = [];
  const ui = await mountSession(store, 112, id => {
    const controller = new AbortController();
    loads.push({ id, controller });
    return () => { controller.abort(); };
  });
  try {
    assert.equal(loads.length, 1);
    await ui.press('p', { ctrl: true });
    await ui.type(sessions[1].name);
    await ui.press('RETURN');
    assert.deepEqual(loads.map(load => load.id), sessions.map(session => session.id));
    assert.equal(loads[0].controller.signal.aborted, true);
    assert.equal(loads[1].controller.signal.aborted, false);
    await ui.press('ESCAPE');
    assert.equal(loads[1].controller.signal.aborted, true);
    await ui.press('p', { ctrl: true });
    await ui.type(sessions[0].name);
    await ui.press('RETURN');
    assert.equal(loads.length, 3);
    ui.destroy();
    assert.equal(loads[2].controller.signal.aborted, true);
  } finally { ui.destroy(); store.dispose(); }
});

test('backfill reports truncation only after an entry was actually dropped', async () => {
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const total = Number(url.pathname.split('/').at(-2));
    const after = Number(url.searchParams.get('after'));
    const items = Array.from({ length: Math.min(1000, total - after) }, (_, index) => ({ id: `e${String(after + index)}`, cursor: after + index + 1 }));
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ items, nextCursor: after + items.length, hasMore: after + items.length < total }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, token: 'test', tokenSource: 'test' });
  const store = new Store();
  try {
    for (const count of [TRANSCRIPT_LIMIT, TRANSCRIPT_LIMIT + 1]) {
      const sessionId = String(count);
      const { entries, truncated } = await client.transcriptTail({ sessionId });
      assert.equal(entries.length, TRANSCRIPT_LIMIT);
      assert.equal(truncated, count > TRANSCRIPT_LIMIT);
      store.mergeTranscript(sessionId, entries, truncated);
      store.flush();
      assert.equal(store.getSnapshot().transcriptsTruncated.has(sessionId), truncated);
    }
  } finally { store.dispose(); client.stop(); server.closeAllConnections(); server.close(); }
});

for (const cancellation of ['view', 'shutdown']) {
  test(`${cancellation} abort stops an in-flight page and prevents further transcript requests`, async () => {
    const reached = Promise.withResolvers<undefined>();
    let pages = 0;
    const server = createServer((_request, response) => {
      pages++;
      if (pages > 1) { reached.resolve(undefined); return; }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ items: [], nextCursor: 17, hasMore: true }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const client = new DaemonClient({ baseUrl: `http://127.0.0.1:${String((server.address() as { port: number }).port)}`, token: 'test', tokenSource: 'test' });
    const controller = new AbortController();
    try {
      const loading = client.transcript('s1', controller.signal);
      await reached.promise;
      if (cancellation === 'view') controller.abort();
      else client.stop();
      let timedOut = false;
      const deadline = setTimeout(() => { timedOut = true; client.stop(); }, 2000);
      try { await assert.rejects(loading, { name: 'AbortError' }); } finally { clearTimeout(deadline); }
      assert.equal(timedOut, false, 'the per-load signal must abort without waiting for shutdown');
      assert.equal(pages, 2);
    } finally { client.stop(); server.closeAllConnections(); server.close(); }
  });
}
