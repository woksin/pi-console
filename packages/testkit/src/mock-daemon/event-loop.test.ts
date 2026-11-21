import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiV1Schema, validate, type Health } from '@pi-console/contract';
import { startDaemon } from './server.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('mock health conforms with a real event-loop histogram, including long tasks', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-console-mock-health-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  const daemon = await startDaemon({ port: 0, dataDirectory: directory });
  t.after(() => daemon.close());
  await wait(20);
  const until = performance.now() + 35;
  while (performance.now() < until) { /* Deliberately block to exercise the mock's monitor. */ }
  await wait(15);
  const read = async () => {
    const reply = await fetch(`http://127.0.0.1:${daemon.port}/api/v1/health`, { headers: { authorization: `Bearer ${daemon.token}` } });
    assert.equal(reply.status, 200);
    const health = await reply.json() as Health;
    validate(health, apiV1Schema.$defs.health, apiV1Schema);
    return health.eventLoop;
  };
  const delay = await read();
  assert.ok(delay.p50 > 0);
  assert.ok(delay.p99 >= delay.p50);
  assert.ok(delay.max >= 30, `max ${delay.max} ms`);
  assert.ok((await read()).max >= delay.max, 'health reads do not reset the histogram');
});
