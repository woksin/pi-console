import { test } from 'node:test';
import { rmSync } from 'node:fs';
import assert from 'node:assert/strict';
import { testEvent } from '@pi-console/core/testing';
import { openStream } from '@pi-console/testkit';
import { defaultConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { publishedAfter, sessionStarted, specDaemon } from '../testing/harness.ts';

test('shutdown drains pending multi-update frames before closing their durable sequence store', async () => {
  const spec = await specDaemon([sessionStarted(1, 's1')]);
  const seq = spec.daemon.stream.seq;
  try {
    await spec.daemon.log.append([testEvent(2, 'RequestObserved', { requestId: 'r1', sessionId: 's1', origin: 'launch', originEvidence: 'spec' })]);
  } finally { await spec.close(); }
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
