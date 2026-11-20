import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { SqliteEventLog } from '@pi-console/core';
import { testEvent } from '@pi-console/core/testing';
import { call, openStream } from '@pi-console/testkit';
import { defaultConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import { publishedAfter, sessionStarted, specDaemon } from './testing/harness.ts';

// Stream ids start at the projected log position and each delta covers at least one event, so an old id is never
// above the new base. Equal means nothing happened since (the client is current); lower means it gets a snapshot.
test('stream ids continue across a restart; a stale pre-restart id resumes with a fresh snapshot', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  t.after(() => { rmSync(spec.directory, { recursive: true, force: true }); });
  const bearer = { Authorization: `Bearer ${spec.token}` };
  const before = spec.daemon.stream.seq;
  await spec.daemon.log.append([testEvent(2, 'SessionHeartbeat', { sessionId: 's1' })]);
  await publishedAfter(spec.daemon, before);
  const lastSeen = spec.daemon.stream.seq;
  await spec.daemon.close();
  const log = new SqliteEventLog(join(spec.directory, 'console.db'));
  await log.append([testEvent(3, 'SessionHeartbeat', { sessionId: 's1' })]);
  log.close();

  const restarted = await startDaemon({ ...defaultConfig(spec.directory), port: 0, sessionRoots: [], ingest: false });
  t.after(() => restarted.close());
  assert.ok(restarted.stream.seq >= lastSeen, 'ids never go backwards for the same database');
  const resumed = await openStream(restarted.port, { ...bearer, 'Last-Event-ID': String(lastSeen) });
  const first = await resumed.next();
  assert.equal(first.event, 'snapshot');
  assert.ok(first.data.payload.sessions.some((session: { id: string }) => session.id === 's1'));
  resumed.close();
  const current = await openStream(restarted.port, { ...bearer, 'Last-Event-ID': String(restarted.stream.seq) });
  await restarted.log.append([testEvent(4, 'SessionHeartbeat', { sessionId: 's1' })]);
  assert.equal((await current.next()).event, 'session.updated', 'a current client gets deltas, not a snapshot');
  current.close();
});

test('events applied in one tick are coalesced into one delta per entity', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  t.after(() => spec.close());
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}` });
  const snapshot = await stream.next();
  await spec.daemon.log.append([1, 2, 3].map(n => testEvent(10 + n, 'SessionHeartbeat', { sessionId: 's1' })));
  const delta = await stream.next();
  assert.equal(delta.event, 'session.updated');
  assert.equal(Number(delta.id), snapshot.data.seq + 1);
  await assert.rejects(stream.next(100));
  stream.close();
});

test('health reports log, projection, stream and backfill state', async t => {
  const spec = await specDaemon();
  t.after(() => spec.close());
  const { body } = await call(spec.daemon.port, '/api/v1/health', { headers: { Authorization: `Bearer ${spec.token}` } });
  assert.equal(body.status, 'ok');
  assert.equal(body.eventLog.lastSeq, body.projection.position);
  assert.ok(body.eventLog.dbBytes > 0);
  assert.equal(body.projection.queueDepth, 0);
  assert.equal(body.stream.seq, spec.daemon.stream.seq);
  assert.ok(spec.daemon.startupMs > 0);
});

test('a slow SSE consumer is disconnected instead of buffering without bound', async t => {
  const spec = await specDaemon([sessionStarted(1, 's1')], { maxBufferedBytes: 1 });
  t.after(() => spec.close());
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}` });
  for (let i = 0; i < 50 && spec.daemon.stream.clients > 0; i++) {
    await spec.daemon.log.append([testEvent(100 + i, 'SessionHeartbeat', { sessionId: 's1' })]);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(spec.daemon.stream.clients, 0);
  stream.close();
});
