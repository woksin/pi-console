import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { NewEvent } from '@pi-console/contract';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { Projector } from '../projector/projector.ts';
import { consoleProjections, readModels } from './index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { testEvent } from '../testing/events.ts';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 20, 8, minute)).toISOString();
const source = 'intent-memory';
const added = (n: number, itemId: string, over: Record<string, unknown> = {}, minute = n) => testEvent(n, 'MemoryItemRecorded', {
  itemId, kind: 'directive', scopeKind: 'session', scopeKey: 's1', sourceType: 'user_message', sourceMessageId: null, authorityMode: 'auto',
  supersedes: [], excerpt: `synthetic ${itemId}`, withheld: false, ...over,
}, { source, occurredAt: at(minute), subject: `source:memory-item:${itemId}` });
const message = (n: number, messageId: string, origin: string, sessionId = 's1') =>
  testEvent(n, 'MemoryMessageRecorded', { messageId, sessionId, origin, injectedKind: null, withheld: false, textBytes: 10 }, { source, occurredAt: at(n), subject: `session:${sessionId}` });
const session = (n: number, id: string) => testEvent(n, 'SessionStarted', { sessionId: id, cwd: '/synthetic/repo', model: null, role: 'main', parentSessionId: null });

async function queriesOver(events: NewEvent[]) {
  const log = new SqliteEventLog(':memory:');
  await log.append(events);
  const projector = new Projector(log, consoleProjections());
  await projector.catchUp();
  log.close();
  return new ConsoleQueries(() => readModels(projector), () => new Date(at(30)));
}
const statuses = async (events: NewEvent[]) => Object.fromEntries((await queriesOver(events)).memoryItems().map(item => [item.id, [item.status, item.statusBasis]]));

test('initial status follows kind, authority and the cited message, with assumed basis only where the producer decides', async () => {
  const result = await statuses([
    message(1, 'm-human', 'human'), message(2, 'm-injected', 'injected'),
    added(3, 'order', { kind: 'order', sourceType: 'coordinator_order' }), added(4, 'decision', { kind: 'decision', sourceType: 'agent_decision', authorityMode: null }),
    added(5, 'none', { authorityMode: 'none' }), added(6, 'human', { sourceMessageId: 'm-human' }),
    added(7, 'injected', { sourceMessageId: 'm-injected' }), added(8, 'unknown', { sourceMessageId: 'm-missing' }),
  ]);
  assert.deepEqual(result, {
    order: ['proposed', 'recorded'], decision: ['active', 'recorded'], none: ['proposed', 'recorded'], human: ['active', 'assumed'],
    injected: ['proposed', 'recorded'], unknown: ['active', 'assumed'],
  });
});

test('a message that arrives after the item re-derives it', async () => {
  assert.deepEqual(await statuses([added(1, 'late', { sourceMessageId: 'm-1' }), message(2, 'm-1', 'unattended')]), { late: ['proposed', 'recorded'] });
});

test('confirm only changes proposed items, retire sets the status, and supersedes retires its targets', async () => {
  const result = await statuses([
    added(1, 'o1', { kind: 'order' }), added(2, 'o2', { kind: 'order' }), added(3, 'a', { kind: 'decision' }), added(4, 'b', { kind: 'decision' }),
    testEvent(5, 'MemoryItemConfirmed', { itemId: 'o1', actorKind: 'human' }, { source, occurredAt: at(5), subject: 'source:memory-item:o1' }),
    testEvent(6, 'MemoryItemConfirmed', { itemId: 'a', actorKind: 'human' }, { source, occurredAt: at(6), subject: 'source:memory-item:a' }),
    testEvent(7, 'MemoryItemRetired', { itemId: 'o2', status: 'rejected', actorKind: 'human', reasonExcerpt: 'synthetic' }, { source, occurredAt: at(7), subject: 'source:memory-item:o2' }),
    added(8, 'c', { kind: 'decision', supersedes: ['b'] }),
  ]);
  assert.deepEqual(result, { o1: ['active', 'recorded'], o2: ['rejected', 'recorded'], a: ['active', 'recorded'], b: ['superseded', 'recorded'], c: ['active', 'recorded'] });
});

test('replay in any arrival order folds to the same statuses', async () => {
  const events = [
    added(1, 'o1', { kind: 'order' }), testEvent(2, 'MemoryItemConfirmed', { itemId: 'o1', actorKind: 'human' }, { source, occurredAt: at(2), subject: 'source:memory-item:o1' }),
    testEvent(3, 'MemoryItemRetired', { itemId: 'o1', status: 'withdrawn', actorKind: 'human', reasonExcerpt: '' }, { source, occurredAt: at(3), subject: 'source:memory-item:o1' }),
  ];
  assert.deepEqual(await statuses([...events].reverse()), await statuses(events));
  assert.deepEqual(await statuses(events), { o1: ['withdrawn', 'recorded'] });
});

test('items resolve to a session by scope or by the cited message, and the summary counts per session', async () => {
  const queries = await queriesOver([
    session(1, 's1'), session(2, 's2'), message(3, 'm-1', 'human', 's2'), message(4, 'm-2', 'human', 's2'), message(5, 'm-3', 'injected', 's2'),
    added(6, 'scoped', { kind: 'order' }), added(7, 'cited', { scopeKind: 'repo', scopeKey: 'r', sourceMessageId: 'm-1' }),
    added(8, 'wide', { kind: 'decision', scopeKind: 'global', scopeKey: 'all' }),
    testEvent(9, 'MemoryMessageClassified', { messageId: 'm-2', whole: 'none', spanCount: 0 }, { source, occurredAt: at(9), subject: 'message:m-2' }),
  ]);
  assert.deepEqual(queries.memoryItems().map(item => [item.id, item.sessionId]), [['scoped', 's1'], ['cited', 's2'], ['wide', null]]);
  const one = queries.sessionMemory('s1')!;
  assert.deepEqual([one.counts.proposed, one.counts.active, one.proposedConfirmable, one.wider, one.storeDetected], [1, 0, 1, 1, true]);
  assert.deepEqual([queries.sessionMemory('s2')!.counts.active, queries.sessionMemory('s2')!.unresolved.lowerBound], [1, 0]);
  assert.equal(queries.sessionMemory('nope'), undefined);
});

test('unresolved lower bound counts human messages with no classification and no citing item', async () => {
  const queries = await queriesOver([session(1, 's1'), message(2, 'm-1', 'human'), message(3, 'm-2', 'human'), message(4, 'm-3', 'launch'), added(5, 'a', { sourceMessageId: 'm-2' })]);
  assert.equal(queries.sessionMemory('s1')!.unresolved.lowerBound, 1);
});

test('a session without any memory fact reports no store', async () => {
  const summary = (await queriesOver([session(1, 's1')])).sessionMemory('s1')!;
  assert.deepEqual([summary.storeDetected, summary.counts.active, summary.handoffs], [false, 0, []]);
});

test('proposed items raise one attention item per session, with the command only for a single item', async () => {
  const queries = await queriesOver([
    session(1, 's1'), added(2, 'p1', { kind: 'order' }), added(3, 'p2', { kind: 'order', scopeKind: 'repo', scopeKey: 'r' }),
    added(4, 'p3', { kind: 'order', scopeKind: 'session', scopeKey: 's1' }), added(5, 'quiet', { kind: 'decision' }),
  ]);
  const items = queries.needsYou().filter(item => item.reason === 'proposed-memory');
  assert.deepEqual(items.map(item => [item.id, item.sessionId, item.text, item.pointer]), [
    ['memory:s1', 's1', '2 proposed memory items waiting for /memory confirm', null],
    ['memory:unlinked', null, '1 proposed memory item waiting for /memory confirm p2', null],
  ]);
  assert.equal(items[0].since, at(2));
});

test('memory items page with a status filter and carry the confirm command only when proposed', async () => {
  const queries = await queriesOver([added(1, 'o', { kind: 'order' }), added(2, 'd', { kind: 'decision' })]);
  const page = queries.page('memoryItems', { limit: 10, status: 'proposed' });
  assert.deepEqual(page.items.map(item => [item.id, 'command' in item ? item.command : undefined]), [['o', '/memory confirm o']]);
  assert.equal(page.total, 1);
  assert.equal(queries.memoryItems('active')[0].command, null);
});
