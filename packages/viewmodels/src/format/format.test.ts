import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, cells, clip, clock, compactNumber, fuzzy, money, pad, padStart, pressure, sanitize, sparkline, wrap } from './format.ts';

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

test('display helpers preserve Unicode, whitespace and width edge cases', () => {
  assert.deepEqual(cells('a😀é'), ['a', '😀', 'e', '́']);
  assert.equal(clip('  a\n b  ', 20), ' a b ');
  assert.equal(clip('😀ab', 2), '😀…');
  assert.equal(clip('abc', 1), '…');
  assert.equal(clip('abc', -1), '');
  assert.equal(pad('abcdef', 4), 'abc…');
  assert.equal(padStart('😀', 3), '  😀');
  assert.equal(padStart('abcd', 2), 'abcd');
  assert.deepEqual(wrap('one\n\n😀ab', 2), ['on', 'e', '', '😀a', 'b']);
  assert.deepEqual(wrap('', 4), ['']);
});

test('ages keep rounding, boundaries, invalid dates and future timestamps', () => {
  const now = Date.parse('2026-01-02T00:00:00Z');
  const cases = [[0, '0s'], [59_000, '59s'], [59_500, '1m'], [3_600_000, '1h'], [86_400_000, '1d'], [-1000, '0s']] as const;
  for (const [elapsed, expected] of cases) assert.equal(age(new Date(now - elapsed).toISOString(), now), expected);
  assert.equal(age('invalid', now), '–');
});

test('numeric and time displays retain precision and scale boundaries', () => {
  assert.equal(clock('2026-01-01T12:34:56.000Z'), '12:34:56');
  assert.equal(money(1.235), '$1.24');
  assert.equal(money(-2), '$-2.00');
  assert.deepEqual([999, 1000, 1e6, -1000].map(compactNumber), ['999', '1.0k', '1.0M', '-1000']);
  assert.deepEqual([60, 61, 80, 81].map(pressure), ['calm', 'warm', 'warm', 'hot']);
  assert.equal(sparkline([]), '');
  assert.equal(sparkline([-10, 0, 100, 200], 100), '▁▁██');
  assert.equal(sparkline([0, 1]), '▁█');
});

test('fuzzy matching keeps case-insensitive scores, empty queries and missing matches', () => {
  assert.equal(fuzzy('FL', 'Fleet'), -1);
  assert.equal(fuzzy('ft', 'Fleet'), 2);
  assert.equal(fuzzy('', 'Fleet'), 0);
  assert.equal(fuzzy('ff', 'Fleet'), undefined);
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
