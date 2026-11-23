import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, searchNeedle, searchRanges } from './search.ts';

test('the filter rule is a case-insensitive substring, whitespace significant', () => {
  assert.equal(searchNeedle(undefined), '');
  assert.equal(matchesSearch('Hello World', searchNeedle('o w')), true);
  assert.equal(matchesSearch('ab', searchNeedle('a b')), false);
});

test('ranges index the original UTF-16 text, across surrogate pairs and length-changing lower-casing', () => {
  assert.deepEqual(searchRanges('😀needle', 'needle'), [[2, 8]]);
  assert.deepEqual(searchRanges('a😀b😀B', '😀b'), [[1, 4], [4, 7]]);
  assert.deepEqual(searchRanges('Xx x', 'x'), [[0, 1], [1, 2], [3, 4]]);
  assert.deepEqual(searchRanges('İx needle', 'needle'), [[3, 9]]);
  assert.deepEqual(searchRanges('abc', ''), []);
});
