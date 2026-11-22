import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryActionAvailability, MemoryActionReceipt, MemoryActionRequest, MemoryItem, SessionMemory } from '@pi-console/contract';
import { MemoryReviewController, type MemoryReviewApi, type ReviewScheduler } from './memory-review-controller.ts';
import { MemoryRefreshController } from './memory-refresh-controller.ts';
import { emptyMemoryReview, memoryReviewHint, memoryReviewIngestionGraceMs, memoryReviewProgress, type MemoryReviewSession } from './memory-review.ts';
import { memoryPanelViewModel } from './memory.ts';

const available: MemoryActionAvailability = { version: 1, available: true, reason: 'available', providerVersion: 1, generation: 'g1' };
const item: MemoryItem = {
  id: 'item-1', kind: 'order', scope: { kind: 'session', key: 's1' }, sessionId: 's1', status: 'proposed', statusBasis: 'recorded', text: 'synthetic order',
  withheld: false, sourceType: 'coordinator_order', sourceMessageId: null, at: '2026-11-20T09:00:00.000Z', command: '/memory confirm item-1',
};
const memory: SessionMemory = {
  sessionId: 's1', storeDetected: true, counts: { active: 0, proposed: 1, done: 0, superseded: 0, withdrawn: 0, rejected: 0 }, proposedConfirmable: 1,
  unresolved: { lowerBound: 1, atLastHandoff: null }, wider: 0, handoffs: [],
};
const receipt = (state: MemoryActionReceipt['state'], request: MemoryActionRequest): MemoryActionReceipt => ({
  ...request, version: 1, state, sessionId: 's1', generation: 'g1', connectionGeneration: 'c1', tokenId: 'control', createdAt: Date.now(),
  updatedAt: Date.now(), expiresAt: Date.now() + 60_000, reason: null, eventId: null,
});
const flush = () => new Promise<void>(resolve => { setImmediate(resolve); });
const waitForTimeout = () => new Promise<void>(resolve => { setTimeout(resolve, 30); });
function neverRespond<T>(signals: AbortSignal[], signal?: AbortSignal): Promise<T> {
  assert.ok(signal);
  signals.push(signal);
  return new Promise<T>(() => undefined); // Deliberately ignores cancellation, like a stuck transport.
}
function rig(states: MemoryActionReceipt['state'][] = ['awaiting-human', 'awaiting-ingestion', 'observed-applied'], callTimeoutMs = 10_000) {
  let pending: (() => void) | null = null;
  let request: MemoryActionRequest = { requestId: '', itemId: '', action: 'confirm' };
  const posts: { sessionId: string; request: MemoryActionRequest }[] = [];
  const views = new Map<string, MemoryReviewSession>();
  const reloads: string[] = [];
  const delays: number[] = [];
  const expiresAt = Date.now() + 30_000;
  const timers: ReviewScheduler = { set: (callback, delayMs = 0) => { delays.push(delayMs); pending = callback; return callback; }, clear: () => { pending = null; } };
  const api: MemoryReviewApi = {
    memoryActionAvailability: () => Promise.resolve(available),
    requestMemoryAction: (sessionId, input) => { request = input; posts.push({ sessionId, request }); return Promise.resolve({ ...receipt(states.shift() ?? 'unknown', request), expiresAt }); },
    memoryActionReceipt: () => Promise.resolve({ ...receipt(states.shift() ?? 'unknown', request), expiresAt }),
  };
  const controller = new MemoryReviewController(api, (id, value) => { views.set(id, value); }, id => { reloads.push(id); return Promise.resolve(); }, { timers, callTimeoutMs });
  return { api, controller, views, posts, reloads, delays, expiresAt, tick: async () => { const next = pending; pending = null; next?.(); await flush(); }, hasTimer: () => pending !== null };
}

test('every availability reason has a bounded actionable fallback, including old daemon', () => {
  const reasons = ['disabled', 'read-only', 'offline', 'unsupported', 'not-ready'] as const;
  for (const reason of reasons) {
    const hint = memoryReviewHint({ ...available, available: false, reason });
    assert.match(hint, /pi/);
    assert.ok(hint.length < 200);
    const model = memoryPanelViewModel({ memory, items: [item], now: 0, review: { ...emptyMemoryReview(), availability: { ...available, available: false, reason } } });
    assert.equal(model.items[0].canRequest, false);
    assert.equal(model.items[0].command, '/memory confirm item-1');
  }
  assert.match(memoryReviewHint(null), /unsupported or disconnected/);
});

test('only recorded, non-withheld proposed items are requestable, with no optimistic memory changes', () => {
  const variants = [item, { ...item, status: 'active' as const }, { ...item, withheld: true }, { ...item, statusBasis: 'assumed' as const }];
  const review = { availability: available, items: new Map() };
  const model = memoryPanelViewModel({ memory, items: variants, now: 0, review });
  assert.deepEqual(model.items.map(row => row.canRequest), [true, false, false, false]);
  for (const state of ['awaiting-human', 'awaiting-ingestion', 'declined', 'conflict', 'unavailable', 'expired', 'unknown', 'observed-applied'] as const) {
    const progress = memoryReviewProgress(receipt(state, { requestId: 'r1', itemId: item.id, action: 'confirm' }));
    const pending = memoryPanelViewModel({ memory, items: [item], now: 0, review: { availability: available, items: new Map([[item.id, progress]]) } });
    assert.equal(pending.items[0].statusLabel, 'proposed');
    assert.equal(pending.items[0].canRequest, !['awaiting-human', 'awaiting-ingestion', 'observed-applied'].includes(state));
    assert.ok(pending.items[0].review?.message);
  }
  assert.match(memoryReviewProgress(receipt('awaiting-human', { requestId: 'r', itemId: item.id, action: 'confirm' })).message, /Awaiting confirmation in pi/);
  assert.match(memoryReviewProgress(receipt('awaiting-ingestion', { requestId: 'r', itemId: item.id, action: 'confirm' })).message, /awaiting producer ingestion/);
});

test('one explicit request, human then ingestion then observed, refresh canonical data only at terminal', async () => {
  const r = rig();
  await r.controller.load('s1');
  const first = r.controller.request('s1', item.id, 'confirm');
  await r.controller.request('s1', item.id, 'confirm');
  await r.controller.request('s1', 'item-2', 'reject');
  await first;
  assert.equal(r.posts.length, 1);
  assert.match(r.posts[0].request.requestId, /^[a-f0-9-]{36}$/);
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'awaiting-human');
  await r.controller.load('s1'); // reconnect/refresh never resends
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'awaiting-ingestion');
  assert.deepEqual(r.reloads, []);
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'observed-applied');
  assert.deepEqual(r.reloads, ['s1']);
  assert.equal(r.hasTimer(), false);
  assert.equal(r.posts.length, 1);
  r.controller.dispose();
});

test('a marker after receipt completion reads fresh readiness after an older in-flight availability request', async () => {
  let review = emptyMemoryReview();
  let reads = 0;
  const api: MemoryReviewApi = {
    memoryActionAvailability: () => Promise.resolve(available),
    requestMemoryAction: (_id, request) => Promise.resolve(receipt('observed-applied', request)),
    memoryActionReceipt: () => Promise.reject(new Error('No polling expected')),
  };
  const refresh: MemoryRefreshController = new MemoryRefreshController(() => { reads++; return Promise.resolve(); }, id => reviews.load(id, { fresh: true }));
  const reviews: MemoryReviewController = new MemoryReviewController(api, (_id, value) => { review = value; }, id => refresh.refresh(id));
  await reviews.load('s1');
  let release!: (value: MemoryActionAvailability) => void;
  let calls = 0;
  api.memoryActionAvailability = () => {
    calls++;
    return calls === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ...available, generation: 'g2' });
  };
  const completion = reviews.request('s1', item.id, 'confirm');
  await flush();
  assert.equal(reads, 1, 'receipt completion first refreshes canonical memory');
  assert.equal(calls, 1, 'receipt readiness is still in flight');
  const close = refresh.watch('s1');
  await flush();
  assert.equal(reads, 2, 'the visible marker refreshes canonical memory independently');
  release({ ...available, available: false, reason: 'not-ready' });
  await completion; await flush();
  assert.equal(calls, 2, 'the marker does not settle for the older availability result');
  assert.equal(review.availability?.generation, 'g2');
  assert.equal(review.availability?.available, true);
  close(); refresh.dispose(); reviews.dispose();
});

test('terminal outcomes stop polling, including explicit reject, without synthesizing memory', async () => {
  for (const state of ['declined', 'conflict', 'unavailable', 'expired', 'unknown'] as const) {
    const r = rig(['awaiting-human', state]);
    await r.controller.load('s1');
    await r.controller.request('s1', item.id, 'reject');
    await r.tick();
    assert.equal(r.posts[0].request.action, 'reject');
    assert.equal(r.views.get('s1')?.items.get(item.id)?.state, state);
    assert.equal(r.hasTimer(), false);
    assert.deepEqual(r.reloads, ['s1']);
    const previousId = r.posts[0].request.requestId;
    await r.controller.request('s1', item.id, 'confirm');
    assert.equal(r.posts.length, 2, 'only an explicit action retries a non-applied outcome');
    assert.notEqual(r.posts[1].request.requestId, previousId);
    r.controller.dispose();
  }
});

test('session identity survives navigation; disposal cancels polling and late availability updates', async () => {
  const r = rig();
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  await r.controller.load('s2');
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'awaiting-ingestion');
  assert.equal(r.views.get('s2')?.items.size, 0);
  r.controller.dispose();
  assert.equal(r.hasTimer(), false);
  await r.controller.request('s2', item.id, 'reject');
  assert.equal(r.posts.length, 1);
});

test('disposing an in-flight receipt GET cannot schedule a late retry or canonical refresh', async () => {
  const r = rig();
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  let fail: (error: Error) => void = () => { throw new Error('Receipt GET did not start'); };
  r.api.memoryActionReceipt = () => new Promise<MemoryActionReceipt>((_resolve, reject) => { fail = reject; });
  await r.tick();
  r.controller.dispose();
  fail(new Error('aborted'));
  await flush();
  assert.equal(r.hasTimer(), false);
  assert.deepEqual(r.reloads, []);
  assert.equal(r.posts.length, 1);
});

test('availability calls time out into the existing fallback and release the shared load', async t => {
  const r = rig([], 5);
  t.after(() => { r.controller.dispose(); });
  await r.controller.load('s1');
  const signals: AbortSignal[] = [];
  r.api.memoryActionAvailability = (_sessionId, signal) => neverRespond(signals, signal);
  const loading = r.controller.load('s1');
  assert.equal(r.controller.load('s1'), loading);
  let settled = false;
  void loading.then(() => { settled = true; });
  await waitForTimeout();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[0].reason.name, 'TimeoutError');
  assert.equal(settled, true);
  assert.equal(r.views.get('s1')?.availability, null);
  assert.match(memoryReviewHint(r.views.get('s1')?.availability ?? null), /unsupported or disconnected/);
  r.api.memoryActionAvailability = () => Promise.resolve(available);
  await r.controller.load('s1');
  assert.deepEqual(r.views.get('s1')?.availability, available);
});

test('a timed-out POST becomes unknown and never automatically retries', async t => {
  const r = rig([], 5);
  t.after(() => { r.controller.dispose(); });
  await r.controller.load('s1');
  const signals: AbortSignal[] = [];
  r.api.requestMemoryAction = (sessionId, request, signal) => { r.posts.push({ sessionId, request }); return neverRespond(signals, signal); };
  const requesting = r.controller.request('s1', item.id, 'confirm');
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'requesting');
  await waitForTimeout();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[0].reason.name, 'TimeoutError');
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'unknown');
  assert.match(r.views.get('s1')?.items.get(item.id)?.message ?? '', /check pi before retrying/);
  await requesting;
  await r.controller.load('s1');
  assert.equal(r.posts.length, 1);
  assert.equal(r.hasTimer(), false);
  assert.deepEqual(r.reloads, ['s1']);
});

test('a timed-out receipt GET backs off and recovers without another POST', async t => {
  const r = rig(['awaiting-human', 'observed-applied'], 5);
  t.after(() => { r.controller.dispose(); });
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  const normal = r.api.memoryActionReceipt.bind(r.api);
  const signals: AbortSignal[] = [];
  r.api.memoryActionReceipt = (_requestId, signal) => neverRespond(signals, signal);
  await r.tick();
  await waitForTimeout();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[0].reason.name, 'TimeoutError');
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'awaiting-human');
  assert.equal(r.hasTimer(), true);
  assert.equal(r.delays.at(-1), 2000);
  assert.deepEqual(r.reloads, []);
  r.api.memoryActionReceipt = normal;
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'observed-applied');
  assert.equal(r.posts.length, 1);
  assert.deepEqual(r.reloads, ['s1']);
});

for (const phase of ['availability', 'request', 'receipt'] as const) test(`disposal cancels a stuck ${phase} call without publishing an unknown outcome`, async () => {
  const r = rig(['awaiting-human'], 5);
  await r.controller.load('s1');
  const signals: AbortSignal[] = [];
  if (phase === 'availability') r.api.memoryActionAvailability = (_sessionId, signal) => neverRespond(signals, signal);
  if (phase === 'request') r.api.requestMemoryAction = (_sessionId, _request, signal) => neverRespond(signals, signal);
  if (phase === 'receipt') r.api.memoryActionReceipt = (_requestId, signal) => neverRespond(signals, signal);
  const pending = phase === 'availability' ? r.controller.load('s1') : r.controller.request('s1', item.id, 'confirm');
  if (phase === 'receipt') { await pending; await r.tick(); }
  const current = r.views.get('s1');
  r.controller.dispose();
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[0].reason.name, 'AbortError');
  await waitForTimeout();
  assert.equal(r.views.get('s1'), current);
  assert.equal(r.hasTimer(), false);
  assert.deepEqual(r.reloads, []);
});

test('POST errors become unknown; never auto-retry a POST or leak unsafe error text', async () => {
  const r = rig();
  r.api.requestMemoryAction = () => Promise.reject(new Error('403 read-only\u001b[31m'));
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  assert.match(r.views.get('s1')?.items.get(item.id)?.message ?? '', /403 read-only/);
  assert.equal(r.views.get('s1')?.items.get(item.id)?.message.includes(String.fromCharCode(27)), false);
  assert.equal(r.hasTimer(), false);
  assert.deepEqual(r.reloads, ['s1']);
  r.controller.dispose();
});

test('a transient receipt GET failure backs off and recovers without another POST', async () => {
  const r = rig(['awaiting-human', 'observed-applied']);
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  const normal = r.api.memoryActionReceipt.bind(r.api);
  r.api.memoryActionReceipt = () => Promise.reject(new Error('offline'));
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'awaiting-human');
  assert.equal(r.hasTimer(), true);
  assert.equal(r.delays.at(-1), 2000);
  r.api.memoryActionReceipt = normal;
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'observed-applied');
  assert.equal(r.posts.length, 1);
  assert.deepEqual(r.reloads, ['s1']);
  r.controller.dispose();
});

test('poll failures stop at deadline plus grace and refresh canonical memory exactly once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const r = rig();
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  r.api.memoryActionReceipt = () => Promise.reject(new Error('404 receipt not found'));
  await r.tick(); await r.tick(); await r.tick();
  assert.deepEqual(r.delays.slice(1), [2000, 4000, 5000]);
  t.mock.timers.tick(30_000 + memoryReviewIngestionGraceMs - 1);
  await r.tick();
  assert.equal(r.delays.at(-1), 1);
  assert.deepEqual(r.reloads, []);
  t.mock.timers.tick(1);
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'unknown');
  assert.equal(r.hasTimer(), false);
  assert.equal(r.posts.length, 1);
  assert.deepEqual(r.reloads, ['s1']);
  r.controller.dispose();
});

test('approval tracking continues beyond the human deadline, and unverified writes are not labelled expired', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const r = rig();
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  await r.tick();
  t.mock.timers.tick(30_001);
  await r.tick();
  assert.equal(r.views.get('s1')?.items.get(item.id)?.state, 'observed-applied');
  assert.deepEqual(r.reloads, ['s1']);
  assert.match(memoryReviewProgress({ ...receipt('unknown', { requestId: 'r', itemId: item.id, action: 'confirm' }), eventId: 'reported-write', reason: 'applied' }).message, /producer ingestion remains unverified/);
  await r.controller.request('s1', item.id, 'confirm');
  assert.equal(r.posts.length, 1, 'an observed-applied receipt cannot be retried against stale canonical data');
  r.controller.dispose();
});
