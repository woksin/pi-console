import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { consoleProjections } from '../projections/index.ts';
import { requestsProjection } from '../projections/requests.ts';
import { testEvent } from '../testing/events.ts';
import { Projector, type ProjectionChanges } from './projector.ts';
import { SqliteProjectionStore } from './sqlite-projection-store.ts';

for (const rowStore of [false, true]) test(`applied IDs survive persistence flushes (${rowStore ? 'SQLite' : 'memory'})`, async t => {
  const log = new SqliteEventLog(':memory:');
  const store = rowStore ? new SqliteProjectionStore(':memory:') : undefined;
  const projector = new Projector(log, consoleProjections(), store);
  await projector.start();
  t.after(() => { projector.stop(); store?.close(); log.close(); });
  const seen: ProjectionChanges[] = [];
  projector.onApplied((_event, changes) => { seen.push(changes); });
  for (let n = 1; n <= 501; n++) {
    await log.append([testEvent(n, 'RequestObserved', { requestId: `r${n}`, sessionId: 's1', origin: 'launch', originEvidence: 'spec' })]);
  }
  assert.deepEqual([...seen[0].get('requests')!.get('requests')!], ['r1']);
  assert.deepEqual([...seen[500].get('requests')!.get('requests')!], ['r501']);
  await log.append([testEvent(502, 'SessionHeartbeat', { sessionId: 's1' })]);
  assert.equal(seen.at(-1)!.has('requests'), false);
  projector.flush();
  assert.deepEqual([...seen[0].get('requests')!.get('requests')!], ['r1'], 'retained IDs are event-local, not persistence sets');
});

test('custom pass-through requests report every touched row without changing their output', async t => {
  const log = new SqliteEventLog(':memory:');
  const projector = new Projector(log, [requestsProjection]);
  await projector.start();
  t.after(() => { projector.stop(); log.close(); });
  const seen: string[][] = [];
  projector.onApplied((_event, changes) => { seen.push([...changes.get('requests')?.get('requests') ?? []]); });
  await log.append([
    testEvent(1, 'RequestObserved', { requestId: '__proto__', sessionId: 's', origin: 'human', originEvidence: 'spec' }),
    testEvent(2, 'AnswerObserved', { requestId: '__proto__', answerId: 'a', interim: false }),
  ]);
  assert.deepEqual(seen, [['__proto__'], ['__proto__']]);
});
