import { test } from 'node:test';
import assert from 'node:assert/strict';
import { age, cells, clip, clipCells, clock, compactNumber, displayWidth, fuzzy, graphemes, money, pad, padStart, pressure, sanitize, sparkline, wrap } from './format.ts';

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

test('clients can supply their width method while the default remains grapheme-based', () => {
  const family = '👨‍👩‍👧‍👦';
  const measure = (text: string) => graphemes(text).reduce((width, item) => width + (item === family ? 4 : displayWidth(item)), 0);
  assert.equal(displayWidth(family), 2);
  assert.equal(clipCells(`${family}abc`, 6, measure), `${family}a…`);
  assert.equal(clip(`${family}  abc`, 6, measure), `${family} …`);
  assert.equal(pad(family, 6, measure), `${family}  `);
  assert.equal(padStart(family, 6, measure), `  ${family}`);
  assert.deepEqual(wrap(`${family} abc`, 6, Infinity, measure), [family, 'abc']);
  assert.deepEqual(wrap(`${family}abc`, 6, Infinity, measure), [`${family}ab`, 'c']);
  assert.deepEqual(wrap(`${family} abc`, 6, 1, measure), [`${family}…`]);
  assert.deepEqual(wrap(`${family} abc`, 6), [`${family} abc`]);
});

test('display helpers preserve Unicode, whitespace and width edge cases', () => {
  assert.deepEqual(cells('a😀é'), ['a', '😀', 'e', '́']);
  assert.equal(clip('  a\n b  ', 20), ' a b ');
  assert.equal(clip('😀ab', 2), ' …');
  assert.equal(clip('abc', 1), '…');
  assert.equal(clip('abc', -1), '');
  assert.equal(pad('abcdef', 4), 'abc…');
  assert.equal(padStart('😀', 3), ' 😀');
  assert.equal(padStart('abcd', 2), 'abcd');
  assert.deepEqual(wrap('one\n\n😀ab', 2), ['on', 'e', '', '😀', 'ab']);
  assert.deepEqual(wrap('', 4), ['']);
});

test('terminal width counts graphemes, wide characters and emoji without counting their joiners', () => {
  const examples: [string, number][] = [
    ['ASCII', 5], ['界Ａ한', 6], ['𠀀', 2], ['e\u0301', 1], ['\u0301\u200d\ufe0f', 0],
    ['😀', 2], ['👨‍👩‍👧‍👦', 2], ['👩🏽‍💻', 2], ['🇳🇴', 2], ['❤️', 2], ['1️⃣', 2], ['·─', 2],
  ];
  for (const [text, width] of examples) assert.equal(displayWidth(text), width, text);
});

test('clipping keeps whole graphemes and fills a straddled wide cell with a space', () => {
  assert.equal(clip('界😀x', 4), '界 …');
  assert.equal(clip('A界B', 3), 'A …');
  assert.equal(clip('👨‍👩‍👧‍👦x', 2), ' …');
  assert.equal(clip('e\u0301xy', 2), 'e\u0301…');
  assert.equal(clip('🇳🇴x', 1), '…');
  assert.equal(clip('界', 2), '界');
  assert.equal(clip('界', 0), '');
  assert.equal(clip('界', -1), '');
  assert.equal(clipCells('a  b', 4), 'a  b');
  assert.equal(pad('界', 4), '界  ');
  assert.equal(padStart('界', 4), '  界');
  assert.equal(padStart('e\u0301', 3), '  e\u0301');
});

test('wrapping long Unicode tokens keeps graphemes intact and every line within its cell budget', () => {
  assert.deepEqual(wrap('界界界😀👨‍👩‍👧‍👦🇳🇴', 4), ['界界', '界😀', '👨‍👩‍👧‍👦🇳🇴']);
  assert.deepEqual(wrap('e\u0301e\u0301e\u0301', 2), ['e\u0301e\u0301', 'e\u0301']);
  assert.deepEqual(wrap('👩‍💻👩‍💻', 1), [' ', ' ']);
  assert.deepEqual(wrap('界', 0), ['']);
  const source = '界😀e\u0301👩🏽‍💻🇳🇴界';
  const allowed = new Set(['界', '😀', 'e\u0301', '👩🏽‍💻', '🇳🇴', ' ', '…']);
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const width of [1, 2, 3, 4, 5, 6]) {
    for (const line of [clip(source, width), ...wrap(source, width), ...wrap(source, width, 2)]) {
      assert.ok(displayWidth(line) <= width, `${String(width)}: ${line}`);
      for (const { segment } of segments.segment(line)) assert.ok(allowed.has(segment), segment);
    }
    assert.equal(displayWidth(pad(source, width)), width);
  }
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
