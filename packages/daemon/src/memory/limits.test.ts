import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReviewLimits } from './limits.ts';

test('review limits enforce token and session windows, releasing entries exactly at the minute boundary', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const limits = new ReviewLimits();
  for (let i = 0; i < 6; i++) limits.take('owner', 's1');
  assert.throws(() => { limits.take('owner', 's2'); }, /Review rate limit reached/u);
  assert.throws(() => { limits.take('other', 's1'); }, /Review rate limit reached/u);
  // The first key is charged even when the second key is refused, as before extraction.
  for (let i = 0; i < 5; i++) limits.take('other', 's2');
  assert.throws(() => { limits.take('other', 's3'); }, /Review rate limit reached/u);
  t.mock.timers.tick(60_000);
  assert.doesNotThrow(() => { limits.take('owner', 's1'); limits.take('other', 's2'); });
});
