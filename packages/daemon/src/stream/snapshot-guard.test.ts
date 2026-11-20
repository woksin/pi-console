import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { StreamHub } from './stream-hub.ts';

function fakeClient(written: string[]): ServerResponse {
  const client = { destroyed: false, writableLength: 0, writeHead: () => client, flushHeaders: () => undefined, on: () => client, destroy: () => { client.destroyed = true; },
    write: (text: string) => { written.push(text); return true; } };
  return client as unknown as ServerResponse;
}

test('an active-only snapshot over the cap delivers a minimal bounded frame without destroying the client', () => {
  const written: string[] = [];
  const warnings: string[] = [];
  const totals = { sessions: 150, requests: 159, questions: 24, messages: 0, jobs: 49, resets: 3071 };
  const calls: (boolean | undefined)[] = [];
  const stream = hub(activeOnly => { calls.push(activeOnly); return { totals, text: '界'.repeat(activeOnly ? 500 : 700) }; }, warnings);
  const client = fakeClient(written);
  stream.connect(client, undefined);
  const destroyed = client.destroyed;
  stream.close();
  assert.deepEqual(calls, [undefined, true]);
  assert.equal(destroyed, false);
  assert.equal(written.length, 1);
  assert.ok(Buffer.byteLength(written[0]) <= 1000);
  const frame = JSON.parse(written[0].split('data: ')[1]) as { payload: { totals: unknown; bounded: string[]; resets: unknown[] } };
  assert.deepEqual(frame.payload.totals, totals);
  assert.deepEqual(frame.payload.bounded, ['sessions', 'requests', 'questions', 'messages', 'jobs', 'resets']);
  assert.deepEqual(frame.payload.resets, []);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /active-only .* bytes.*minimal snapshot \(\d+ bytes\)/);
});

test('a cap smaller than the minimal envelope fails before any SSE headers or frame are written', () => {
  const written: string[] = [];
  const client = fakeClient(written);
  let headers = false;
  client.writeHead = () => { headers = true; return client; };
  const stream = new StreamHub({ base: 0, persist: () => undefined, ringSize: 10, heartbeatMs: 60_000, maxBufferedBytes: 100, snapshot: () => ({ text: 'x'.repeat(1000) }) });
  assert.throws(() => stream.connect(client, undefined), /Snapshot frame exceeds buffer cap/);
  stream.close();
  assert.equal(headers, false);
  assert.deepEqual(written, []);
  assert.equal(client.destroyed, false);
});

const hub = (snapshot: (activeOnly?: boolean) => unknown, warnings: string[]) => new StreamHub({
  base: 0, persist: () => undefined, ringSize: 10, heartbeatMs: 60_000, maxBufferedBytes: 1000, snapshot, warn: message => warnings.push(message),
});

test('a snapshot above half the buffer cap is rebuilt once as active-only, with a warning', () => {
  const written: string[] = [];
  const warnings: string[] = [];
  const calls: (boolean | undefined)[] = [];
  const stream = hub(activeOnly => { calls.push(activeOnly); return { text: activeOnly ? 'small' : 'x'.repeat(600) }; }, warnings);
  stream.connect(fakeClient(written), undefined);
  stream.close();
  assert.deepEqual(calls, [undefined, true]);
  assert.equal(warnings.length, 1);
  assert.equal(written.length, 1);
  assert.ok(written[0].includes('small'));
});

test('a snapshot within half the cap is sent as built', () => {
  const written: string[] = [];
  const warnings: string[] = [];
  const stream = hub(() => ({ text: 'fits' }), warnings);
  stream.connect(fakeClient(written), undefined);
  stream.close();
  assert.equal(warnings.length, 0);
  assert.ok(written[0].includes('fits'));
});
