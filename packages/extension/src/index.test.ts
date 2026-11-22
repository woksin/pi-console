import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { WebSocketServer, type WebSocket } from 'ws';
import { memoryReviewTtlMs, reviewPrefix } from '@pi-console/contract';
import memoryReviewExtension from './index.ts';

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const timers = t.mock.method(globalThis, 'setTimeout');
  const directory = mkdtempSync(join(tmpdir(), 'pi-extension-lifecycle-'));
  const previous = { enabled: process.env.PI_CONSOLE_MEMORY_REVIEW, directory: process.env.PI_CONSOLE_DATA_DIR, url: process.env.PI_CONSOLE_URL };
  process.env.PI_CONSOLE_MEMORY_REVIEW = '1';
  process.env.PI_CONSOLE_DATA_DIR = directory;
  const listeners = new Map<string, () => void>();
  const subscriptions = new Set<(value: unknown) => void>();
  const events = new EventEmitter();
  let peakSubscriptions = 0;
  const context = { cwd: '/repo', sessionManager: { getSessionId: () => 's1' } };
  memoryReviewExtension({
    events: {
      on: (name, listener) => {
        subscriptions.add(listener);
        events.on(name, listener);
        peakSubscriptions = Math.max(peakSubscriptions, subscriptions.size);
        return () => { subscriptions.delete(listener); events.off(name, listener); };
      },
      emit: (name, value) => { events.emit(name, value); },
    },
    on: (name, listener) => { listeners.set(name, () => { listener({}, context); }); },
  });
  const emit = (name: string) => { listeners.get(name)!(); };
  t.after(async () => {
    emit('session_shutdown');
    // Drain socket-close callbacks before replacing the fake timer queue for the next spec.
    await new Promise<void>(resolve => setImmediate(resolve));
    timers.mock.restore();
    for (const [key, value] of Object.entries({ PI_CONSOLE_MEMORY_REVIEW: previous.enabled, PI_CONSOLE_DATA_DIR: previous.directory, PI_CONSOLE_URL: previous.url })) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    emit, context, subscriptions, timers, events, directory,
    peak: () => peakSubscriptions,
    credentials: (secret = 'a'.repeat(64)) => { writeFileSync(join(directory, 'memory-control-token'), secret, { mode: 0o600 }); },
    delays: () => timers.mock.calls.map(call => call.arguments[1]),
  };
}

async function daemon(t: TestContext) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  process.env.PI_CONSOLE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  t.after(() => { for (const socket of server.clients) socket.terminate(); server.close(); });
  return server;
}

function provider(state: ReturnType<typeof setup>): void {
  state.events.on(`${reviewPrefix}probe`, () => {
    state.events.emit(`${reviewPrefix}readiness`, { version: 1, available: true, storeId: 'd'.repeat(64), sessionId: 's1', generation: 'provider1' });
  });
}

async function authenticate(socket: WebSocket, secret: string): Promise<void> {
  const hello = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'challenge', nonce: 'c'.repeat(64), generation: 'connection1' }));
  const auth = JSON.parse(String((await hello)[0]));
  const proof = (role: string) => createHmac('sha256', secret).update(JSON.stringify([role, 'c'.repeat(64), 'connection1', auth.nonce, 's1', process.pid, '/repo'])).digest('hex');
  assert.equal(auth.proof, proof('client'), 'the hello uses the current credential');
  const readiness = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'welcome', proof: proof('server') }));
  assert.equal(JSON.parse(String((await readiness)[0])).type, 'readiness', 'the welcome uses the same credential');
}

test('credentials appearing after session start connect on the next bounded retry', async t => {
  const state = setup(t);
  const server = await daemon(t);
  state.emit('session_start');
  assert.deepEqual(state.delays(), [1000]);
  t.mock.timers.tick(1000);
  assert.deepEqual(state.delays(), [1000, 2000]);
  state.credentials();
  const connected = once(server, 'connection');
  t.mock.timers.tick(1999);
  assert.equal(state.subscriptions.size, 0);
  t.mock.timers.tick(1);
  assert.equal(state.subscriptions.size, 2, 'retry constructs a client');
  await connected;
  assert.equal(state.subscriptions.size, 2);
  assert.equal(state.peak(), 2);
});

test('shutdown during backoff cancels all later credential attempts', t => {
  const state = setup(t);
  state.emit('session_start');
  assert.deepEqual(state.delays(), [1000]);
  state.emit('session_shutdown');
  state.credentials();
  t.mock.timers.tick(120_000);
  assert.deepEqual(state.delays(), [1000]);
  assert.equal(state.subscriptions.size, 0);
});

test('session replacement cancels the old retry and binds only the replacement session', async t => {
  const state = setup(t);
  const server = await daemon(t);
  state.emit('session_start');
  t.mock.timers.tick(500);
  state.context.sessionManager.getSessionId = () => 's2';
  state.emit('session_switch');
  state.credentials();
  t.mock.timers.tick(500);
  assert.equal(state.subscriptions.size, 0, 'the old session retry was cancelled');
  const connected = once(server, 'connection');
  t.mock.timers.tick(500);
  assert.equal(state.subscriptions.size, 2, 'replacement retry constructs a client');
  const [socket] = await connected;
  const hello = once(socket, 'message');
  socket.send(JSON.stringify({ type: 'challenge', nonce: 'c'.repeat(64), generation: 'connection1' }));
  const [bytes] = await hello;
  assert.equal(JSON.parse(String(bytes)).binding.sessionId, 's2');
  state.emit('session_switch');
  assert.equal(state.subscriptions.size, 2);
  assert.equal(state.peak(), 2, 'the previous client closes before another is created');
});

test('missing credentials back off exponentially and cap retries at thirty seconds', t => {
  const state = setup(t);
  state.emit('session_start');
  for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) t.mock.timers.tick(delay);
  assert.deepEqual(state.delays(), [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000]);
});

test('credential rotation reconnects without restarting pi and never replays pending requests or late results', { timeout: 5000 }, async t => {
  const state = setup(t);
  const server = await daemon(t);
  provider(state);
  state.credentials();
  const connection = once(server, 'connection');
  state.emit('session_start');
  const [socket] = await connection;
  await authenticate(socket, 'a'.repeat(64));
  let deliveries = 0;
  state.events.on(`${reviewPrefix}request`, () => { deliveries++; });
  const request = { requestId: 'pending', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'provider1', expiresAt: Date.now() + memoryReviewTtlMs };
  const received = once(state.events, `${reviewPrefix}request`);
  socket.send(JSON.stringify({ type: 'request', value: request }));
  await received;
  const cancelled = once(state.events, `${reviewPrefix}cancel`);
  socket.terminate();
  assert.deepEqual((await cancelled)[0], { requestId: 'pending' });
  state.credentials('b'.repeat(64));
  const reconnected = once(server, 'connection');
  t.mock.timers.tick(2000);
  const [next] = await reconnected;
  await authenticate(next, 'b'.repeat(64));
  assert.equal(deliveries, 1, 'the old native prompt is not replayed');
  const frames: unknown[] = [];
  next.on('message', (bytes: Buffer) => { frames.push(JSON.parse(String(bytes))); });
  state.events.emit(`${reviewPrefix}result`, { version: 1, requestId: 'pending', reason: 'refused' });
  const fresh = once(state.events, `${reviewPrefix}request`);
  next.send(JSON.stringify({ type: 'request', value: { ...request, requestId: 'fresh' } }));
  await fresh;
  const reply = once(next, 'message');
  state.events.emit(`${reviewPrefix}result`, { version: 1, requestId: 'fresh', reason: 'refused' });
  assert.equal(JSON.parse(String((await reply)[0])).value.requestId, 'fresh');
  assert.equal(frames.length, 1, 'a late result from the old connection is never sent');
  assert.equal(deliveries, 2);
});

test('reconnect retries unreadable, malformed, public and symlink credentials without reusing the old secret', { timeout: 5000 }, async t => {
  const state = setup(t);
  const server = await daemon(t);
  provider(state);
  state.credentials();
  let connections = 0;
  server.on('connection', () => { connections++; });
  const connection = once(server, 'connection');
  state.emit('session_start');
  const [socket] = await connection;
  await authenticate(socket, 'a'.repeat(64));
  const received = once(state.events, `${reviewPrefix}request`);
  socket.send(JSON.stringify({ type: 'request', value: { requestId: 'pending', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'provider1', expiresAt: Date.now() + memoryReviewTtlMs } }));
  await received;
  const cancelled = once(state.events, `${reviewPrefix}cancel`);
  socket.terminate();
  await cancelled;
  const path = join(state.directory, 'memory-control-token');
  const retry = () => {
    t.mock.timers.tick(2000);
    assert.equal(connections, 1, 'invalid credentials never open a socket with the cached secret');
    assert.equal(state.delays().at(-1), 2000, 'credential failures schedule another bounded retry');
  };
  rmSync(path);
  retry();
  state.credentials('malformed');
  retry();
  state.credentials('b'.repeat(64));
  chmodSync(path, 0o644);
  retry();
  rmSync(path);
  const target = join(state.directory, 'private-token');
  writeFileSync(target, 'b'.repeat(64), { mode: 0o600 });
  symlinkSync(target, path);
  retry();
  rmSync(path);
  state.credentials('b'.repeat(64));
  const reconnected = once(server, 'connection');
  t.mock.timers.tick(2000);
  const [next] = await reconnected;
  await authenticate(next, 'b'.repeat(64));
  assert.equal(connections, 2);
});

test('disabled integration does not retry', t => {
  const state = setup(t);
  delete process.env.PI_CONSOLE_MEMORY_REVIEW;
  state.emit('session_start');
  t.mock.timers.tick(120_000);
  assert.deepEqual(state.delays(), []);
});
