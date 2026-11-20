import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections, readModels, type ReadModels } from '../projections/index.ts';
import { ConsoleQueries } from '../queries/console-queries.ts';
import { testEvent } from '../testing/events.ts';
import { canonicalJson } from './canonical.ts';
import { Projector } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';

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
