import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, clip, fuzzy, pad, pressure, sanitize, sparkline, wrap } from './format.ts';

test('sanitize removes CSI, OSC, DCS and control characters but keeps text', () => {
  const hostile = 'a\u001b[31mred\u001b[0m b\u001b]0;pwned\u0007c \u001b]52;c;QUJD\u001b\\d \u001bPq\u001b\\e\u0000f\u009bg\ttab';
  assert.equal(sanitize(hostile), 'ared bc d efg  tab');
  assert.equal(sanitize('plain ✓ → text\nnext'), 'plain ✓ → text\nnext');
});

test('clip and pad count cells, not bytes', () => {
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('ab', 4), 'ab');
  assert.equal(pad('✓ ok', 6), '✓ ok  ');
  assert.equal(clip('x', 0), '');
});

test('wrap breaks words, splits long tokens and marks truncation', () => {
  assert.deepEqual(wrap('one two three', 7), ['one two', 'three']);
  assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
  const cut = wrap('one two three four five six', 8, 2);
  assert.equal(cut.length, 2);
  assert.ok(cut[1].endsWith('…'));
});

test('age, sparkline, pressure and fuzzy', () => {
  const now = Date.parse('2026-01-01T01:00:00Z');
  assert.equal(age('2026-01-01T00:59:30Z', now), '30s');
  assert.equal(age('2026-01-01T00:00:00Z', now), '1h');
  assert.equal(sparkline([0, 50, 100], 100), '▁▄█');
  assert.deepEqual([pressure(10), pressure(70), pressure(90)], ['calm', 'warm', 'hot']);
  assert.ok(fuzzy('flt', 'Fleet')! >= 0);
  assert.equal(fuzzy('xyz', 'Fleet'), undefined);
});
