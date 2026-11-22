import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DaemonClient } from './client.ts';

const flush = async () => { for (let turn = 0; turn < 30; turn++) await Promise.resolve(); };

function setup(t: TestContext) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 });
  const attempts: { signal: AbortSignal; body: ReadableStreamDefaultController<Uint8Array>; headers: Headers }[] = [];
  t.mock.method(globalThis, 'fetch', (_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal;
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
