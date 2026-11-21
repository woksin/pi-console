import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consoleTitle, titleText } from './title.ts';

test('the needs-you count leads the title and disappears at zero', () => {
  assert.equal(consoleTitle({ needsYou: 3, place: 'Overview' }), '(3) Overview · pi console');
  assert.equal(consoleTitle({ needsYou: 0, place: 'Fleet' }), 'Fleet · pi console');
  assert.equal(consoleTitle({ needsYou: 250 }), '(99+) pi console');
});

test('a hostile session name cannot escape the title', () => {
  const hostile = 'evil\u001b]2;pwned\u0007\u001b[31mred\u009b2J\r\nnext\u202eline\u0000';
  const title = consoleTitle({ needsYou: 1, place: hostile });
  // eslint-disable-next-line no-control-regex -- asserting no control characters survive
  assert.doesNotMatch(title, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
  assert.ok(title.startsWith('(1) evil'));
  assert.ok(title.endsWith(' · pi console'));
  assert.equal(titleText('a'.repeat(200)).length, 60);
});
