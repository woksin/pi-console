import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter, once } from 'node:events';
import { WebSocket } from 'ws';
import { memoryReviewTtlMs, reviewPrefix, type ReviewReadiness, type ReviewResult, type MemoryItem } from '@pi-console/contract';
import { reviewableItem } from './availability.ts';
import { reviewIngestionGraceMs } from './receipts.ts';
import { testEvent } from '@pi-console/core/testing';
import { defaultConfig } from '../config.ts';
import { startDaemon } from '../daemon.ts';
import { sessionStarted } from '../testing/harness.ts';

const wait = async (check: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Condition did not become true');
};
async function setup(t: { after(fn: () => unknown): void }, enabled = true) {
  const dir = mkdtempSync(join(tmpdir(), 'pi-console-review-'));
  const agentRoot = join(dir, 'agent');
  mkdirSync(join(agentRoot, 'memory'), { recursive: true });
  writeFileSync(join(agentRoot, 'memory/events.jsonl'), '');
  const config = { ...defaultConfig(join(dir, 'data')), agentRoot, port: 0, ingest: false, memoryActions: enabled };
  let daemon = await startDaemon(config);
  const readToken = readFileSync(join(config.dataDir, 'token'), 'utf8').trim();
  const token = enabled ? readFileSync(join(config.dataDir, 'memory-control-token'), 'utf8').trim() : readToken;
  const sockets: WebSocket[] = [];
  t.after(async () => { for (const ws of sockets) ws.terminate(); await daemon.close(); rmSync(dir, { recursive: true, force: true }); });
  const call = async (path: string, method = 'GET', body?: unknown, credential = token, extra: Record<string, string> = {}, sessionId = 's1') => fetch(`http://127.0.0.1:${daemon.port}/api/v1${actionPath(path, { method, sessionId })}`, { method, headers: { Authorization: `Bearer ${credential}`, Origin: `http://127.0.0.1:${daemon.port}`, 'x-pi-console-csrf': '1', 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const start = sessionStarted(1, 's1');
  start.payload = { ...(start.payload as object), cwd: '/repo' };
  const source = join(realpathSync(agentRoot), 'memory/events.jsonl');
  await daemon.log.append([start, proposed(2, 'i1', source), proposed(3, 'i2', source)]);
  const storeId = createHash('sha256').update(realpathSync(join(agentRoot, 'memory'))).digest('hex');
  const connect = async (options: { sessionId?: string; store?: string; secret?: string; readiness?: Partial<ReviewReadiness> } = {}) => {
    const { sessionId = 's1', store = storeId, secret = token, readiness = {} } = options;
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/api/v1/extensions/memory-review`);
    sockets.push(ws);
    const [bytes] = await once(ws, 'message');
    const challenge = JSON.parse(String(bytes));
    const welcome = once(ws, secret === token ? 'message' : 'close');
    ws.send(JSON.stringify(helloFrame(challenge, sessionId, secret)));
    await welcome;
    if (secret !== token) return ws;
    ws.send(JSON.stringify({ type: 'readiness', value: { version: 1, available: true, storeId: store, sessionId, generation: 'g1', ...readiness } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    return ws;
  };
  return { call, connect, token, readToken, config, storeId, get daemon() { return daemon; }, async restart() { await daemon.close(); daemon = await startDaemon(config); }, source: join(realpathSync(agentRoot), 'memory/events.jsonl') };
}
function helloFrame(challenge: { nonce: string; generation: string }, sessionId: string, secret: string) {
  const binding = { sessionId, pid: process.pid, cwd: '/repo' };
  const nonce = 'b'.repeat(64);
  const proof = createHmac('sha256', secret).update(JSON.stringify(['client', challenge.nonce, challenge.generation, nonce, sessionId, binding.pid, binding.cwd])).digest('hex');
  return { type: 'hello', nonce, binding, proof };
}
function actionPath(path: string, target: { method: string; sessionId: string }): string {
  return path === '/availability' || target.method === 'POST' ? `/sessions/${target.sessionId}/memory-actions${path === '/availability' ? '' : path}` : `/memory-actions${path}`;
}
function proposed(n: number, itemId: string, source: string) {
  return testEvent(n, 'MemoryItemRecorded', { itemId, kind: 'directive', scopeKind: 'session', scopeKey: 's1', sourceType: 'agent_decision', sourceMessageId: null, authorityMode: null, supersedes: [], excerpt: 'A proposal', truncated: false, withheld: false }, { source: 'intent-memory', refs: { file: source, offset: n, entryId: `record${n}` } });
}
const applied = (ws: WebSocket, request: Record<string, unknown>, eventId: string) => ws.send(JSON.stringify({ type: 'result', value: { version: 1, ...request, expiresAt: undefined, ok: true, status: 'applied', reason: 'applied', eventId } }));
const receiptState = async (call: Awaited<ReturnType<typeof setup>>['call'], id: string) => (await (await call(`/${id}`)).json()).state;

test('disabled and offline stay read-only; read scope, forged provenance and browser-policy bypasses cannot request review', { timeout: 5000 }, async t => {
  const disabled = await setup(t, false);
  assert.equal((await (await disabled.call('/availability')).json()).available, false);
  const spec = await setup(t);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' }, spec.readToken)).status, 403);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' }, spec.token, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await spec.call('', 'POST', {}, spec.token, { Authorization: '', Cookie: `piConsoleToken=${spec.token}`, 'x-pi-console-csrf': '0' })).status, 401);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm', actor: 'human' })).status, 400);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' })).status, 503);
  const noOrigin = await fetch(`http://127.0.0.1:${spec.daemon.port}/api/v1/sessions/s1/memory-actions`, { method: 'POST', headers: { Authorization: `Bearer ${spec.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ requestId: 'native', itemId: 'i1', action: 'confirm' }) });
  assert.equal(noOrigin.status, 503);
});

test('confirm/reject claims await exact canonical ingestion; retries never deliver twice', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  assert.equal((await (await spec.call('/availability')).json()).available, true);
  for (const [index, action] of ['confirm', 'reject'].entries()) {
    const id = `r${index}`;
    const itemId = `i${index + 1}`;
    const delivery = once(ws, 'message');
    const body = { requestId: id, itemId, action };
    assert.equal((await spec.call('', 'POST', body)).status, 202);
    const request = JSON.parse(String((await delivery)[0])).value;
    assert.equal(request.sessionId, 's1');
    const receipt = await (await spec.call(`/${id}`)).json();
    assert.equal(receipt.expiresAt - receipt.createdAt, memoryReviewTtlMs);
    assert.equal(memoryReviewTtlMs, 30_000);
    assert.equal((await spec.call('', 'POST', { ...body, action: action === 'confirm' ? 'reject' : 'confirm' })).status, 409);
    assert.equal((await spec.call('', 'POST', { requestId: `busy${index}`, itemId, action })).status, 409);
    assert.equal(spec.daemon.log.lastSeq(), 3 + index * 2);
    applied(ws, request, `ev${index}`);
    await wait(async () => await receiptState(spec.call, id) === 'awaiting-ingestion');
    const type = action === 'confirm' ? 'MemoryItemConfirmed' : 'MemoryItemRetired';
    const payload = { itemId, actorKind: 'human', status: 'rejected', reasonExcerpt: '' };
    await spec.daemon.log.append([testEvent(20 + index * 2, type, payload, { source: 'intent-memory', refs: { file: '/wrong/events.jsonl', offset: 0, entryId: `ev${index}` } })]);
    assert.equal(await receiptState(spec.call, id), 'awaiting-ingestion');
    await spec.daemon.log.append([testEvent(21 + index * 2, type, payload, { source: 'intent-memory', refs: { file: spec.source, offset: 0, entryId: `ev${index}` } })]);
    await wait(async () => await receiptState(spec.call, id) === 'observed-applied');
    assert.equal((await (await spec.call('', 'POST', body)).json()).state, 'observed-applied');
  }
});

test('disconnect, replacement and restart retain unknown receipts without redispatch', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  const body = { requestId: 'restart1', itemId: 'i1', action: 'confirm' };
  const delivery = once(ws, 'message');
  await spec.call('', 'POST', body);
  await delivery;
  ws.terminate();
  await wait(async () => await receiptState(spec.call, 'restart1') === 'unknown');
  await spec.restart();
  const next = await spec.connect();
  let delivered = 0;
  next.on('message', () => { delivered++; });
  assert.equal((await (await spec.call('', 'POST', body)).json()).state, 'unknown');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(delivered, 0);
});

async function extensionProvider(t: { after(fn: () => unknown): void }, spec: Awaited<ReturnType<typeof setup>>) {
  // Load the real client at runtime without adding a production daemon dependency on the extension.
  const { MemoryReviewClient } = await import(new URL('../../../extension/src/client.ts', import.meta.url).href);
  const events = new EventEmitter();
  events.on(`${reviewPrefix}probe`, () => {
    events.emit(`${reviewPrefix}readiness`, { version: 1, available: true, storeId: spec.storeId, sessionId: 's1', generation: 'g1' });
  });
  const client = new MemoryReviewClient({
    url: `ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`, secret: spec.token,
    binding: { sessionId: 's1', pid: process.pid, cwd: '/repo' }, reconnectMs: 60_000,
    bus: {
      on: (name: string, listener: (value: unknown) => void) => { events.on(name, listener); return () => { events.off(name, listener); }; },
      emit: (name: string, value: unknown) => { events.emit(name, value); },
    },
  });
  t.after(() => { client.close(); });
  await wait(async () => (await (await spec.call('/availability')).json()).available);
  return events;
}

async function providerReply(spec: Awaited<ReturnType<typeof setup>>, events: EventEmitter, result: ReviewResult): Promise<void> {
  const delivery = once(events, `${reviewPrefix}request`);
  assert.equal((await spec.call('', 'POST', { requestId: result.requestId, itemId: 'i1', action: 'confirm' })).status, 202);
  assert.equal((await delivery)[0].requestId, result.requestId);
  events.emit(`${reviewPrefix}result`, result);
}

test('real extension correlates minimal refusals, preserves mismatches and never completes partial success claims', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const events = await extensionProvider(t, spec);
  const cases: { requestId: string; reply: Partial<ReviewResult>; state: string }[] = [
    { requestId: 'minimal', reply: {}, state: 'declined' },
    { requestId: 'wrong-item', reply: { itemId: 'other' }, state: 'unknown' },
    { requestId: 'wrong-action', reply: { action: 'reject' }, state: 'unknown' },
    { requestId: 'wrong-session', reply: { sessionId: 'other' }, state: 'unknown' },
    { requestId: 'wrong-generation', reply: { generation: 'other' }, state: 'unknown' },
    { requestId: 'partial-success', reply: { reason: 'applied', ok: true, status: 'applied', eventId: 'claim' }, state: 'unknown' },
  ];
  for (const { requestId, reply, state } of cases) {
    await providerReply(spec, events, { version: 1, requestId, reason: 'refused', ...reply });
    await wait(async () => await receiptState(spec.call, requestId) === state);
    const receipt = await (await spec.call(`/${requestId}`)).json();
    assert.equal(receipt.eventId, null, 'a refusal or uncorrelated claim never establishes a write');
  }
  assert.equal(spec.daemon.log.lastSeq(), 3, 'results never manufacture canonical memory events');
});

test('failure-like replies with any success indicator never borrow pending correlation', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const events = await extensionProvider(t, spec);
  const replies: Partial<ReviewResult>[] = [{ reason: 'applied' }, { ok: true }, { status: 'applied' }, { eventId: 'claim' }];
  for (const [index, reply] of replies.entries()) {
    const requestId = `untrusted-${index}`;
    await providerReply(spec, events, { version: 1, requestId, reason: 'refused', ...reply });
    await wait(async () => await receiptState(spec.call, requestId) === 'unknown');
  }
  assert.equal(spec.daemon.log.lastSeq(), 3);
});

test('decline, provider generation loss and expiry never claim a write; late results cannot revive receipts', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  const request = async (requestId: string) => {
    const delivery = once(ws, 'message');
    assert.equal((await spec.call('', 'POST', { requestId, itemId: 'i1', action: 'confirm' })).status, 202);
    return JSON.parse(String((await delivery)[0])).value;
  };
  const decline = await request('decline');
  ws.send(JSON.stringify({ type: 'result', value: { ...decline, expiresAt: undefined, version: 1, reason: 'refused', ok: false } }));
  await wait(async () => await receiptState(spec.call, 'decline') === 'declined');
  const stale = await request('stale');
  const cancelled = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'readiness', value: { version: 1, available: false, storeId: '', reason: 'handoff' } }));
  assert.equal(JSON.parse(String((await cancelled)[0])).requestId, 'stale');
  await wait(async () => await receiptState(spec.call, 'stale') === 'unknown');
  applied(ws, stale, 'late1');
  assert.equal(await receiptState(spec.call, 'stale'), 'unknown');
  ws.terminate();
  const current = await spec.connect();
  const delivered = once(current, 'message');
  await spec.call('', 'POST', { requestId: 'expire', itemId: 'i1', action: 'confirm' });
  const pending = JSON.parse(String((await delivered)[0])).value;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(memoryReviewTtlMs + 1);
  const cancel = once(current, 'message');
  await spec.call('', 'POST', { requestId: 'trigger', itemId: 'missing', action: 'confirm' });
  assert.equal(JSON.parse(String((await cancel)[0])).requestId, 'expire');
  assert.equal(await receiptState(spec.call, 'expire'), 'expired');
  applied(current, pending, 'late2');
  assert.equal(await receiptState(spec.call, 'expire'), 'expired');
  assert.equal(spec.daemon.log.lastSeq(), 3);
});

test('reported writes reconcile after the human deadline and after ingestion grace without being misreported expired', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  for (const itemId of ['i1', 'i2']) {
    const delivery = once(ws, 'message');
    await spec.call('', 'POST', { requestId: itemId, itemId, action: 'confirm' });
    applied(ws, JSON.parse(String((await delivery)[0])).value, `${itemId}-event`);
    await wait(async () => await receiptState(spec.call, itemId) === 'awaiting-ingestion');
  }
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(memoryReviewTtlMs + 1);
  await spec.call('', 'POST', { requestId: 'expire-pending', itemId: 'missing', action: 'confirm' });
  assert.equal(await receiptState(spec.call, 'i1'), 'awaiting-ingestion');
  assert.equal(await receiptState(spec.call, 'i2'), 'awaiting-ingestion');
  assert.equal(spec.daemon.log.lastSeq(), 3, 'expiry never manufactures producer events');
  await spec.daemon.log.append([testEvent(4, 'MemoryItemConfirmed', { itemId: 'i1', actorKind: 'human' }, { source: 'intent-memory', refs: { file: spec.source, offset: 0, entryId: 'i1-event' } })]);
  await wait(async () => await receiptState(spec.call, 'i1') === 'observed-applied');
  t.mock.timers.tick(reviewIngestionGraceMs);
  await spec.call('', 'POST', { requestId: 'expire-pending', itemId: 'missing', action: 'confirm' });
  const unverified = await (await spec.call('/i2')).json();
  assert.equal(unverified.state, 'unknown');
  assert.equal(unverified.reason, 'applied');
  assert.equal(unverified.eventId, 'i2-event');
  await spec.daemon.log.append([testEvent(5, 'MemoryItemConfirmed', { itemId: 'i2', actorKind: 'human' }, { source: 'intent-memory', refs: { file: spec.source, offset: 0, entryId: 'i2-event' } })]);
  await wait(async () => await receiptState(spec.call, 'i2') === 'observed-applied');
});

test('daemon primary-session advice rejects unknown, child, wrong-cwd and ended sessions even with ready providers', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  let delivered = 0;
  ws.on('message', () => { delivered++; });
  const body = { requestId: 'primary', itemId: 'i1', action: 'confirm' };
  assert.equal((await (await spec.call('/availability')).json()).available, true);
  await spec.connect({ sessionId: 'unknown' });
  assert.equal((await (await spec.call('/availability', 'GET', undefined, spec.token, {}, 'unknown')).json()).reason, 'not-ready');
  for (const [index, change] of [{ role: 'subagent' }, { role: 'main', parentSessionId: 'parent' }, { parentSessionId: null, cwd: '/other' }].entries()) {
    const start = sessionStarted(20 + index, 's1');
    start.payload = { ...(start.payload as object), cwd: '/repo', ...change };
    await spec.daemon.log.append([start]);
    assert.equal((await (await spec.call('/availability')).json()).reason, 'not-ready');
    assert.equal((await spec.call('', 'POST', body)).status, 503);
  }
  const restored = sessionStarted(25, 's1', '/repo');
  await spec.daemon.log.append([restored]);
  assert.equal((await (await spec.call('/availability')).json()).available, true);
  await spec.daemon.log.append([testEvent(26, 'SessionEnded', { sessionId: 's1', reason: 'done' })]);
  assert.equal((await (await spec.call('/availability')).json()).reason, 'not-ready');
  assert.equal((await spec.call('', 'POST', body)).status, 503);
  assert.equal(delivered, 0);
});

test('availability is exact-session and exact-credential, with bounded provider reasons rather than transcript guesses', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const available = async (sessionId = 's1', token = spec.token) => (await spec.call('/availability', 'GET', undefined, token, {}, sessionId)).json();
  assert.deepEqual(await available(), { version: 1, available: false, providerVersion: null, generation: null, reason: 'offline' });
  assert.equal((await available('s1', spec.readToken)).reason, 'read-only');
  const ws = await spec.connect();
  assert.deepEqual(await available(), { version: 1, available: true, providerVersion: 1, generation: 'g1', reason: 'available' });
  assert.equal((await available('s2')).reason, 'offline');
  assert.equal((await available('s1', spec.readToken)).reason, 'read-only');
  ws.send(JSON.stringify({ type: 'readiness', value: { version: 2, available: true, storeId: 'b'.repeat(64), sessionId: 's1', generation: 'v2' } }));
  await wait(async () => (await available()).reason === 'unsupported');
  assert.equal((await available()).providerVersion, 2);
  ws.send(JSON.stringify({ type: 'readiness', value: { version: 1, available: false, storeId: '', sessionId: 's1', generation: 'g2' } }));
  await wait(async () => (await available()).reason === 'not-ready');
  ws.terminate();
  await wait(async () => (await available()).reason === 'offline');
  const disabled = await setup(t, false);
  assert.equal((await (await disabled.call('/availability')).json()).reason, 'disabled');
});

test('route-bound proposals never borrow another session, disclose withheld material or accept extra provenance/path fields', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  const ws = await spec.connect();
  let delivered = 0;
  ws.on('message', () => { delivered++; });
  const body = { requestId: 'bound', itemId: 'i1', action: 'confirm' };
  assert.equal((await spec.call('', 'POST', body, spec.token, {}, 's2')).status, 404);
  const other = proposed(10, 'foreign', spec.source);
  other.payload = { ...(other.payload as object), scopeKey: 's2' };
  const withheld = proposed(11, 'withheld', spec.source);
  withheld.payload = { ...(withheld.payload as object), withheld: true, excerpt: '' };
  const wrongStore = proposed(12, 'wrong-store', '/foreign/memory/events.jsonl');
  const repo = proposed(13, 'repo-other', spec.source);
  repo.payload = { ...(repo.payload as object), scopeKind: 'repo', scopeKey: '/repo', sourceMessageId: 'msg2' };
  const orphan = proposed(15, 'orphan', spec.source);
  orphan.payload = { ...(orphan.payload as object), scopeKind: 'global', scopeKey: '' };
  const message = testEvent(14, 'MemoryMessageRecorded', { messageId: 'msg2', sessionId: 's2', origin: 'human', injectedKind: null, withheld: false, textBytes: 0 }, { source: 'intent-memory' });
  await spec.daemon.log.append([other, withheld, wrongStore, repo, message, orphan]);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'foreign' })).status, 404);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'orphan' })).status, 404);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'repo-other' })).status, 404);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'repo-other' }, spec.token, {}, 's2')).status, 503);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'withheld' })).status, 409);
  assert.equal((await spec.call('', 'POST', { ...body, itemId: 'wrong-store' })).status, 503);
  const page = await (await fetch(`http://127.0.0.1:${spec.daemon.port}/api/v1/memory-items`, { headers: { Authorization: `Bearer ${spec.readToken}` } })).json() as { items: MemoryItem[] };
  const item = page.items.find(item => item.id === 'i1');
  assert.ok(item);
  assert.equal(reviewableItem({ ...item, statusBasis: 'assumed' }), false);
  for (const key of ['constructor', '__proto__', 'toString', 'actor', 'path', 'sourceText', 'proof']) {
    const hostile = JSON.parse(`{"requestId":"hostile","itemId":"i1","action":"confirm","${key}":"/etc/passwd"}`);
    assert.equal((await spec.call('', 'POST', hostile)).status, 400);
  }
  assert.equal(delivered, 0);
  const legacy = await fetch(`http://127.0.0.1:${spec.daemon.port}/api/v1/memory-actions`, { method: 'POST', headers: { Authorization: `Bearer ${spec.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(legacy.status, 405);
  const native = await fetch(`http://127.0.0.1:${spec.daemon.port}/api/v1/sessions/s1/memory-actions`, { method: 'POST', headers: { Authorization: `Bearer ${spec.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(native.status, 202);
  await wait(() => delivered === 1);
  assert.equal((await spec.call('', 'POST', body, spec.token, {}, 's2')).status, 409);
});

test('concurrent authenticated handshakes cannot exceed the peer cap, but same-session replacement keeps its slot', { timeout: 10_000 }, async t => {
  const spec = await setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const established: WebSocket[] = [];
  for (let index = 0; index < 31; index++) {
    if (index % 8 === 0) t.mock.timers.tick(1001);
    established.push(await spec.connect({ sessionId: `peer-${String(index)}` }));
  }
  t.mock.timers.tick(1001);
  const sockets: WebSocket[] = [];
  t.after(() => { for (const ws of sockets) ws.terminate(); });
  const pending = await Promise.all(Array.from({ length: 8 }, async (_, index) => {
    const ws = new WebSocket(`ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`);
    sockets.push(ws);
    const [bytes] = await once(ws, 'message');
    const sessionId = index === 7 ? 'peer-0' : `extra-${String(index)}`;
    return { ws, frame: helloFrame(JSON.parse(String(bytes)), sessionId, spec.token) };
  }));
  const results = pending.map(({ ws, frame }) => {
    const outcome = new Promise<string>(resolve => {
      ws.once('message', () => { resolve('welcome'); });
      ws.once('close', () => { resolve('closed'); });
    });
    ws.send(JSON.stringify(frame));
    return outcome;
  });
  const outcomes = await Promise.all(results);
  assert.equal(outcomes.filter(value => value === 'welcome').length, 2, 'one new slot plus one replacement, not eight new peers');
  assert.equal(outcomes[7], 'welcome', 'authenticated replacement can reuse an existing slot');
  await wait(() => established[0].readyState === WebSocket.CLOSED);
  assert.ok(established.slice(1).every(ws => ws.readyState === WebSocket.OPEN));
});

test('a full channel authenticates same-session replacements before closing the old peer, but refuses a new session', { timeout: 10_000 }, async t => {
  const spec = await setup(t);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const established: WebSocket[] = [];
  for (let index = 0; index < 32; index++) {
    if (index % 8 === 0) t.mock.timers.tick(1001);
    established.push(await spec.connect({ sessionId: `peer-${String(index)}` }));
  }
  t.mock.timers.tick(1001);
  const replacement = await spec.connect({ sessionId: 'peer-0' });
  await wait(() => established[0].readyState === WebSocket.CLOSED);
  const denied = await spec.connect({ sessionId: 'peer-0', secret: spec.readToken });
  assert.equal(denied.readyState, WebSocket.CLOSED, 'failed authentication cannot replace the authenticated peer');
  assert.equal(replacement.readyState, WebSocket.OPEN);
  const newcomer = new WebSocket(`ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`);
  t.after(() => { newcomer.terminate(); });
  const [bytes] = await once(newcomer, 'message');
  const refused = once(newcomer, 'close');
  newcomer.send(JSON.stringify(helloFrame(JSON.parse(String(bytes)), 'peer-32', spec.token)));
  await refused;
  assert.equal(replacement.readyState, WebSocket.OPEN);
  assert.ok(established.slice(1).every(ws => ws.readyState === WebSocket.OPEN));
});

test('unauthenticated upgrade pressure has a separate small budget and cannot occupy established review slots', { timeout: 10_000 }, async t => {
  const spec = await setup(t);
  const provider = await spec.connect();
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(1001);
  const pending = Array.from({ length: 8 }, () => new WebSocket(`ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`));
  t.after(() => { for (const socket of pending) socket.terminate(); });
  await Promise.all(pending.map(socket => once(socket, 'message')));
  t.mock.timers.tick(1001); // The pending limit still applies in a fresh upgrade-rate window.
  const refused = new WebSocket(`ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`);
  refused.on('error', () => { /* Expected unauthenticated admission pressure. */ });
  await new Promise(resolve => refused.once('close', resolve));
  const delivered = once(provider, 'message');
  assert.equal((await spec.call('', 'POST', { requestId: 'pressure', itemId: 'i1', action: 'confirm' })).status, 202);
  assert.equal(JSON.parse(String((await delivered)[0])).value.sessionId, 's1');
  await Promise.all(pending.map(socket => once(socket, 'close')));
  assert.equal((await spec.connect({ sessionId: 'after-timeout' })).readyState, WebSocket.OPEN, 'handshake timeouts release pending slots');
});

test('wrong store, unrelated sessions, read-token HMAC, hostile frames and upgrades fail closed', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  await spec.connect({ store: 'c'.repeat(64) });
  assert.equal((await (await spec.call('/availability')).json()).available, false);
  await spec.connect({ sessionId: 'unknown' });
  const child = sessionStarted(6, 'child');
  child.payload = { ...(child.payload as object), cwd: '/repo', role: 'subagent', parentSessionId: 's1' };
  await spec.daemon.log.append([child]);
  await spec.connect({ sessionId: 'child' });
  assert.equal((await (await spec.call('/availability')).json()).available, false);
  const denied = await spec.connect({ secret: spec.readToken });
  assert.equal(denied.readyState, WebSocket.CLOSED);
  const ws = await spec.connect();
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'result', value: { version: 1, requestId: 'x', reason: 'applied', human: true } }));
  await closed;
  const large = await spec.connect();
  const tooLarge = once(large, 'close');
  large.send('x'.repeat(16_385));
  await tooLarge;
  const hostile = new WebSocket(`ws://127.0.0.1:${spec.daemon.port}/api/v1/extensions/memory-review`, { origin: 'https://evil.test' });
  hostile.on('error', () => { /* Expected rejection of a hostile upgrade. */ });
  await new Promise(resolve => hostile.once('close', resolve));
  assert.equal(hostile.readyState, WebSocket.CLOSED);
});
