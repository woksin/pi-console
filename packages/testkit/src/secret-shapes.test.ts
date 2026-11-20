import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretShapes, secretsIn } from './secret-shapes.ts';

test('every shape has a unique name, a non-trivial needle that is part of its value', () => {
  assert.equal(new Set(secretShapes.map(secret => secret.name)).size, secretShapes.length);
  for (const secret of secretShapes) {
    assert.ok(secret.needle.length >= 19, secret.name);
    assert.ok(secret.value.includes(secret.needle), secret.name);
  }
});

test('secretsIn finds every shape and nothing in clean text', () => {
  for (const secret of secretShapes) assert.ok(secretsIn(`before ${secret.value} after`).includes(secret.name), secret.name);
  assert.deepEqual(secretsIn('A bounded queue keeps the retry budget predictable.'), []);
  assert.deepEqual(secretsIn(secretShapes.map(secret => secret.value.replace(secret.needle, '[REDACTED]')).join('\n')), []);
});

test('the module source contains no complete secret literal', () => {
  const source = readFileSync(new URL('./secret-shapes.ts', import.meta.url), 'utf8');
  for (const secret of secretShapes) assert.ok(!source.includes(secret.needle), secret.name);
});
