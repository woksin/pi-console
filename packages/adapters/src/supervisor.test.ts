import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AdapterSupervisor } from './supervisor.ts';

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await delay(5);
  }
  assert.fail('Supervisor did not reach expected state');
}

test('supervisor retries with capped backoff and supports idempotent start, stop and restart', async () => {
  let polls = 0;
  let created = 0;
  let closed = 0;
  const retries: number[] = [];
  const supervisor = new AdapterSupervisor(() => {
    created++;
    return { poll: async () => { if (++polls <= 3) throw new Error('Synthetic crash'); }, close: () => { closed++; } };
  }, { intervalMs: 5, backoffMs: 2, maxBackoffMs: 5, onError: (_error, ms) => { retries.push(ms); } });
  try {
    supervisor.start();
    supervisor.start();
    await until(() => polls >= 4);
    assert.deepEqual(retries, [2, 4, 5]);
    assert.equal(created, 4);
    await supervisor.stop();
    const stopped = polls;
    await delay(15);
    assert.equal(polls, stopped);
    assert.equal(closed, created);
    await supervisor.restart();
    await until(() => polls > stopped);
  } finally { await supervisor.stop(); }
});

test('stop drains the in-flight poll before closing the worker', async () => {
  let release!: () => void;
  let entered = false;
  let closed = false;
  const wait = new Promise<void>(resolve => { release = resolve; });
  const supervisor = new AdapterSupervisor(() => ({ poll: async () => { entered = true; await wait; }, close: () => { closed = true; } }));
  supervisor.start();
  await until(() => entered);
  const stopping = supervisor.stop();
  await delay(5);
  assert.equal(closed, false);
  release();
  await stopping;
  assert.equal(closed, true);
});
