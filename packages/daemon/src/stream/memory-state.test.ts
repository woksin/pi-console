import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewEvent } from '@pi-console/contract';
import { consoleProjections, ConsoleQueries, Projector, readModels, SqliteEventLog, type Delta } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { sessionStarted } from '../testing/harness.ts';
import { DeltaBatcher } from './delta-batcher.ts';

const item = (n: number, itemId: string, extra: Record<string, unknown> = {}) => testEvent(n, 'MemoryItemRecorded', {
  itemId, kind: 'directive', scopeKind: 'session', scopeKey: 's1', sourceType: 'user_message', sourceMessageId: null,
  authorityMode: 'auto', supersedes: [], excerpt: `synthetic ${itemId}`, withheld: false, ...extra,
});
const message = (n: number, messageId: string, sessionId = 's1', origin = 'human') => testEvent(n, 'MemoryMessageRecorded', {
  messageId, sessionId, origin, injectedKind: null, withheld: false, textBytes: 123,
});
const marked = (deltas: Delta[]) => deltas.filter(delta => delta.type === 'session.updated' && (delta.payload as { memoryChanged?: boolean }).memoryChanged).map(delta => (delta.payload as { id: string }).id);
async function rig() {
  const log = new SqliteEventLog(':memory:');
  await log.append([sessionStarted(1, 's1'), sessionStarted(2, 's2')]);
  const projector = new Projector(log, consoleProjections()); await projector.start();
  const queries = new ConsoleQueries(() => readModels(projector));
  let deltas: Delta[] = [];
  const batcher = new DeltaBatcher(() => readModels(projector), delta => deltas.push(delta));
  projector.onApplied((event, changes) => { batcher.add(event, changes); });
  return { log: { close() { batcher.flush(); projector.stop(); log.close(); } }, queries, async apply(events: NewEvent[]) {
    deltas = [];
    await log.append(events);
    batcher.flush(); return deltas;
  } };
}

test('memory item, counts, basis, text and retirement changes invalidate canonical owners without transcript churn', async () => {
  const r = await rig();
  try {
    const first = await r.apply([item(3, 'i1')]);
    assert.deepEqual(marked(first), ['s1', 's2'], 'first store detection changes every known summary');
    const session = first.find(delta => delta.type === 'session.updated')!.payload as object;
    assert.deepEqual({ ...session, memoryChanged: undefined }, { ...r.queries.session('s1')!.session, memoryChanged: undefined });
    assert.equal(Object.hasOwn(r.queries.sessions()[0], 'memoryChanged'), false);
    assert.equal(Object.hasOwn(r.queries.snapshot(new Date().toISOString()).sessions[0], 'memoryChanged'), false);
    assert.deepEqual(marked(await r.apply([item(4, 'i1', { excerpt: 'changed excerpt' })])), ['s1']);
    assert.deepEqual(marked(await r.apply([item(5, 'i1', { kind: 'decision', excerpt: 'changed excerpt' })])), ['s1'], 'same active status but basis becomes recorded');
    assert.equal(r.queries.memoryItems()[0].statusBasis, 'recorded');
    assert.deepEqual(marked(await r.apply([testEvent(6, 'MemoryItemRetired', { itemId: 'i1', status: 'done', actorKind: 'human', reasonExcerpt: '' })])), ['s1']);
    assert.deepEqual(marked(await r.apply([testEvent(7, 'SessionHeartbeat', { sessionId: 's1' })])), []);
    assert.deepEqual(marked(await r.apply([testEvent(8, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'spec' })])), []);
    assert.deepEqual(marked(await r.apply([testEvent(9, 'ResetOccurred', { sessionId: 's1', resetId: 'reset', kind: 'compaction' })])), ['s1']);
  } finally { r.log.close(); }
});

test('late message association, reparenting, classification and wider unlinked items follow canonical queries', async () => {
  const r = await rig();
  try {
    await r.apply([item(3, 'global', { scopeKind: 'global', scopeKey: 'all', sourceMessageId: 'late' })]);
    assert.equal(r.queries.sessionMemory('s1')?.wider, 1);
    assert.deepEqual(marked(await r.apply([message(4, 'late')])), ['s1', 's2']);
    assert.equal(r.queries.memoryItems()[0].sessionId, 's1');
    assert.deepEqual(marked(await r.apply([message(5, 'late', 's2')])), ['s1', 's2']);
    assert.deepEqual(marked(await r.apply([message(6, 'unresolved', 's2')])), ['s2']);
    assert.equal(r.queries.sessionMemory('s2')?.unresolved.lowerBound, 1);
    assert.deepEqual(marked(await r.apply([testEvent(7, 'MemoryMessageClassified', { messageId: 'unresolved', whole: 'none', spanCount: 0 })])), ['s2']);
    assert.equal(r.queries.sessionMemory('s2')?.unresolved.lowerBound, 0);
  } finally { r.log.close(); }
});

test('origin-derived status, supersession and hidden rows beyond the page limit are fingerprinted', async () => {
  const r = await rig();
  try {
    await r.apply([item(3, 'old', { sourceMessageId: 'm1' })]);
    assert.deepEqual(marked(await r.apply([message(4, 'm1', 's1', 'injected')])), ['s1']);
    assert.equal(r.queries.memoryItems()[0].status, 'proposed');
    assert.deepEqual(marked(await r.apply([item(5, 'new', { supersedes: ['old'] })])), ['s1']);
    assert.equal(r.queries.memoryItems().find(row => row.id === 'old')?.status, 'superseded');
    await r.apply(Array.from({ length: 101 }, (_, n) => item(n + 10, `bulk-${n}`)));
    assert.deepEqual(marked(await r.apply([item(200, 'old', { excerpt: 'edited outside first page' })])), ['s1']);
    const deltas = await r.apply([message(201, 'm1', 's1', 'human'), message(202, 'm1', 's1', 'injected')]);
    assert.deepEqual(marked(deltas), [], 'net-equivalent batch emits no memory hint');
  } finally { r.log.close(); }
});
