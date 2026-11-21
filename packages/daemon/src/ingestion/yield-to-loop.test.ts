import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yieldToLoop } from './yield-to-loop.ts';

test('concurrent pipelines resume one per loop turn, so their slices never share a turn', async () => {
  const order: string[] = [];
  const pipeline = async (name: string) => {
    await yieldToLoop();
    order.push(name);
  };
  const both = Promise.all([pipeline('a'), pipeline('b')]);
  // Queued behind the first resume in the same check phase; the second resume needs a later iteration.
  setImmediate(() => { order.push('same turn'); });
  await both;
  assert.deepEqual(order, ['a', 'same turn', 'b']);
});

test('pipelines that keep yielding take turns in arrival order', async () => {
  const order: string[] = [];
  const pipeline = async (name: string) => {
    for (let slice = 0; slice < 3; slice++) {
      await yieldToLoop();
      order.push(`${name}${slice}`);
    }
  };
  await Promise.all([pipeline('a'), pipeline('b')]);
  assert.deepEqual(order, ['a0', 'b0', 'a1', 'b1', 'a2', 'b2']);
});
