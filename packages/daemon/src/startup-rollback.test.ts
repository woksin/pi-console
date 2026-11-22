import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Projector, SqliteEventLog, SqliteProjectionStore } from '@pi-console/core';
import { FileTranscriptReader } from './api/file-transcripts.ts';
import { defaultConfig } from './config.ts';
import { startDaemon } from './daemon.ts';
import { EventLoopHealth } from './event-loop.ts';
import { SessionIngestion } from './ingestion/session-ingestion.ts';
import { SourceSet } from './ingestion/sources.ts';
import { MemoryActions } from './memory/actions.ts';
import { StreamHub } from './stream/stream-hub.ts';

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'pi-startup-rollback-'));
  const databases = new Set<DatabaseSync>();
  const exec = t.mock.method(DatabaseSync.prototype, 'exec');
  t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    databases.add(this);
    return exec.call(this, sql);
  });
  const intervals = t.mock.method(globalThis, 'setInterval');
  const cleared = t.mock.method(globalThis, 'clearInterval');
  t.after(() => {
    for (const call of intervals.mock.calls) clearInterval(call.result);
    for (const database of databases) if (database.isOpen) database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    options: { ...defaultConfig(directory), port: 0, sessionRoots: [], memoryActions: true },
    assertReleased() {
      assert.ok(databases.size > 0);
      for (const database of databases) assert.equal(database.isOpen, false, 'SQLite handle closed');
      for (const call of intervals.mock.calls) {
        assert.ok(cleared.mock.calls.some(clear => clear.arguments[0] === call.result), 'interval cleared');
      }
    },
  };
}

function trackClose<T>(t: TestContext, target: { close(): T }, name: string, order: string[]) {
  const close = t.mock.method(target, 'close');
  return t.mock.method(target, 'close', function (this: typeof target) {
    order.push(name);
    return close.call(this);
  });
}

test('occupied listen rolls back stores, subscriptions, heartbeat and health in reverse order', async t => {
  const spec = fixture(t);
  const blocker = createServer();
  await new Promise<void>(resolve => { blocker.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { blocker.close(() => { resolve(); }); }));
  const order: string[] = [];
  trackClose(t, SqliteEventLog.prototype, 'log', order);
  trackClose(t, SqliteProjectionStore.prototype, 'store', order);
  trackClose(t, StreamHub.prototype, 'stream', order);
  trackClose(t, FileTranscriptReader.prototype, 'transcripts', order);
  trackClose(t, EventLoopHealth.prototype, 'health', order);
  trackClose(t, MemoryActions.prototype, 'actions', order);
  const projector = t.mock.method(Projector.prototype, 'stop');
  const sources = t.mock.method(SourceSet.prototype, 'stop');
  const ingestion = t.mock.method(SessionIngestion.prototype, 'stop');
  const stopDeltas = t.mock.fn();
  t.mock.method(Projector.prototype, 'onApplied', () => stopDeltas);
  const emit = t.mock.method(Server.prototype, 'emit');
  let original: unknown;
  await assert.rejects(startDaemon({ ...spec.options, port: (blocker.address() as { port: number }).port }), error => {
    original = error;
    return (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
  });
  assert.equal(emit.mock.calls.find(call => call.arguments[0] === 'error')?.arguments[1], original);
  assert.deepEqual(order, ['actions', 'health', 'transcripts', 'stream', 'store', 'log']);
  assert.equal(projector.mock.callCount(), 1);
  assert.equal(sources.mock.callCount(), 1);
  assert.equal(ingestion.mock.callCount(), 1);
  assert.equal(stopDeltas.mock.callCount(), 1, 'delta subscription removed');
  spec.assertReleased();
});

test('projection store opening failure releases the event log and the partially opened store', async t => {
  const spec = fixture(t);
  const original = new Error('projection schema failed');
  const exec = t.mock.method(DatabaseSync.prototype, 'exec');
  t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    exec.call(this, sql);
    if (sql.includes('CREATE TABLE IF NOT EXISTS projections')) throw original;
  });
  await assert.rejects(startDaemon(spec.options), error => error === original);
  spec.assertReleased();
});

test('projector startup failure stops its subscription and timer before closing stores', async t => {
  const spec = fixture(t);
  const original = new Error('projector startup failed');
  const start = t.mock.method(Projector.prototype, 'start');
  t.mock.method(Projector.prototype, 'start', async function (this: Projector) {
    await start.call(this);
    throw original;
  });
  const order: string[] = [];
  trackClose(t, SqliteProjectionStore.prototype, 'store', order);
  trackClose(t, SqliteEventLog.prototype, 'log', order);
  const stop = t.mock.method(Projector.prototype, 'stop');
  await assert.rejects(startDaemon(spec.options), error => error === original);
  assert.equal(stop.mock.callCount(), 1);
  assert.deepEqual(order, ['store', 'log']);
  spec.assertReleased();
});

test('cleanup failures do not replace the startup error or skip remaining cleanups', async t => {
  const spec = fixture(t);
  const original = new Error('listen failed');
  t.mock.method(Server.prototype, 'listen', () => { throw original; });
  const close = t.mock.method(StreamHub.prototype, 'close');
  t.mock.method(StreamHub.prototype, 'close', function (this: StreamHub) {
    close.call(this);
    throw new Error('cleanup failed');
  });
  const warnings = t.mock.method(process.stderr, 'write', () => true);
  await assert.rejects(startDaemon(spec.options), error => error === original);
  spec.assertReleased();
  assert.ok(warnings.mock.calls.length > 0, 'cleanup failure reported');
});

test('failure after ingestion starts closes the listener and stops all polling', async t => {
  const spec = fixture(t);
  const original = new Error('source startup failed');
  const start = t.mock.method(SourceSet.prototype, 'start');
  const started = t.mock.method(SourceSet.prototype, 'start', function (this: SourceSet, ready?: () => boolean) {
    start.call(this, ready);
    throw original;
  });
  const listening = t.mock.method(Server.prototype, 'listen');
  const polling = t.mock.method(SessionIngestion.prototype, 'start');
  const stop = t.mock.method(SessionIngestion.prototype, 'stop');
  const sources = t.mock.method(SourceSet.prototype, 'stop');
  t.after(async () => {
    await (started.mock.calls[0]?.this as SourceSet | undefined)?.stop();
    await (polling.mock.calls[0]?.this as SessionIngestion | undefined)?.stop();
    const server = listening.mock.calls[0]?.this as Server | undefined;
    server?.closeAllConnections();
    server?.close();
  });
  await assert.rejects(startDaemon(spec.options), error => error === original);
  assert.equal((listening.mock.calls[0]?.this as Server).listening, false);
  assert.equal(stop.mock.callCount(), 1);
  assert.equal(sources.mock.callCount(), 1);
  spec.assertReleased();
});
