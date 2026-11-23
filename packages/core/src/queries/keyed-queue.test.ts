import assert from 'node:assert/strict';
import { test } from 'node:test';
import { KeyedQueue, Owners, rowOf } from './keyed-queue.ts';

test('queue replacement and arbitrary removal preserve the minimum without obsolete entries', () => {
  const queue = new KeyedQueue();
  const expected = new Map<string, string>();
  for (let n = 0; n < 200; n++) {
    const id = String(n % 19);
    const key = String((n * 13) % 97).padStart(2, '0');
    queue.set({ id, key });
    expected.set(id, key);
    const removed = String((n * 7) % 19);
    queue.delete(removed);
    expected.delete(removed);
    assert.equal(queue.size, expected.size);
    assert.equal(queue.first?.key, [...expected.values()].sort()[0]);
  }
  for (const id of expected.keys()) queue.delete(id);
  queue.delete('missing');
  assert.equal(queue.size, 0);
  assert.equal(queue.first, undefined);
});

test('reverse owners detach old links and terminate cyclic descendant traversal', () => {
  const owners = new Owners();
  owners.set('child', '__proto__');
  assert.deepEqual([...owners.members('__proto__')], ['child']);
  owners.set('child', 'late');
  assert.equal(owners.members('__proto__').size, 0);
  owners.set('late', 'child');
  assert.deepEqual(owners.descendants(['late']), new Set(['late', 'child']));
  owners.set('child', null);
  assert.equal(owners.get('child'), undefined);
  assert.equal(owners.members('late').size, 0);
  assert.equal(rowOf({}, '__proto__'), undefined);
});
