import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStream } from '@pi-console/testkit';
import { consoleProjections, Projector, readModels, SqliteEventLog, SqliteProjectionStore } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { publishedAfter, sessionStarted, specDaemon } from '../testing/harness.ts';
import { DeltaBatcher } from './delta-batcher.ts';

const request = (n: number) => testEvent(n, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'spec' });
const answer = (n: number) => testEvent(n, 'AnswerObserved', { requestId: 'r1', answerId: 'a1', interim: false });

test('discarded batches never query read models or publish, but the next observed batch does', async t => {
  const log = new SqliteEventLog(':memory:');
  const store = new SqliteProjectionStore(':memory:');
  const projector = new Projector(log, consoleProjections(), store);
  await projector.start();
  t.after(() => { projector.stop(); store.close(); log.close(); });
  let reads = 0;
  let published = 0;
  let idle = true;
  const batcher = new DeltaBatcher(() => { reads++; return readModels(projector); }, () => { published++; }, () => new Date(), { discard: () => idle });
  const stop = projector.onApplied((event, changes) => { batcher.add(event, changes); });
  t.after(() => { stop(); batcher.flush(); });
  reads = 0;
  await log.append([sessionStarted(1, 's1'), request(2)]);
  batcher.flush();
  assert.equal(batcher.pending, 0);
  assert.equal(reads, 0);
  assert.equal(published, 0);
  idle = false;
  await log.append([answer(3)]);
  batcher.flush();
  assert.ok(reads > 0);
  assert.ok(published > 0);
});

async function waitForDisconnect(daemon: Awaited<ReturnType<typeof specDaemon>>['daemon']): Promise<void> {
  for (let i = 0; i < 100 && daemon.stream.clients > 0; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(daemon.stream.clients, 0);
}

test('after an unobserved gap, the first observed batch updates only the sessions it changed', async t => {
  const spec = await specDaemon([]);
  t.after(() => spec.close());
  await spec.daemon.log.append([sessionStarted(1, 's1'), sessionStarted(2, 's2')]);
  await publishedAfter(spec.daemon, spec.daemon.stream.seq);
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}` });
  t.after(() => stream.close());
  const snapshot = await stream.next();
  assert.deepEqual(snapshot.data.payload.sessions.map((session: { id: string }) => session.id).sort(), ['s1', 's2']);
  await spec.daemon.log.append([request(3)]);
  const frames = [await stream.next(), await stream.next()];
  // A later, unrelated delta marks the end of the first batch's frames.
  await spec.daemon.log.append([sessionStarted(4, 's3')]);
  for (let frame = await stream.next(); frame.data.payload.id !== 's3'; frame = await stream.next()) frames.push(frame);
  assert.deepEqual(frames.map(frame => `${frame.event}:${frame.data.payload.id}`), ['request.observed:r1', 'session.updated:s1']);
});

test('reconnect across unobserved updates snapshots current state; observed frames remain replayable', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  t.after(() => spec.close());
  const headers = { Authorization: `Bearer ${spec.token}` };
  const first = await openStream(spec.daemon.port, headers);
  t.after(() => first.close());
  const initial = await first.next();
  first.close();
  await waitForDisconnect(spec.daemon);
  await spec.daemon.log.append([request(2)]);
  await publishedAfter(spec.daemon, Number(initial.id));
  assert.equal(spec.daemon.stream.retained, 0, 'unobserved history is invalidated');
  const resumed = await openStream(spec.daemon.port, { ...headers, 'Last-Event-ID': initial.id! });
  t.after(() => resumed.close());
  const snapshot = await resumed.next();
  assert.equal(snapshot.event, 'snapshot');
  assert.ok(Number(snapshot.id) > Number(initial.id));
  assert.equal(snapshot.data.payload.requests[0].status, 'open');
  await spec.daemon.log.append([answer(3)]);
  const entity = await resumed.next();
  const session = await resumed.next();
  assert.equal(entity.event, 'request.observed');
  assert.equal(session.event, 'session.updated');
  assert.equal(Number(session.id), Number(entity.id) + 1);
  const replay = await openStream(spec.daemon.port, { ...headers, 'Last-Event-ID': entity.id! });
  t.after(() => replay.close());
  const frame = await replay.next();
  assert.equal(frame.event, 'session.updated');
  assert.equal(frame.id, session.id);
});
