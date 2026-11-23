import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastInput } from './last-input.ts';

test('the last input is reused by identity and replaced by a different one', () => {
  let calls = 0;
  const list = [1];
  const memo = lastInput((items: number[], query: string) => { calls += 1; return `${query}:${String(items.length)}`; });
  assert.equal(memo(list, 'a'), 'a:1');
  assert.equal(memo(list, 'a'), 'a:1');
  assert.equal(calls, 1);
  memo([1], 'a');
  assert.equal(calls, 2, 'an equal-looking but different array is a new input');
  memo(list, 'b');
  memo(list, 'a');
  assert.equal(calls, 4, 'only the most recent input is retained');
});
