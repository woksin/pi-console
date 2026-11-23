import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import type { Snapshot } from '@pi-console/contract';
import { ConsoleQueries } from '@pi-console/core';
import { syntheticModels } from '@pi-console/core/testing';
import { openStream } from '@pi-console/testkit';
import { safeJson } from '../http/output.ts';
import { StreamHub } from './stream-hub.ts';

const at = '2026-06-01T00:00:00.000Z';
const now = () => new Date(at);
const encode = (payload: Snapshot) => `id: 123456789\nevent: snapshot\ndata: ${safeJson({ seq: 123456789, type: 'snapshot', occurredAt: at, payload })}\n\n`;

async function serve(t: TestContext, queries: ConsoleQueries, cap: number) {
  const hub = new StreamHub({ base: 123456789, persist: () => undefined, ringSize: 10, heartbeatMs: 60000,
    maxBufferedBytes: cap, now, snapshot: active => queries.screenSnapshot(at, active ? 0 : undefined) });
  let buffered = 0;
  let destroyed = false;
  const server = createServer((_request, response) => {
    hub.connect(response, undefined);
    buffered = response.writableLength;
    destroyed = response.destroyed;
  });
  t.after(async () => { hub.close(); server.closeAllConnections(); await server[Symbol.asyncDispose](); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const stream = await openStream(address.port, {});
  t.after(() => { stream.close(); });
  return { hub, stream, output: () => ({ buffered, destroyed }) };
}

test('5,000 active pairs bootstrap over real HTTP within half the cap and remain connected for live updates', { timeout: 10000 }, async t => {
  const models = syntheticModels({ sessions: 5000, requests: 5000, questions: 0, messages: 0, jobs: 0 }, 1);
  for (const row of Object.values(models.requests.requests)) row.status = 'open';
  const queries = new ConsoleQueries(() => models, now);
  const cap = 1024 * 1024;
  const { hub, stream, output } = await serve(t, queries, cap);
  const first = await stream.next();
  const snapshot = first.data.payload as Snapshot;
  assert.equal(first.event, 'snapshot');
  assert.ok(snapshot.requests.length > 0 && snapshot.sessions.length > 0);
  assert.ok(snapshot.requests.some(row => row.id === 'r0004999'));
  assert.ok(Buffer.byteLength(encode(snapshot)) <= cap / 2);
  assert.equal(output().destroyed, false);
  assert.ok(output().buffered <= cap, 'HTTP framing is inside the slow-client cap too');
  assert.equal(hub.clients, 1);
  hub.publish('request.updated', { id: 'live' });
  assert.equal((await stream.next()).event, 'request.updated');
  assert.equal(hub.clients, 1);
});

test('hard-budget packing reserves the real HTTP chunk overhead instead of dropping a healthy client at the boundary', { timeout: 10000 }, async t => {
  const models = syntheticModels({ sessions: 1, requests: 3, questions: 0, messages: 0, jobs: 0 }, 1);
  Object.values(models.sessions.sessions)[0].cwd = `/${'owner'.repeat(1000)}`;
  const requests = Object.values(models.requests.requests);
  for (const row of requests) row.status = 'open';
  requests[0].text = 'small';
  requests[1].text = 'larger'.repeat(20);
  requests[2].text = 'oversized'.repeat(20000);
  const queries = new ConsoleQueries(() => models, now);
  const normal = queries.screenSnapshot(at);
  const cap = Buffer.byteLength(encode({ ...normal, requests: [normal.requests[1]], bounded: ['requests'] }));
  const { hub, stream, output } = await serve(t, queries, cap);
  const snapshot = (await stream.next()).data.payload as Snapshot;
  const bytes = Buffer.byteLength(encode(snapshot));
  assert.ok(bytes > cap / 2, 'the owner alone needs the hard-budget fallback');
  assert.ok(bytes + bytes.toString(16).length + 4 <= cap, 'the payload and chunk framing both fit');
  assert.deepEqual(snapshot.requests.map(row => row.id), [requests[0].id], 'a cap-sized request bundle is skipped for a transport-safe smaller one');
  assert.equal(output().destroyed, false);
  assert.ok(output().buffered <= cap);
  assert.equal(hub.clients, 1);
});
