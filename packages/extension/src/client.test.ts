import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { once } from 'node:events';
import { WebSocketServer } from 'ws';
import { memoryReviewTtlMs, reviewPrefix } from '@pi-console/contract';
import { MemoryReviewClient, type ReviewBus } from './client.ts';

class Bus implements ReviewBus {
  listeners = new Map<string, Set<(value: unknown) => void>>();
  on(name: string, listener: (value: unknown) => void) { const set = this.listeners.get(name) ?? new Set(); set.add(listener); this.listeners.set(name, set); return () => { set.delete(listener); }; }
  emit(name: string, value: unknown) { for (const listener of this.listeners.get(name) ?? []) listener(value); }
}

test('production client authenticates daemon and forwards only v1 intents; disconnect cancels pending native prompts', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const secret = 'a'.repeat(64);
  const bus = new Bus();
  const connection = once(server, 'connection');
  const client = new MemoryReviewClient({ url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, secret, binding: { sessionId: 's1', pid: process.pid, cwd: '/repo' }, bus, reconnectMs: 60_000 });
  t.after(() => { client.close(); for (const ws of server.clients) ws.terminate(); server.close(); });
  const [ws] = await connection;
  const hello = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'challenge', nonce: 'c'.repeat(64), generation: 'connection1' }));
  const auth = JSON.parse(String((await hello)[0]));
  assert.equal(auth.binding.sessionId, 's1');
  const proof = createHmac('sha256', secret).update(JSON.stringify(['server', 'c'.repeat(64), 'connection1', auth.nonce, 's1', process.pid, '/repo'])).digest('hex');
  bus.on(`${reviewPrefix}probe`, probe => { assert.deepEqual(probe, { version: 1 }); bus.emit(`${reviewPrefix}readiness`, { version: 1, available: true, storeId: 'd'.repeat(64), sessionId: 's1', generation: 'provider1' }); });
  const frames: { value?: { generation: string; available: boolean } }[] = [];
  ws.on('message', (bytes: Buffer) => { frames.push(JSON.parse(String(bytes))); });
  const ready = new Promise<void>(resolve => ws.on('message', (bytes: Buffer) => { if (JSON.parse(String(bytes)).value?.available) resolve(); }));
  ws.send(JSON.stringify({ type: 'welcome', proof }));
  await ready;
  assert.equal(frames.at(-1)?.value?.generation, 'provider1');
  const request = { requestId: 'r1', itemId: 'i1', action: 'confirm', sessionId: 's1', generation: 'provider1', expiresAt: Date.now() + memoryReviewTtlMs };
  const received = new Promise<unknown>(resolve => bus.on(`${reviewPrefix}request`, resolve));
  ws.send(JSON.stringify({ type: 'request', value: request }));
  assert.deepEqual(await received, request);
  const cancelled = new Promise<unknown>(resolve => bus.on(`${reviewPrefix}cancel`, resolve));
  ws.terminate();
  assert.deepEqual(await cancelled, { requestId: 'r1' });
});

test('a fake daemon welcome never reaches the provider', { timeout: 5000 }, async t => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const bus = new Bus();
  let refreshed = false;
  bus.on(`${reviewPrefix}probe`, () => { refreshed = true; });
  const connection = once(server, 'connection');
  const client = new MemoryReviewClient({ url: `ws://127.0.0.1:${(server.address() as { port: number }).port}`, secret: 'a'.repeat(64), binding: { sessionId: 's1', pid: process.pid, cwd: '/repo' }, bus, reconnectMs: 60_000 });
  t.after(() => { client.close(); for (const ws of server.clients) ws.terminate(); server.close(); });
  const [ws] = await connection;
  const hello = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'challenge', nonce: 'c'.repeat(64), generation: 'c1' }));
  await hello;
  const closed = once(ws, 'close');
  ws.send(JSON.stringify({ type: 'welcome', proof: '0'.repeat(64) }));
  await closed;
  assert.equal(refreshed, false);
});
