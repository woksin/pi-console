import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { Projector, type ProjectionChanges } from '../projector/projector.ts';
import { consoleProjections, readModels } from '../projections/index.ts';
import { testEvent } from '../testing/events.ts';
import { ConsoleQueries } from './console-queries.ts';
import { IncrementalQueries } from './incremental.ts';

const started = (n: number, sessionId: string, parentSessionId: string | null = null) => testEvent(n, 'SessionStarted', { sessionId, cwd: '/repo', model: null, role: parentSessionId ? 'subagent' : 'main', parentSessionId });
const item = (n: number, itemId: string, extra: Record<string, unknown> = {}) => testEvent(n, 'MemoryItemRecorded', {
  itemId, kind: 'order', scopeKind: 'session', scopeKey: 's1', sourceType: 'user_message', sourceMessageId: null,
  authorityMode: 'auto', supersedes: [], excerpt: itemId, withheld: false, ...extra,
});
const message = (n: number, sessionId: string, origin = 'human') => testEvent(n, 'MemoryMessageRecorded', { messageId: 'm1', sessionId, origin, injectedKind: null, withheld: false, textBytes: 1 });

function merge(target: Map<string, Map<string, Set<string>>>, changes: ProjectionChanges): void {
  for (const [name, collections] of changes) {
    let rows = target.get(name);
    if (!rows) { rows = new Map(); target.set(name, rows); }
    mergeCollections(rows, collections);
  }
}

function mergeCollections(rows: Map<string, Set<string>>, collections: ReadonlyMap<string, ReadonlySet<string>>): void {
  for (const [collection, ids] of collections) {
    let merged = rows.get(collection);
    if (!merged) { merged = new Set(); rows.set(collection, merged); }
    for (const id of ids) merged.add(id);
  }
}

const reset = (n: number, sessionId: string, date: string) => ({
  ...testEvent(n, 'ResetOccurred', { sessionId, resetId: 'same', kind: 'compaction' }), occurredAt: `${date}T08:00:00.000Z`,
});

for (const bootstrap of [false, true]) test(`colliding reset IDs retain canonical earliest sightings and stable owner ties (${bootstrap ? 'bootstrap' : 'incremental'})`, async t => {
  const log = new SqliteEventLog(':memory:');
  const events = [
    reset(3, 'z', '2026-11-21'), reset(4, 'a', '2026-11-20'),
    reset(5, 'z', '2026-11-19'), reset(6, 'a', '2026-11-19'), reset(7, 'z', '2026-11-22'),
    started(8, '2'), reset(9, '2', '2026-11-19'), started(10, '1'), reset(11, '1', '2026-11-19'),
    started(12, '01'), reset(13, '01', '2026-11-19'), reset(14, 'a', '2026-11-18'),
  ];
  const seeded = bootstrap ? 2 : 0;
  await log.append([started(1, 'z'), started(2, 'a'), ...events.slice(0, seeded)]);
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  t.after(() => { projector.stop(); log.close(); });
  const models = () => readModels(projector);
  const now = new Date('2026-11-23T08:00:00Z');
  const full = new ConsoleQueries(models, () => now);
  const incremental = new IncrementalQueries(models, now);
  const changes = new Map<string, Map<string, Set<string>>>();
  projector.onApplied((_event, dirty) => { merge(changes, dirty); });
  assert.deepEqual(incremental.resetById('same'), full.resetById('same'));
  assert.equal(incremental.resetById('missing'), undefined);
  for (const event of events.slice(seeded)) {
    changes.clear();
    await log.append([event]);
    const owners = event.type === 'ResetOccurred' ? [(event.payload as { sessionId: string }).sessionId] : [];
    incremental.update(changes, now, owners);
    assert.deepEqual(incremental.resetById('same'), full.resetById('same'), event.id);
    assert.deepEqual(new IncrementalQueries(models, now).resetById('same'), full.resetById('same'), `rebase ${event.id}`);
  }
});

test('incremental views match canonical queries through late owners, lineage, raw pairing, memory and clock changes', async t => {
  const log = new SqliteEventLog(':memory:');
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  t.after(() => { projector.stop(); log.close(); });
  let now = new Date('2026-11-20T08:00:00Z');
  const models = () => readModels(projector);
  const full = new ConsoleQueries(models, () => now);
  let incremental = new IncrementalQueries(models, now);
  const changes = new Map<string, Map<string, Set<string>>>();
  projector.onApplied((_event, dirty) => { merge(changes, dirty); });
  const batches: NewEvent[][] = [
    [started(1, 's1'), started(2, 's2')],
    [testEvent(3, 'QuestionAsked', { questionId: 'q1', asker: 'late', kind: 'question', urgency: 'normal', blocking: true, excerpt: 'old' })],
    [started(4, 'late')],
    [testEvent(5, 'QuestionRevised', { questionId: 'q1', excerpt: 'new' })],
    [testEvent(6, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'human', originEvidence: 'spec' })],
    [testEvent(7, 'RequestObserved', { requestId: 'r1', sessionId: 's2', origin: 'human', originEvidence: 'spec' })],
    [item(8, 'i1', { scopeKind: 'global', scopeKey: '', sourceMessageId: 'm1' })],
    [message(9, 's1')], [message(10, 's2', 'injected')],
    [testEvent(11, 'MemoryItemConfirmed', { itemId: 'i1', actorKind: 'human', reasonExcerpt: '' })],
    [item(12, 'i2', { supersedes: ['i1'] })],
    [testEvent(13, 'MemoryMessageClassified', { messageId: 'm1', whole: 'none', spanCount: 0 })],
    [testEvent(14, 'RequestObserved', { raw: true, sessionId: 's1', entryId: 'p1', requestId: 'raw', origin: 'unproven', originEvidence: 'spec' })],
    [testEvent(15, 'AnswerObserved', { raw: true, sessionId: 's1', entryId: 'a1', answerId: 'a1', interim: false, excerpt: 'answer', withheld: false })],
    [testEvent(16, 'ResetOccurred', { sessionId: 's1', resetId: 'reset', kind: 'compaction' })],
    [started(17, 'child', 'missing')], [started(18, 'missing', 's1')],
    [testEvent(19, 'TurnStarted', { sessionId: 's2', turnId: 't1' })],
    [testEvent(20, 'SessionHeartbeat', { sessionId: 's1' })],
  ];
  for (const [n, events] of batches.entries()) {
    changes.clear();
    await log.append(events);
    const updated = incremental.update(changes, now, events.filter(event => event.type === 'ResetOccurred').map(event => (event.payload as { sessionId: string }).sessionId));
    if (n === 0) assert.deepEqual(updated.memory, new Set(['s1', 's2']));
    if (n === 5) assert.deepEqual(updated.sessions, new Set(['s1', 's2']), 'request migration invalidates both owners');
    if (n === 8) assert.deepEqual(updated.memory, new Set(['s1', 's2']), 'source migration invalidates both owners');
    for (const session of full.sessions()) {
      assert.deepEqual(incremental.sessionById(session.id), session, `session in batch ${n}`);
      assert.deepEqual(incremental.sessionMemory(session.id), full.sessionMemory(session.id), `memory in batch ${n}`);
    }
    if (n === 10) incremental = new IncrementalQueries(models, now); // snapshot/reconnect rebase
  }
  now = new Date('2026-11-20T08:30:19.000Z');
  assert.equal(incremental.update(new Map(), now).sessions.has('s2'), false, 'strict stale boundary');
  now = new Date('2026-11-20T08:30:19.001Z');
  assert.equal(incremental.update(new Map(), now).sessions.has('s2'), true);
  assert.deepEqual(incremental.sessionById('s2'), full.sessionById('s2'));
  now = new Date('2026-11-20T08:00:00Z');
  assert.equal(incremental.update(new Map(), now).sessions.has('s2'), true, 'rollback removes stale attention');
  assert.deepEqual(incremental.sessionById('s2'), full.sessionById('s2'));
});
