// Pure protocol + loopback transport specs; no pi process or external model.
import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { authenticate, commandHandler, MAX_BYTES, MAX_RECEIPTS, outbox, safely, sign } from './protocol.js';
import { decoder, frame } from './websocket.js';
import { startStub } from './stub.js';

const envelope = (over = {}) => ({ id: 'one', issuer: 'spike', type: 'interject', mode: 'steer', text: 'marker', timestamp: 100, ttl: 500, ...over });
const hello = (token = 'token', nonce = 'nonce') => ({ type: 'hello', pid: 12, cwd: '/scratch', sessionId: 'scratch-id', mac: sign(token, 'scratch-id', nonce) });
const expected = { pid: 12, cwd: '/scratch' };

test('HMAC binds session + fresh nonce, expected PID and cwd', () => {
  assert.equal(authenticate(hello(), 'token', 'nonce', expected), true);
  for (const change of [{ mac: 'a'.repeat(64) }, { sessionId: 'other' }, { pid: 13 }, { cwd: '/live' }, { mac: 'invalid' }]) {
    assert.equal(authenticate({ ...hello(), ...change }, 'token', 'nonce', expected), false);
  }
  assert.equal(authenticate(hello(), 'token', 'new-nonce', expected), false);
  assert.equal(authenticate(null, 'token', 'nonce', expected), false);
});

test('typed delivery, provenance, rejection and idempotent claim-before-send', () => {
  const delivered = [];
  const handle = commandHandler((command, text) => delivered.push([command.mode, text]));
  assert.equal(handle(envelope(), 100).outcome, 'accepted');
  assert.equal(handle(envelope(), 100).duplicate, true);
  assert.deepEqual(delivered, [['steer', '[console:spike] marker']]);
  assert.equal(handle(envelope({ id: 'follow', mode: 'followUp' }), 100).outcome, 'accepted');
  assert.equal(handle(envelope({ id: 'passive', type: 'next_turn' }), 100).outcome, 'accepted');
  assert.equal(handle(envelope({ id: 'unknown', type: 'execute' }), 100).outcome, 'unknown_type');
  assert.equal(handle(envelope({ id: 'old', ttl: 1 }), 101).outcome, 'expired');
  assert.equal(handle(envelope({ timestamp: 101 }), 100).outcome, 'expired');
  assert.equal(handle(envelope({ issuer: 'x]\nforged' }), 100).outcome, 'invalid');
  assert.equal(handle(null, 100).outcome, 'invalid');
});

test('failed sends stay claimed; unsafe sessions and full receipt store fail closed', () => {
  let sends = 0;
  const handle = commandHandler(() => { sends++; throw new Error('gone'); });
  assert.equal(handle(envelope(), 100).outcome, 'delivery_failed');
  assert.equal(handle(envelope(), 100).duplicate, true);
  assert.equal(sends, 1);
  assert.equal(commandHandler(() => assert.fail(), () => false)(envelope(), 100).outcome, 'unsafe_session');
  const bounded = commandHandler(() => {});
  for (let i = 0; i < MAX_RECEIPTS; i++) bounded(envelope({ id: `id-${i}` }), 100);
  assert.equal(bounded(envelope({ id: 'overflow' }), 100).outcome, 'capacity');
  assert.equal(bounded(envelope({ id: 'id-0' }), 100).duplicate, true);
});

test('outbox bounds FIFO and size, throttles batches, drops on backpressure and exceptions', () => {
  const sent = [];
  const socket = { readyState: 1, bufferedAmount: 0, send: text => sent.push(text) };
  const box = outbox(socket, 5);
  for (let i = 0; i < 6; i++) box.push({ i });
  assert.equal(box.size, 5);
  box.flush();
  assert.equal(sent.length, 4);
  socket.bufferedAmount = MAX_BYTES * 3;
  box.flush();
  assert.equal(box.size, 0);
  assert.equal(box.dropped, 2);
  assert.equal(box.push('x'.repeat(MAX_BYTES)), false);
  const circular = {}; circular.self = circular;
  assert.equal(box.push(circular), false);
  socket.bufferedAmount = 0;
  socket.send = () => { throw new Error('disconnected'); };
  box.push('safe');
  assert.doesNotThrow(() => box.flush());
  socket.readyState = 3;
  box.push('closed'); box.flush();
  assert.equal(box.dropped, 6);
});

test('event safety wrapper contains sync and async failures', async () => {
  assert.doesNotThrow(() => safely(() => { throw new Error('sync'); })());
  safely(async () => { throw new Error('async'); })();
  await new Promise(resolve => setImmediate(resolve));
  const handle = commandHandler(() => {});
  assert.doesNotThrow(() => handle(new Proxy({}, { get() { throw new Error('hostile'); } })));
});

function masked(text) {
  const raw = frame(text);
  const offset = raw[1] === 126 ? 4 : 2;
  raw[1] |= 128;
  const key = Buffer.from([1, 2, 3, 4]);
  const body = Buffer.from(raw.subarray(offset));
  for (let i = 0; i < body.length; i++) body[i] ^= key[i % 4];
  return Buffer.concat([raw.subarray(0, offset), key, body]);
}

test('frame parser handles partial/coalesced frames and rejects malformed/oversized frames', () => {
  const texts = [];
  let rejected = 0;
  const read = decoder(text => texts.push(text), () => rejected++);
  const raw = masked('hello');
  read(raw.subarray(0, 3));
  read(Buffer.concat([raw.subarray(3), masked('second'), masked('x'.repeat(200))]));
  assert.deepEqual(texts, ['hello', 'second', 'x'.repeat(200)]);
  read(frame('unmasked'));
  read(masked('ignored'));
  assert.equal(rejected, 1);
  for (const invalid of [Buffer.from([0x01, 0x80]), Buffer.from([0x81, 0xff]), Buffer.from([0x81, 0xfe, 0xff, 0xff]), Buffer.alloc(MAX_BYTES * 2 + 1)]) {
    decoder(() => assert.fail(), () => rejected++)(invalid);
  }
  assert.equal(rejected, 5);
  assert.throws(() => frame('x'.repeat(MAX_BYTES + 1)));
});

async function connect(url) {
  const socket = new WebSocket(url);
  const challenge = once(socket, 'message');
  await once(socket, 'open');
  return { socket, challenge: JSON.parse((await challenge)[0].data) };
}

const waitFor = async predicate => {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) assert.fail('stub event deadline');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('loopback stub rejects bad HMAC, pins one child, rejects replays and streams allowed events', async t => {
  const events = [];
  const stub = await startStub('token', expected, event => events.push(event));
  t.after(() => stub.close());
  const bad = await connect(stub.url);
  const closed = once(bad.socket, 'close');
  bad.socket.send(JSON.stringify(hello('wrong', bad.challenge.nonce)));
  await closed;
  assert.equal(events[0].reason, 'authentication');
  const good = await connect(stub.url);
  good.socket.send(JSON.stringify(hello('token', good.challenge.nonce)));
  await waitFor(() => events.some(e => e.type === 'hello'));
  assert.ok(!('mac' in events.find(e => e.type === 'hello')));
  good.socket.send(JSON.stringify({ type: 'event', name: 'unknown' }));
  good.socket.send(JSON.stringify({ type: 'event', name: 'turn_start' }));
  await waitFor(() => events.some(e => e.name === 'turn_start'));
  assert.ok(!events.some(e => e.name === 'unknown'));
  const incoming = once(good.socket, 'message');
  stub.send(envelope());
  assert.deepEqual(JSON.parse((await incoming)[0].data), envelope());
  const replay = await connect(stub.url);
  const replayClosed = once(replay.socket, 'close');
  replay.socket.send(JSON.stringify(hello('token', replay.challenge.nonce)));
  await replayClosed;
  assert.equal(events.filter(e => e.type === 'hello').length, 1);
});
