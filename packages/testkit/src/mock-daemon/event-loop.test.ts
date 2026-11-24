import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiV1Schema, validate, type Health } from '@pi-console/contract';
import { startDaemon } from './server.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Timer sleeps alone don't guarantee that the native sampler has run under load. */
async function waitForHistogram(read: () => Promise<Health['eventLoop']>, ready: (delay: Health['eventLoop']) => boolean) {
  const deadline = performance.now() + 2000;
  let delay = await read();
  while (!ready(delay) && performance.now() < deadline) {
    await wait(5);
    delay = await read();
  }
  return delay;
}

test('mock health conforms with a real event-loop histogram, including long tasks', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-mock-health-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const daemon = await startDaemon({ port: 0, dataDirectory: directory });
  t.after(() => daemon.close());
  const read = async () => {
    const reply = await fetch(`http://127.0.0.1:${daemon.port}/api/v1/health`, { headers: { authorization: `Bearer ${daemon.token}` } });
    assert.equal(reply.status, 200);
    const health = await reply.json() as Health;
    validate(health, apiV1Schema.$defs.health, apiV1Schema);
    return health.eventLoop;
  };
  const baseline = await waitForHistogram(read, delay => delay.p50 > 0);
  assert.ok(baseline.p50 > 0, 'the sampler must record a baseline before blocking');
  const until = performance.now() + 35;
  while (performance.now() < until) { /* Deliberately block to exercise the mock's monitor. */ }
  const delay = await waitForHistogram(read, delay => delay.max >= 30);
  t.diagnostic(`event-loop delay (ms): ${JSON.stringify(delay)}`);
  assert.ok(delay.p50 > 0);
  assert.ok(delay.p99 >= delay.p50);
  assert.ok(delay.max >= 30, `max ${delay.max} ms`);
  assert.ok((await read()).max >= delay.max, 'health reads do not reset the histogram');
});
