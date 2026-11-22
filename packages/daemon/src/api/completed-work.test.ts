import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, openStream } from '@pi-console/testkit';
import { testEvent } from '@pi-console/core/testing';
import { sessionStarted, specDaemon } from '../testing/harness.ts';

// Startup catch-up commits and evicts the completed job before either HTTP or stream queries are constructed.
test('HTTP pages, session detail, stream snapshots and live deltas share completed work reads', async t => {
  const spec = await specDaemon([
    sessionStarted(1, 'owner'),
    testEvent(2, 'JobStarted', { jobId: 'j', sessionId: 'owner', kind: 'ci', name: 'build' }),
    testEvent(3, 'JobFinished', { jobId: 'j', status: 'done', exitCode: 0 }),
  ]);
  t.after(() => spec.close());
  const headers = { Authorization: `Bearer ${spec.token}` };
  const get = async (path: string) => (await call(spec.daemon.port, `/api/v1${path}`, { headers })).body;
  const full = await get('/jobs') as { items: { id: string; status: string }[] };
  assert.deepEqual(Object.keys(full), ['items']);
  assert.equal(full.items[0].status, 'done');
  assert.deepEqual(await get('/jobs?limit=1&order=desc'), { items: full.items, nextCursor: null, hasMore: false, total: 1 });
  const detail = await get('/sessions/owner') as { jobs: unknown[] };
  assert.deepEqual(detail.jobs, full.items);
  const stream = await openStream(spec.daemon.port, headers);
  t.after(() => stream.close());
  const snapshot = await stream.next();
  assert.deepEqual(snapshot.data.payload.jobs, full.items);
  await spec.daemon.log.append([testEvent(4, 'JobStarted', { jobId: 'j', sessionId: 'owner', kind: 'ci', name: 'late name' })]);
  const delta = await stream.next();
  assert.equal(delta.event, 'job.updated');
  assert.equal(delta.data.payload.name, 'late name');
  assert.equal(delta.data.payload.status, 'done');
  assert.deepEqual(delta.data.payload, (await get('/jobs') as { items: unknown[] }).items[0]);
});
