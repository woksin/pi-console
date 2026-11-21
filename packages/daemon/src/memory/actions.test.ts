import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
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
  const call = async (path: string, method = 'GET', body?: unknown, credential = token, extra: Record<string, string> = {}) => fetch(`http://127.0.0.1:${daemon.port}/api/v1/memory-actions${path}`, { method, headers: { Authorization: `Bearer ${credential}`, Origin: `http://127.0.0.1:${daemon.port}`, 'x-pi-console-csrf': '1', 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const start = sessionStarted(1, 's1');
  start.payload = { ...(start.payload as object), cwd: '/repo' };
  await daemon.log.append([start, proposed(2, 'i1'), proposed(3, 'i2')]);
  const storeId = createHash('sha256').update(realpathSync(join(agentRoot, 'memory'))).digest('hex');
  const connect = async (sessionId = 's1', store = storeId, secret = token) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/api/v1/extensions/memory-review`);
    sockets.push(ws);
    const [bytes] = await once(ws, 'message');
    const challenge = JSON.parse(String(bytes));
    const binding = { sessionId, pid: process.pid, cwd: '/repo' };
    const nonce = 'b'.repeat(64);
    const proof = createHmac('sha256', secret).update(JSON.stringify(['client', challenge.nonce, challenge.generation, nonce, sessionId, binding.pid, binding.cwd])).digest('hex');
    const welcome = once(ws, secret === token ? 'message' : 'close');
    ws.send(JSON.stringify({ type: 'hello', nonce, binding, proof }));
    await welcome;
    if (secret !== token) return ws;
    ws.send(JSON.stringify({ type: 'readiness', value: { version: 1, available: true, storeId: store, sessionId, generation: 'g1' } }));
    await new Promise(resolve => setTimeout(resolve, 20));
    return ws;
  };
  return { call, connect, token, readToken, config, get daemon() { return daemon; }, async restart() { await daemon.close(); daemon = await startDaemon(config); }, source: join(realpathSync(agentRoot), 'memory/events.jsonl') };
}
function proposed(n: number, itemId: string) {
  return testEvent(n, 'MemoryItemRecorded', { itemId, kind: 'directive', scopeKind: 'session', scopeKey: 's1', sourceType: 'agent_decision', sourceMessageId: null, authorityMode: null, supersedes: [], excerpt: 'A proposal', truncated: false, withheld: false }, { source: 'intent-memory' });
}
const applied = (ws: WebSocket, request: Record<string, unknown>, eventId: string) => ws.send(JSON.stringify({ type: 'result', value: { version: 1, ...request, expiresAt: undefined, ok: true, status: 'applied', reason: 'applied', eventId } }));
const receiptState = async (call: Awaited<ReturnType<typeof setup>>['call'], id: string) => (await (await call(`/${id}`)).json()).state;

test('disabled and offline stay read-only; read scope, forged provenance and browser-policy bypasses cannot request review', { timeout: 5000 }, async t => {
  const disabled = await setup(t, false);
  assert.equal((await (await disabled.call('/availability')).json()).available, false);
  const spec = await setup(t);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' }, spec.readToken)).status, 403);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' }, spec.token, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await spec.call('', 'POST', {}, spec.token, { 'x-pi-console-csrf': '0' })).status, 403);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm', actor: 'human' })).status, 400);
  assert.equal((await spec.call('', 'POST', { requestId: 'r1', itemId: 'i1', action: 'confirm' })).status, 409);
  const noOrigin = await fetch(`http://127.0.0.1:${spec.daemon.port}/api/v1/memory-actions`, { method: 'POST', headers: { Authorization: `Bearer ${spec.token}`, 'x-pi-console-csrf': '1' } });
  assert.equal(noOrigin.status, 403);
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
  t.mock.timers.tick(91_000);
  const cancel = once(current, 'message');
  await spec.call('', 'POST', { requestId: 'trigger', itemId: 'missing', action: 'confirm' });
  assert.equal(JSON.parse(String((await cancel)[0])).requestId, 'expire');
  assert.equal(await receiptState(spec.call, 'expire'), 'expired');
  applied(current, pending, 'late2');
  assert.equal(await receiptState(spec.call, 'expire'), 'expired');
  assert.equal(spec.daemon.log.lastSeq(), 3);
});

test('wrong store, unknown/child sessions, read-token HMAC, hostile frames and upgrades fail closed', { timeout: 5000 }, async t => {
  const spec = await setup(t);
  await spec.connect('s1', 'c'.repeat(64));
  assert.equal((await (await spec.call('/availability')).json()).available, false);
  await spec.connect('unknown');
  const child = sessionStarted(6, 'child');
  child.payload = { ...(child.payload as object), cwd: '/repo', role: 'subagent', parentSessionId: 's1' };
  await spec.daemon.log.append([child]);
  await spec.connect('child');
  assert.equal((await (await spec.call('/availability')).json()).available, false);
  const denied = await spec.connect('s1', undefined, spec.readToken);
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
