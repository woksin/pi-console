import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MemoryActionAvailability, MemoryActionReceipt, MemoryActionRequest, MemoryItem, SessionMemory } from '@pi-console/contract';
import { MemoryReviewController, type MemoryReviewApi, type ReviewScheduler } from './memory-review-controller.ts';
import { emptyMemoryReview, memoryReviewHint, memoryReviewProgress, type MemoryReviewSession } from './memory-review.ts';
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
function rig(states: MemoryActionReceipt['state'][] = ['awaiting-human', 'awaiting-ingestion', 'observed-applied']) {
  let pending: (() => void) | null = null;
  let request: MemoryActionRequest = { requestId: '', itemId: '', action: 'confirm' };
  const posts: { sessionId: string; request: MemoryActionRequest }[] = [];
  const views = new Map<string, MemoryReviewSession>();
  const reloads: string[] = [];
  const timers: ReviewScheduler = { set: callback => { pending = callback; return callback; }, clear: () => { pending = null; } };
  const api: MemoryReviewApi = {
    memoryActionAvailability: () => Promise.resolve(available),
    requestMemoryAction: (sessionId, input) => { request = input; posts.push({ sessionId, request }); return Promise.resolve(receipt(states.shift() ?? 'unknown', request)); },
    memoryActionReceipt: () => Promise.resolve(receipt(states.shift() ?? 'unknown', request)),
  };
  const controller = new MemoryReviewController(api, (id, value) => { views.set(id, value); }, id => { reloads.push(id); return Promise.resolve(); }, timers);
  return { api, controller, views, posts, reloads, tick: async () => { const next = pending; pending = null; next?.(); await flush(); }, hasTimer: () => pending !== null };
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
    assert.equal(pending.items[0].canRequest, false);
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

test('HTTP errors and missing receipts become unknown; never retry a POST or leak unsafe error text', async () => {
  const r = rig();
  r.api.requestMemoryAction = () => Promise.reject(new Error('403 read-only\u001b[31m'));
  await r.controller.load('s1');
  await r.controller.request('s1', item.id, 'confirm');
  assert.match(r.views.get('s1')?.items.get(item.id)?.message ?? '', /403 read-only/);
  assert.equal(r.views.get('s1')?.items.get(item.id)?.message.includes(String.fromCharCode(27)), false);
  assert.equal(r.hasTimer(), false);
  r.controller.dispose();
  const p = rig();
  await p.controller.load('s1');
  await p.controller.request('s1', item.id, 'confirm');
  p.api.memoryActionReceipt = () => Promise.reject(new Error('404 receipt not found'));
  await p.tick();
  assert.equal(p.views.get('s1')?.items.get(item.id)?.state, 'unknown');
  assert.equal(p.hasTimer(), false);
  assert.equal(p.posts.length, 1);
  p.controller.dispose();
});
