import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { startDaemon } from '../mock-daemon/server.ts';
import { Client } from './client.ts';
import { Model } from './model.ts';

async function until(condition: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert(Date.now() < deadline, 'timed out waiting for live SSE');
    await delay(20);
  }
}

test('live mock API: bearer auth, snapshot + history race, 5k/s SSE and replay reconnect', async () => {
  mkdirSync('.ai-work', { recursive: true });
  const daemon = await startDaemon({ port: 0, rate: 5000, dataDirectory: mkdtempSync('.ai-work/pitui-integration-') });
  const model = new Model();
  const client = new Client(model, `http://127.0.0.1:${daemon.port}`, daemon.token);
  let running = client.run();
  try {
    await until(() => model.connected && model.data.sessions.length === 30 && model.transcript.length >= 2000);
    await client.history('s2');
    const before = model.sequence;
    await until(() => model.sequence >= before + 1000);
    assert.equal(model.data.repositories.length, 6);
    assert(model.transcript.length <= 5500);
    assert.equal(new Set(model.transcript.map(entry => entry.cursor)).size, model.transcript.length);
    client.close();
    await running;
    const reconnect = new Client(model, client.base, daemon.token);
    reconnect.lastSequence = model.sequence;
    running = reconnect.run();
    try {
      await until(() => model.sequence > before + 1200);
      assert(model.connected);
    } finally { reconnect.close(); await running; }
    const unauthorized = await fetch(`${client.base}/api/v0/sessions`);
    assert.equal(unauthorized.status, 401);
    assert.throws(() => new Client(model, 'http://example.com', daemon.token), /loopback/);
  } finally { client.close(); await running; await daemon.close(); }
});
