import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels, type ReadModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { testEvent } from '../testing/events.ts';
import { canonicalJson } from './canonical.ts';
import { Projector } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';
import { MemoryProjectionStore, type ProjectionStore } from './projection.ts';
import { parseRecords } from './records.ts';

function assertDictionaries(models: ReadModels, id: string): void {
  for (const state of Object.values(models)) {
    for (const dictionary of Object.values(state)) {
      assert.ok(dictionary !== null && typeof dictionary === 'object');
      assert.equal(Object.getPrototypeOf(dictionary), null);
      assert.ok(Object.hasOwn(dictionary, id));
    }
  }
}

async function hostileId(id: string): Promise<void> {
  const before = Object.getOwnPropertyDescriptors(Object.prototype);
  const log = new SqliteEventLog(':memory:');
  const store = new SqliteProjectionStore(':memory:');
  try {
    await log.append([
      testEvent(1, 'SessionStarted', { sessionId: id, cwd: '/repo', model: null, role: 'main', parentSessionId: null }),
      testEvent(2, 'ContextPressureSampled', { sessionId: id, percent: 20 }),
      testEvent(3, 'RequestObserved', { requestId: id, sessionId: id, origin: 'human', originEvidence: 'spec' }),
      testEvent(4, 'QuestionAsked', { questionId: id, asker: id, kind: 'question', urgency: 'high', blocking: true }),
      testEvent(5, 'MessageRead', { messageId: id }),
      testEvent(6, 'JobFinished', { jobId: id, status: 'done' }),
      testEvent(7, 'LaneClosed', { laneId: id }),
      testEvent(8, 'ReviewRecorded', { reviewId: id, headSha: 'abc', verdict: 'approved' }),
    ]);
    const projector = new Projector(log, consoleProjections(), store);
    await projector.catchUp(); projector.flush();
    const restored = new Projector(log, consoleProjections(), store);
    await restored.start(); restored.stop();
    await log.append([testEvent(9, 'TurnStarted', { sessionId: id, turnId: id }),
      testEvent(10, 'MessageSent', { messageId: id, from: id, to: id, excerpt: 'safe' })]);
    await restored.catchUp();
    const models = readModels(restored);
    assertDictionaries(models, id);
    const queries = new ConsoleQueries(() => models);
    assert.equal(queries.session(id)?.session.id, id);
    assert.equal(queries.messages()[0].status, 'read');
    const snapshot = canonicalJson(models);
    assert.ok(snapshot.includes(JSON.stringify(id)));
    const replayed = new Projector(log, consoleProjections());
    await replayed.catchUp();
    assert.equal(canonicalJson(readModels(replayed)), snapshot);
    assert.deepEqual(Object.getOwnPropertyDescriptors(Object.prototype), before);
  } finally { log.close(); store.close(); }
}

for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
  test(`hostile id ${id} remains an own dictionary key across every model, snapshot restore and replay`, () => hostileId(id));
}

test('parsed records have no prototype at any depth and keep hostile keys as own data', () => {
  const parsed = parseRecords<{ rows: Record<string, { stamps: Record<string, string>; list: { at: string }[] }> }>(
    '{"rows":{"__proto__":{"stamps":{"constructor":"x"},"list":[{"at":"1"}]}}}');
  const row = parsed.rows.__proto__;
  for (const record of [parsed, parsed.rows, row, row.stamps, row.list[0]]) assert.equal(Object.getPrototypeOf(record), null);
  assert.ok(Array.isArray(row.list));
  assert.ok(Object.hasOwn(parsed.rows, '__proto__'));
  assert.equal(row.stamps.constructor, 'x');
  assert.equal(({} as Record<string, unknown>).stamps, undefined);
});

test('a restored projector owns the loaded state instead of copying it again', () => {
  const store = new MemoryProjectionStore();
  const [projection] = consoleProjections();
  store.save([{ name: projection.name, version: projection.version, position: 0, state: projection.initial() }]);
  let loaded: unknown;
  const spy: ProjectionStore = { save: records => { store.save(records); }, load: name => {
    const record = store.load(name);
    if (name === projection.name) loaded = record?.state;
    return record;
  } };
  const log = new SqliteEventLog(':memory:');
  try {
    const projector = new Projector(log, [projection], spy);
    assert.ok(loaded !== undefined);
    assert.equal(projector.state(projection.name), loaded);
    assert.equal(Object.getPrototypeOf(loaded), null);
  } finally { log.close(); }
});
