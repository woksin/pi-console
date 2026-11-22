import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { tokenRejectedError } from '@pi-console/viewmodels';
import { DaemonClient } from './client.ts';

const flush = async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); };

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const attempts: { signal: AbortSignal; body: ReadableStreamDefaultController<Uint8Array>; headers: Headers }[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    const signal = init.signal!;
    const stream = new ReadableStream<Uint8Array>({ start(body) {
      attempts.push({ signal, body, headers: new Headers(init.headers) });
      signal.addEventListener('abort', () => { body.error(signal.reason); }, { once: true });
    } });
    return Promise.resolve(new Response(stream));
  });
  const client = new DaemonClient({ baseUrl: 'http://127.0.0.1:1', token: 'test', tokenSource: 'test' });
  const states: { connected: boolean; error: string }[] = [];
  const events: number[] = [];
  const running = client.stream({ onState: state => { states.push(state); }, onEvent: event => { events.push(event.seq); } });
  const advance = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  const send = async (text: string) => { attempts.at(-1)?.body.enqueue(new TextEncoder().encode(text)); await flush(); };
  t.after(async () => { client.stop(); await advance(8000); await running; });
  return { client, attempts, states, events, advance, send, running };
}

test('a stalled stream goes offline after the freshness deadline and reconnects with a fresh watchdog', async t => {
  const stream = setup(t);
  await flush();
  assert.equal(stream.states.at(-1)?.connected, true);
  await stream.advance(45_000);
  assert.equal(stream.attempts[0].signal.aborted, false, 'the deadline is strictly exceeded, as in the web client');
  await stream.advance(15_000);
  assert.equal(stream.attempts[0].signal.aborted, true);
  assert.equal(stream.states.at(-1)?.connected, false);
  await stream.advance(500);
  assert.equal(stream.attempts.length, 2);
  assert.equal(stream.states.at(-1)?.connected, true);
  await stream.advance(15_000);
  assert.equal(stream.attempts[1].signal.aborted, false, 'a new attempt does not inherit the stale deadline');
  stream.client.stop();
  await stream.running;
});

test('heartbeat comments and data keep a quiet stream alive and data still resumes by sequence', async t => {
  const stream = setup(t);
  await flush();
  for (let heartbeat = 0; heartbeat < 4; heartbeat++) {
    await stream.advance(30_000);
    await stream.send(': keep-alive\n\n');
    assert.equal(stream.attempts[0].signal.aborted, false);
  }
  await stream.advance(30_000);
  await stream.send('id: 7\ndata: {"seq":7,"type":"test"}\n\n');
  await stream.advance(30_000);
  assert.equal(stream.attempts[0].signal.aborted, false);
  assert.deepEqual(stream.events, [7], 'comments are not dispatched as events');
  await stream.advance(30_000);
  assert.equal(stream.states.at(-1)?.connected, false);
  await stream.advance(500);
  assert.equal(stream.attempts[1].headers.get('Last-Event-ID'), '7');
});

/** A daemon whose stream replies come from `replies`: a status to refuse with, `'seq42'` for a stream that delivers event 42 and closes, or `'ok'` for a stream that stays open. */
function scripted(t: TestContext, replies: (number | 'ok' | 'seq42')[]) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const requests: (string | null)[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    requests.push(new Headers(init.headers).get('Last-Event-ID'));
    const reply = replies.shift() ?? 'ok';
    if (reply === 'seq42') return Promise.resolve(new Response('id: 42\ndata: {"seq":42,"type":"test"}\n\n'));
    if (reply !== 'ok') return Promise.resolve(new Response(null, { status: reply }));
    const stream = new ReadableStream<Uint8Array>({ start(body) { init.signal!.addEventListener('abort', () => { body.error(init.signal!.reason); }, { once: true }); } });
    return Promise.resolve(new Response(stream));
  });
  const client = new DaemonClient({ baseUrl: 'http://127.0.0.1:1', token: 'test', tokenSource: 'test' });
  const states: { connected: boolean; error: string }[] = [];
  let resets = 0;
  const running = client.stream({ onState: state => { states.push(state); }, onEvent: () => undefined, onReset: () => { resets++; } });
  const advance = async (ms: number) => { t.mock.timers.tick(ms); await flush(); };
  t.after(async () => { client.stop(); await advance(60_000); await running; });
  return { client, requests, states, resets: () => resets, advance };
}

test('a refused resume sequence is dropped, the state is reset and the retry is immediate', async t => {
  const stream = scripted(t, ['seq42', 400, 'ok']);
  await flush();
  await stream.advance(500);
  assert.deepEqual(stream.requests, [null, '42', null], 'the third request carries no Last-Event-ID and needs no backoff');
  assert.equal(stream.resets(), 1);
  assert.equal(stream.states.at(-1)?.connected, true);
});

test('a second consecutive 400 without a saved sequence backs off instead of looping', async t => {
  const stream = scripted(t, ['seq42', 400, 400, 'ok']);
  await flush();
  await stream.advance(500);
  assert.deepEqual(stream.requests, [null, '42', null]);
  assert.equal(stream.states.at(-1)?.error, 'Daemon answered HTTP 400');
  await stream.advance(999);
  assert.equal(stream.requests.length, 3);
  await stream.advance(1);
  assert.equal(stream.requests.length, 4);
  assert.equal(stream.resets(), 1);
});

test('a 401 reply reports the rejected token and retries slowly, not on the fast backoff', async t => {
  const stream = scripted(t, [401, 401, 'ok']);
  await flush();
  assert.deepEqual(stream.states.at(-1), { connected: false, error: tokenRejectedError });
  await stream.advance(8000);
  assert.equal(stream.requests.length, 1, 'no fast retry');
  await stream.advance(22_000);
  assert.equal(stream.requests.length, 2);
  await stream.advance(30_000);
  assert.equal(stream.requests.length, 3);
  assert.equal(stream.states.at(-1)?.connected, true);
});
