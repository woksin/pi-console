import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import type { MemoryItem, MemoryItemPage, SessionMemory } from '@pi-console/contract';
import { memoryPanelViewModel } from '@pi-console/viewmodels';
import { DaemonClient } from './api/client.ts';
import { memoryInput } from './memory-input.ts';
import { MemoryLoader } from './memory-loader.ts';
import { initial } from './state/ui.ts';
import { Store } from './store/store.ts';
import { memoryLines } from './views/session-memory.ts';

const proposal: MemoryItem = {
  id: 'old-proposal', kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded',
  text: 'Older actionable proposal', withheld: false, sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-11-20T09:00:00Z', command: '/memory confirm old-proposal',
};
const completed = Array.from({ length: 101 }, (_, index): MemoryItem => ({ ...proposal, id: `done-${String(index)}`, status: 'done', command: null }));
const memory: SessionMemory = {
  sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 1, done: 101, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 1,
  unresolved: { lowerBound: 1, atLastHandoff: null }, wider: 0, handoffs: [],
};
const first: MemoryItemPage = { items: completed.slice(0, 100), hasMore: true, nextCursor: 'older / cursor', total: 102 };
const last: MemoryItemPage = { items: [completed[100], proposal], hasMore: false, nextCursor: null, total: 102 };
const review = { availability: { version: 1 as const, available: true, providerVersion: 1, generation: 'g1', reason: 'available' as const }, items: new Map() };
const ui = { ...initial, sessionId: 's1', pane: 'memory' as const, memoryIndex: 99 };
const progress = { cursor: first.nextCursor, more: true, total: 102, loading: false };
const panelText = (store: Store) => {
  const data = store.getSnapshot();
  const panel = memoryPanelViewModel({ memory: data.memory.get('s1') ?? null, items: data.memoryItems.get('s1') ?? [], review, now: 0 });
  return memoryLines(panel, 60, 0, data.memoryHistory.get('s1')).flat().map(part => part.text).join('\n');
};

function seed() {
  const store = new Store();
  store.mergeMemory('s1', memory, first.items);
  store.setMemoryHistory('s1', progress);
  store.setMemoryReview('s1', review);
  return store;
}

test('the memory client preserves page metadata and escapes the exclusive older cursor', async t => {
  const urls: URL[] = [];
  t.mock.method(globalThis, 'fetch', (url: string) => { urls.push(new URL(url)); return Promise.resolve(Response.json(first)); });
  const client = new DaemonClient({ baseUrl: 'http://127.0.0.1:1', token: 'test', tokenSource: 'test' });
  try {
    assert.deepEqual(await client.memoryPage('session / one'), first);
    await client.memoryPage('session / one', first.nextCursor);
    assert.equal(urls[0].searchParams.get('limit'), '100');
    assert.equal(urls[0].searchParams.get('order'), 'desc');
    assert.equal(urls[0].searchParams.get('sessionId'), 'session / one');
    assert.equal(urls[0].searchParams.has('after'), false);
    assert.equal(urls[1].searchParams.get('after'), first.nextCursor);
    assert.deepEqual(await client.memoryItems('s1'), first.items, 'legacy array callers remain compatible');
  } finally { client.stop(); }
});

test('summary counts do not imply complete loading: memory shows loaded/total, more, loading and retry', () => {
  const store = seed();
  try {
    assert.match(panelText(store), /100\/102 loaded.*more items.*\] load more/);
    assert.match(panelText(store), /1 proposed/);
    store.setMemoryHistory('s1', { ...progress, loading: true });
    assert.match(panelText(store), /Loading more memory items/);
    store.setMemoryHistory('s1', { ...progress, error: 'more' });
    assert.match(panelText(store), /Could not load more memory items.*r retry/);
    store.setMemoryHistory('s1', { cursor: null, more: false, total: 100, loading: false });
    assert.match(panelText(store), /100\/100 loaded/);
    assert.doesNotMatch(panelText(store), /more items|\] load more|r retry/);
  } finally { store.dispose(); }
});

test('older proposals beyond the first 100 are appended once, selectable and reviewable', async () => {
  const store = new Store();
  const cursors: (string | null)[] = [];
  const loader = new MemoryLoader(store, {
    sessionMemory: async () => memory,
    memoryPage: async (_id, cursor) => { cursors.push(cursor ?? null); return cursor ? { ...last, items: [first.items[99], ...last.items] } : first; },
  });
  const requested: unknown[][] = [];
  try {
    await loader.refresh('s1');
    store.setMemoryReview('s1', review);
    assert.match(panelText(store), /100\/102 loaded.*more/);
    memoryInput(ui, 'c', store.getSnapshot(), 120, (...args) => { requested.push(args); });
    assert.equal(requested.length, 0, 'a selected completed item is not actionable');
    await loader.more('s1');
    assert.deepEqual(cursors, [null, first.nextCursor]);
    assert.equal(store.getSnapshot().memoryItems.get('s1')?.length, 102, 'overlap is deduplicated by item id');
    assert.match(panelText(store), /102\/102 loaded/);
    assert.doesNotMatch(panelText(store), /more.*older/);
    const selected = { ...ui, memoryIndex: 101 };
    memoryInput(selected, 'c', store.getSnapshot(), 120, (...args) => { requested.push(args); });
    memoryInput(selected, 'x', store.getSnapshot(), 120, (...args) => { requested.push(args); });
    assert.deepEqual(requested, [['s1', proposal.id, 'confirm'], ['s1', proposal.id, 'reject']]);
    const panel = memoryPanelViewModel({ memory, items: store.getSnapshot().memoryItems.get('s1') ?? [], review, now: 0 });
    assert.match(memoryLines(panel, 60, 101).flat().map(part => part.text).join(''), /Older actionable proposal/);
    await loader.more('s1');
    assert.equal(cursors.length, 2, 'completion cannot request another page');
  } finally { loader.stop(); store.dispose(); }
});

test('failed older pages retain items and cursor; duplicate requests coalesce and retry succeeds', async () => {
  const store = seed();
  let pending = Promise.withResolvers<MemoryItemPage>();
  const cursors: (string | null)[] = [];
  const loader = new MemoryLoader(store, {
    sessionMemory: async () => memory,
    memoryPage: (_id, cursor) => { cursors.push(cursor ?? null); return pending.promise; },
  });
  try {
    const loading = loader.more('s1');
    await loader.more('s1');
    assert.equal(store.getSnapshot().memoryHistory.get('s1')?.loading, true);
    pending.reject(new Error('offline'));
    await loading;
    assert.deepEqual(store.getSnapshot().memoryHistory.get('s1'), { ...progress, error: 'more' });
    assert.deepEqual(store.getSnapshot().memoryItems.get('s1'), first.items);
    pending = Promise.withResolvers<MemoryItemPage>();
    const retry = loader.more('s1');
    assert.equal(store.getSnapshot().memoryHistory.get('s1')?.error, undefined);
    pending.resolve(last);
    await retry;
    assert.deepEqual(cursors, [first.nextCursor, first.nextCursor]);
    assert.equal(store.getSnapshot().memoryHistory.get('s1')?.more, false);
    assert.equal(store.getSnapshot().memoryItems.get('s1')?.at(-1)?.id, proposal.id);
  } finally { loader.stop(); store.dispose(); }
});

test('refresh waits for older backfill and reloads its full loaded depth with canonical statuses', async () => {
  const store = seed();
  const older = Promise.withResolvers<MemoryItemPage>();
  let refreshing = false;
  const cursors: (string | null)[] = [];
  const loader = new MemoryLoader(store, {
    sessionMemory: async () => memory,
    memoryPage: (_id, cursor) => {
      cursors.push(cursor ?? null);
      if (!refreshing) return older.promise;
      return Promise.resolve(cursor ? { ...last, items: [completed[100], { ...proposal, status: 'active', command: null }] } : first);
    },
  });
  try {
    const loading = loader.more('s1');
    const refresh = loader.refresh('s1');
    assert.deepEqual(cursors, [first.nextCursor]);
    refreshing = true;
    older.resolve(last);
    await Promise.all([loading, refresh]);
    assert.deepEqual(cursors, [first.nextCursor, null, first.nextCursor]);
    assert.equal(store.getSnapshot().memoryItems.get('s1')?.length, 102);
    assert.equal(store.getSnapshot().memoryItems.get('s1')?.at(-1)?.status, 'active');
    assert.equal(store.getSnapshot().memoryHistory.get('s1')?.more, false);
  } finally { loader.stop(); store.dispose(); }
});

test('an initial refresh failure is visible and retryable, and empty sessions have independent metadata', async () => {
  const store = new Store();
  let offline = true;
  const loader = new MemoryLoader(store, {
    sessionMemory: async () => memory,
    memoryPage: async id => {
      if (offline) throw new Error('offline');
      return id === 'empty' ? { items: [], hasMore: false, nextCursor: null, total: 0 } : first;
    },
  });
  try {
    await assert.rejects(loader.refresh('s1'), /offline/);
    assert.equal(store.getSnapshot().memoryItems.has('s1'), false);
    assert.match(panelText(store), /Could not refresh memory.*r retry/);
    offline = false;
    await loader.more('s1');
    await loader.refresh('empty');
    assert.equal(store.getSnapshot().memoryHistory.get('s1')?.more, true);
    assert.deepEqual(store.getSnapshot().memoryHistory.get('empty'), { cursor: null, more: false, total: 0, loading: false });
    assert.equal(store.getSnapshot().memoryItems.get('s1')?.length, 100);
    assert.deepEqual(store.getSnapshot().memoryItems.get('empty'), []);
  } finally { loader.stop(); store.dispose(); }
});

test('runtime retry after an initial failure also refreshes review availability', () => {
  const source = `
    import assert from 'node:assert/strict';
    import { mock } from 'node:test';
    let offline = true, readiness = 0;
    mock.module('./packages/tui/src/view/renderer.ts', { namedExports: { launch: async () => {} } });
    mock.module('./packages/tui/src/app.ts', { namedExports: { App: () => null } });
    mock.module('./packages/tui/src/api/client.ts', { namedExports: { DaemonClient: class {
      stream() { return Promise.resolve(); }
      sessionMemory() { return Promise.resolve(${JSON.stringify(memory)}); }
      memoryPage() { return offline ? Promise.reject(new Error('offline')) : Promise.resolve(${JSON.stringify(first)}); }
      memoryActionAvailability() { readiness++; return Promise.resolve(${JSON.stringify(review.availability)}); }
      stop() {}
    } } });
    const { connect } = await import('./packages/tui/src/runtime.ts');
    const runtime = connect({ baseUrl: 'http://127.0.0.1', token: 'test', tokenSource: 'test' });
    const unwatch = runtime.watchMemory('s1');
    try {
      await runtime.loadMemory('s1');
      assert.equal(runtime.store.getSnapshot().memoryHistory.get('s1').error, 'refresh');
      offline = false;
      await runtime.loadMoreMemory('s1');
      assert.equal(runtime.store.getSnapshot().memoryItems.get('s1').length, 100);
      assert.equal(runtime.store.getSnapshot().memoryReviews.get('s1').availability.available, true);
      assert.equal(readiness, 1);
    } finally { unwatch(); runtime.stop(); }
  `;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--input-type=module', '-e', source], {
    cwd: new URL('../../..', import.meta.url), encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, result.stderr);
});

test('a stopped memory loader cannot publish a late page', async () => {
  const store = seed();
  const pending = Promise.withResolvers<MemoryItemPage>();
  const loader = new MemoryLoader(store, { sessionMemory: async () => memory, memoryPage: () => pending.promise });
  try {
    const loading = loader.more('s1');
    loader.stop();
    pending.resolve(last);
    await loading;
    assert.deepEqual(store.getSnapshot().memoryItems.get('s1'), first.items);
  } finally { store.dispose(); }
});

test('memory pages at its last row with ], and r retries only visible failures outside overlays', () => {
  const store = seed();
  const calls: string[] = [];
  const load = (id: string) => { calls.push(id); };
  try {
    memoryInput(ui, ']', store.getSnapshot(), 120, { loadMore: load });
    assert.deepEqual(calls, ['s1']);
    memoryInput(ui, 'r', store.getSnapshot(), 120, { loadMore: load });
    assert.equal(calls.length, 1);
    store.setMemoryHistory('s1', { ...progress, error: 'more' });
    memoryInput(ui, 'r', store.getSnapshot(), 120, { loadMore: load });
    assert.equal(calls.length, 2);
    for (const variant of [{ ...ui, overlay: 'search' as const }, { ...ui, overlay: 'help' as const }, { ...ui, pane: 'requests' as const }]) {
      assert.equal(memoryInput(variant, 'r', store.getSnapshot(), 120, { loadMore: load }), null);
    }
    assert.equal(memoryInput(ui, 'r', store.getSnapshot(), 90, { loadMore: load }), null);
    assert.equal(calls.length, 2);
    store.setMemoryHistory('s1', { ...progress, loading: true });
    memoryInput(ui, ']', store.getSnapshot(), 120, { loadMore: load });
    assert.equal(calls.length, 2, 'loading cannot issue another page');
  } finally { store.dispose(); }
});
