import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Session } from '@pi-console/contract';
import { consoleProjections, Projector, readModels, SqliteEventLog, type Delta } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { DeltaBatcher } from './delta-batcher.ts';

test('cost-only and lane-only batches publish final sessions once without a reconnect', async t => {
  const log = new SqliteEventLog(':memory:');
  await log.append([testEvent(1, 'SessionStarted', { sessionId: 's', cwd: '/work/repo', model: null, role: 'main', parentSessionId: null })]);
  const projector = new Projector(log, consoleProjections());
  await projector.start();
  const deltas: Delta[] = [];
  const batcher = new DeltaBatcher(() => readModels(projector), delta => deltas.push(delta), () => new Date('2026-11-20T08:00:00Z'));
  projector.onApplied((event, changes) => { batcher.add(event, changes); });
  t.after(() => { batcher.flush(); projector.stop(); log.close(); });
  await log.append([
    testEvent(2, 'SessionCostObserved', { sessionId: 's', entryId: 'a', costUsd: 0 }),
    testEvent(3, 'SessionCostObserved', { sessionId: 's', entryId: 'b', costUsd: 1.5 }),
    testEvent(4, 'SessionCostObserved', { sessionId: 's', entryId: 'c', costUsd: null }),
  ]);
  batcher.flush();
  assert.deepEqual(deltas.map(delta => delta.type), ['session.updated']);
  assert.equal((deltas[0].payload as Session).costUsd, 1.5);
  assert.equal((deltas[0].payload as Session).costIncomplete, true);
  deltas.length = 0;
  await log.append([testEvent(5, 'LaneRegistered', { laneId: 'L1', name: 'L1', cwd: '/work/repo/', branch: 'feature' }, { source: 'lane-messages' })]);
  batcher.flush();
  assert.equal(deltas.filter(delta => delta.type === 'session.updated').length, 1);
  const session = deltas.find(delta => delta.type === 'session.updated')!.payload as Session;
  assert.equal(session.laneId, 'L1');
  assert.equal(session.branch, 'feature');
  assert.equal(session.costUsd, 1.5);
});
