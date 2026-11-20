import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteEventLog } from '../event-log/sqlite-event-log.ts';
import { testEvent } from '../testing/events.ts';
import { Projector } from '../projector/projector.ts';
import { lanesProjection, type LanesState } from './lanes.ts';

const registered = (n: number, repositoryId: string | null) => testEvent(n, 'LaneRegistered', { laneId: 'L0', name: 'L0', repositoryId }, { source: 'lane-messages' });

async function laneAfter(...events: ReturnType<typeof registered>[]) {
  const log = new SqliteEventLog(':memory:');
  await log.append(events);
  const projector = new Projector(log, [lanesProjection]);
  await projector.catchUp();
  return (projector.state('lanes') as LanesState).lanes.L0;
}

test('a later registration without a repository (a roster entry) keeps the repository lanes.json gave', async () => {
  assert.equal((await laneAfter(registered(1, 'example/console'), registered(2, null))).repositoryId, 'example/console');
  assert.equal((await laneAfter(registered(1, null), registered(2, 'example/console'))).repositoryId, 'example/console');
  assert.equal((await laneAfter(registered(1, 'a/b'), registered(2, 'c/d'))).repositoryId, 'c/d');
});
