import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { WebSocketServer } from 'ws';
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
  let peakSubscriptions = 0;
  const context = { cwd: '/repo', sessionManager: { getSessionId: () => 's1' } };
  memoryReviewExtension({
    events: {
      on: (_name, listener) => {
        subscriptions.add(listener);
        peakSubscriptions = Math.max(peakSubscriptions, subscriptions.size);
        return () => { subscriptions.delete(listener); };
      },
      emit: () => { /* No native provider needed to establish a transport. */ },
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
    emit, context, subscriptions, timers,
    peak: () => peakSubscriptions,
    credentials: () => { writeFileSync(join(directory, 'memory-control-token'), 'a'.repeat(64), { mode: 0o600 }); },
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

test('disabled integration does not retry', t => {
  const state = setup(t);
  delete process.env.PI_CONSOLE_MEMORY_REVIEW;
  state.emit('session_start');
  t.mock.timers.tick(120_000);
  assert.deepEqual(state.delays(), []);
});
