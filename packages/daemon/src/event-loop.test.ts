import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLoopHealth } from './event-loop.ts';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('event-loop health reports milliseconds, retains long tasks across reads and stops on close', async t => {
  const monitor = new EventLoopHealth();
  t.after(() => monitor.close());
  assert.deepEqual(monitor.read(), { p50: 0, p99: 0, max: 0 });
  await wait(20);
  const until = performance.now() + 35;
  while (performance.now() < until) { /* Deliberately block to exercise the histogram. */ }
  await wait(15);
  const delay = monitor.read();
  assert.ok(delay.p50 > 0);
  assert.ok(delay.p99 >= delay.p50);
  assert.ok(delay.max >= 30, `max ${delay.max} ms`);
  assert.ok(monitor.read().max >= delay.max, 'reading does not reset the histogram');
  monitor.close();
  const stopped = monitor.read();
  await wait(15);
  assert.deepEqual(monitor.read(), stopped);
});
