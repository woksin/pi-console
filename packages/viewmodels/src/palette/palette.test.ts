import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteItems } from './palette.ts';
import { fixture } from '../test-support.ts';

const sessions = fixture.sessions;

test('empty query lists commands first', () => {
  assert.equal(paletteItems({ sessions, query: '' })[0].group, 'Command');
});

test('prefixes restrict the result kind', () => {
  assert.ok(paletteItems({ sessions, query: '>fleet' }).every(item => item.group === 'Command'));
  assert.ok(paletteItems({ sessions, query: '@review' }).every(item => item.group === 'Session'));
});

test('fuzzy search finds a command and a session', () => {
  assert.equal(paletteItems({ sessions, query: 'timel' })[0].label, 'Go to Timeline');
  assert.ok(paletteItems({ sessions, query: 'scout' }).some(item => item.group === 'Session'));
});
