import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from '@pi-console/testkit';
import type { Snapshot } from '@pi-console/contract';
import { App } from './app.ts';
import { Store } from './store/store.ts';
import { initial } from './state/ui.ts';
import { h, mountHeadless } from './view/renderer.ts';

const fixture = generate().fixture as unknown as Snapshot;

async function setup(width = 100) {
  const store = new Store();
  const session = fixture.sessions[0];
  store.apply({ seq: 1, type: 'snapshot', occurredAt: fixture.generatedAt, payload: {
    ...fixture, sessions: [session], bounded: ['sessions'],
    totals: { sessions: 2, requests: 0, questions: 0, messages: 0, jobs: 0, resets: 0 },
  } });
  store.setConnection(true, '');
  store.flush();
  let calls = 0;
  const loadMore = () => {
    calls++;
    const history = calls === 1 ? { cursor: null, more: true, error: true } : { cursor: null, more: false };
    // Supply the runtime's failed/successful paging states without a network dependency.
    Object.assign(store.getSnapshot(), { history: { sessions: history } });
    if (calls > 1) store.mergePage('sessions', { items: [{ ...session, id: 'older-session' }], nextCursor: null, hasMore: false, total: 2 });
    store.flush();
  };
  const ui = await mountHeadless(h(App, {
    store, endpoint: 'http://localhost', tokenSource: 'test', animate: false, initialState: { section: 'fleet', cursor: { ...initial.cursor, fleet: 1 } },
    loadTranscript: () => undefined, loadMemory: () => undefined, loadMore, onQuit: () => undefined,
  }), { width, height: 24 });
  await ui.settle();
  return { ui, store, calls: () => calls };
}

test('history load failure is visible with a retry hint; r retries and clears the error', async () => {
  const { ui, store, calls } = await setup(80);
  try {
    assert.match(ui.frame(), /Could not load older sessions\./);
    assert.match(ui.frame(), /r retry/);
    await ui.settle();
    assert.equal(calls(), 1, 'failure alone must not cause an automatic retry loop');
    await ui.press('r');
    assert.equal(calls(), 2);
    assert.equal(store.getSnapshot().sessions.length, 2);
    assert.doesNotMatch(ui.frame(), /Could not load older/);
    await ui.press('r');
    assert.equal(calls(), 2, 'a complete list is not retried');
  } finally { ui.destroy(); store.dispose(); }
});

for (const key of ['j', 'ARROW_DOWN', 'END', '\u001b[6~']) {
  test(`navigation ${JSON.stringify(key)} at the unchanged last row retries a failed page`, async () => {
    const { ui, store, calls } = await setup();
    try {
      assert.equal(calls(), 1);
      await ui.press(key);
      assert.equal(calls(), 2);
      assert.equal(store.getSnapshot().sessions.length, 2);
      assert.doesNotMatch(ui.frame(), /Could not load older/);
    } finally { ui.destroy(); store.dispose(); }
  });
}

test('history retry preserves filter text and does not run inside overlays', async () => {
  const { ui, store, calls } = await setup();
  try {
    await ui.press('/');
    await ui.type('r');
    assert.match(ui.frame(), /filter\s+r/);
    await ui.press('ESCAPE');
    await ui.press('?');
    await ui.press('r');
    await ui.press('ARROW_DOWN');
    await ui.press('ESCAPE');
    assert.equal(calls(), 1);
  } finally { ui.destroy(); store.dispose(); }
});
