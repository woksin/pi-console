import assert from 'node:assert/strict';
import test from 'node:test';
import { stripUnsafeCharacters, unsafeCharacters } from './text-safety.ts';

test('C0, C1 and bidirectional characters are removed while tab, newline and ordinary text are kept', () => {
  const unsafe = ['\u0000', '\u0008', '\u000b', '\u001b', '\u007f', '\u0085', '\u009f', '\u202a', '\u202e', '\u2066', '\u2069'];
  for (const char of unsafe) assert.equal(stripUnsafeCharacters(`a${char}b`), 'ab', JSON.stringify(char));
  assert.equal(stripUnsafeCharacters('a\tb\nc é€ \u2026'), 'a\tb\nc é€ \u2026');
});

test('the shared pattern is global so one call strips every occurrence', () => {
  assert.equal(unsafeCharacters.global, true);
  assert.equal(stripUnsafeCharacters('\u202e\u2066x\u0085\u202e'), 'x');
  assert.equal(stripUnsafeCharacters('\u202e\u2066x\u0085\u202e'), 'x');
});
