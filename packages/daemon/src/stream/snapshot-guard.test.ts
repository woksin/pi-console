import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ServerResponse } from 'node:http';
import { StreamHub } from './stream-hub.ts';

function fakeClient(written: string[]): ServerResponse {
  const client = { destroyed: false, writableLength: 0, writeHead: () => client, flushHeaders: () => undefined, on: () => client, destroy: () => { client.destroyed = true; },
    write: (text: string) => { written.push(text); return true; } };
  return client as unknown as ServerResponse;
}

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
