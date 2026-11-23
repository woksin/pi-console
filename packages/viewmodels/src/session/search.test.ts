import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesSearch, searchNeedle, searchRanges } from './search.ts';

test('the filter rule is a case-insensitive substring, whitespace significant', () => {
  assert.equal(searchNeedle(undefined), '');
  assert.equal(matchesSearch('Hello World', searchNeedle('o w')), true);
  assert.equal(matchesSearch('ab', searchNeedle('a b')), false);
  assert.equal(matchesSearch('anything', searchNeedle('')), false);
});

test('ranges index the original UTF-16 text, across surrogate pairs and length-changing lower-casing', () => {
  assert.deepEqual(searchRanges('😀needle', 'needle'), [[2, 8]]);
  assert.deepEqual(searchRanges('a😀b😀B', '😀b'), [[1, 4], [4, 7]]);
  assert.deepEqual(searchRanges('Xx x', 'x'), [[0, 1], [1, 2], [3, 4]]);
  assert.deepEqual(searchRanges('İx needle', 'needle'), [[3, 9]]);
  assert.deepEqual(searchRanges('abc', ''), []);
});

test('Greek sigma folding is context-free in the term, filter and source ranges', () => {
  assert.equal(searchNeedle('ΟΣ'), 'οσ');
  for (const text of ['ΟΣ', 'ΟΣ İ', '😀ΟΣ İ', 'İ ΟΣ']) {
    const needle = searchNeedle('ΟΣ');
    const at = text.indexOf('ΟΣ');
    assert.equal(matchesSearch(text, needle), true);
    assert.deepEqual(searchRanges(text, needle), [[at, at + 2]]);
  }
  assert.equal(matchesSearch('οσ', searchNeedle('ΟΣ')), true);
  assert.deepEqual(searchRanges('ΟΣ İ', searchNeedle('ΟΣ İ')), [[0, 4]]);
});

test('expanding folds map each matching unit to the exact source bounds', () => {
  assert.deepEqual(searchRanges('😀İ😀', searchNeedle('i')), [[2, 3]]);
  assert.deepEqual(searchRanges('😀İ😀', searchNeedle('\u0307')), [[2, 3]]);
  assert.deepEqual(searchRanges('😀İ😀', searchNeedle('İ😀')), [[2, 5]]);
  assert.deepEqual(searchRanges('İ😀', '\ude00'), [[2, 3]]);
});
