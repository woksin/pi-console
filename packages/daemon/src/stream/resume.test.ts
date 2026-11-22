import { test, type TestContext } from 'node:test';
import { rmSync } from 'node:fs';
import { createServer, get, type IncomingMessage } from 'node:http';
import assert from 'node:assert/strict';
import { testEvent } from '@pi-console/core/testing';
import { openStream } from '@pi-console/testkit';
import { defaultConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { publishedAfter, sessionStarted, specDaemon } from '../testing/harness.ts';
import { StreamHub } from './stream-hub.ts';

test('shutdown drains pending multi-update frames before closing their durable sequence store', async () => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  const stream = await openStream(spec.daemon.port, { Authorization: `Bearer ${spec.token}` });
  const seq = spec.daemon.stream.seq;
  try {
    await spec.daemon.log.append([testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'spec' })]);
  } finally { await spec.close(); stream.close(); }
  assert.equal(spec.daemon.stream.seq, seq + 2);
  await new Promise<void>(resolve => { setImmediate(resolve); });
});

test('restart reserves a snapshot barrier above multi-update ids, even above the event-log position', async () => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  const headers = { Authorization: `Bearer ${spec.token}` };
  const stream = await openStream(spec.daemon.port, headers);
  let restarted: Awaited<ReturnType<typeof startDaemon>> | undefined;
  let originalClosed = false;
  try {
    const initial = await stream.next();
    await spec.daemon.log.append([testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'spec' })]);
    await publishedAfter(spec.daemon, Number(initial.id));
    assert.equal((await stream.next()).event, 'request.observed');
    const session = await stream.next();
    assert.equal(session.event, 'session.updated');
    assert.ok(session.id);
    assert.ok(Number(session.id) > spec.daemon.log.lastSeq());
    stream.close();
    await spec.daemon.close();
    originalClosed = true;
    restarted = await startDaemon({ ...defaultConfig(spec.directory), port: 0, sessionRoots: [], ingest: false });
    const resumed = await openStream(restarted.port, { ...headers, 'Last-Event-ID': session.id });
    try {
      const snapshot = await resumed.next();
      assert.equal(snapshot.event, 'snapshot');
      assert.ok(Number(snapshot.id) > Number(session.id));
      assert.equal(snapshot.data.payload.sessions[0].status, 'needs-you');
      await assert.rejects(resumed.next(100));
    } finally { resumed.close(); }
  } finally {
    stream.close();
    await restarted?.close();
    if (!originalClosed) await spec.daemon.close();
    rmSync(spec.directory, { recursive: true, force: true });
  }
});

async function serveHub(t: TestContext, maxBufferedBytes = 512 * 1024) {
  const hub = new StreamHub({
    base: 0, persist: () => undefined, ringSize: 10_000, heartbeatMs: 60_000, maxBufferedBytes,
    snapshot: () => ({ text: 'current state' }), now: () => new Date('2026-01-01T00:00:00Z'),
  });
  const server = createServer((request, response) => {
    const after = request.headers['last-event-id'];
    hub.connect(response, typeof after === 'string' ? after : undefined);
  });
  t.after(async () => { hub.close(); server.closeAllConnections(); await server[Symbol.asyncDispose](); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return { hub, port: address.port };
}

function retainFrames(hub: StreamHub, count: number, text: string): void {
  for (let i = 0; i < count; i++) hub.publish('job.updated', { id: `j${i}`, text });
}

test('an HTTP resume whose retained replay exceeds the output cap bootstraps with the fresh snapshot', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t);
  retainFrames(hub, 3000, 'x'.repeat(256));
  assert.equal(hub.retained, 3000);
  const resumed = await openStream(port, { 'Last-Event-ID': '0' });
  t.after(() => resumed.close());
  assert.equal(resumed.status, 200);
  const snapshot = await resumed.next();
  assert.equal(snapshot.event, 'snapshot');
  assert.equal(snapshot.id, '3000');
  const fresh = await openStream(port, {});
  t.after(() => fresh.close());
  assert.deepEqual(snapshot, await fresh.next());
  assert.equal(hub.clients, 2);
  hub.publish('job.finished', { id: 'latest' });
  const live = await resumed.next();
  assert.equal(live.event, 'job.finished');
  assert.equal(live.id, '3001');
  assert.deepEqual(live, await fresh.next());
});

test('replay budgeting counts UTF-8 bytes and falls back before reaching the hard cap', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t, 2048);
  retainFrames(hub, 2, '界'.repeat(200));
  const stream = await openStream(port, { 'Last-Event-ID': '0' });
  t.after(() => stream.close());
  const snapshot = await stream.next();
  assert.equal(snapshot.event, 'snapshot');
  assert.equal(snapshot.id, '2');
  assert.equal(hub.clients, 1);
});

test('small HTTP replays preserve every frame in exact sequence and payload order', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t);
  retainFrames(hub, 5, 'small');
  const stream = await openStream(port, { 'Last-Event-ID': '2' });
  t.after(() => stream.close());
  for (let seq = 3; seq <= 5; seq++) {
    const frame = await stream.next();
    assert.equal(frame.id, String(seq));
    assert.equal(frame.event, 'job.updated');
    assert.deepEqual(frame.data.payload, { id: `j${seq - 1}`, text: 'small' });
  }
  hub.publish('job.finished', { id: 'latest' });
  const live = await stream.next();
  assert.equal(live.id, '6');
  assert.equal(live.event, 'job.finished');
});

test('a small tail replays even when the whole retained ring exceeds the byte budget', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t);
  retainFrames(hub, 3000, 'x'.repeat(256));
  const stream = await openStream(port, { 'Last-Event-ID': '2998' });
  t.after(() => stream.close());
  for (const id of ['2999', '3000']) {
    const frame = await stream.next();
    assert.equal(frame.id, id);
    assert.equal(frame.event, 'job.updated');
  }
});

test('an HTTP resume at the current position receives only subsequent live deltas', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t);
  retainFrames(hub, 3, 'small');
  const stream = await openStream(port, { 'Last-Event-ID': '3' });
  t.after(() => stream.close());
  hub.publish('job.finished', { id: 'latest' });
  const frame = await stream.next();
  assert.equal(frame.id, '4');
  assert.equal(frame.event, 'job.finished');
});

test('the unchanged live output cap disconnects an HTTP client that does not read', { timeout: 10_000 }, async t => {
  const { hub, port } = await serveHub(t, 16 * 1024);
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = get(`http://127.0.0.1:${port}/api/v1/stream`, resolve);
    request.on('error', reject);
    t.after(() => { request.destroy(); });
  });
  response.on('error', () => undefined);
  response.pause();
  assert.equal(response.statusCode, 200);
  assert.equal(hub.clients, 1);
  // Publish without yielding so unsent output accumulates while the peer remains paused.
  retainFrames(hub, 50, 'x'.repeat(1024));
  assert.equal(hub.clients, 0);
});
