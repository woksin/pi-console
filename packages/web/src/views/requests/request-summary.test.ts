import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeFilterChips, defaultRequestFilter } from './request-summary.ts';

const sessions = [{ id: 's1', name: 'Aurora' }];
const chips = (filter: Partial<typeof defaultRequestFilter>) => activeFilterChips({ filter: { ...defaultRequestFilter, ...filter }, sessions });

test('default filters produce no chips', () => {
  assert.deepEqual(chips({}), []);
});

test('each non-default filter produces exactly its own chip', () => {
  assert.deepEqual(chips({ state: 'open' }), ['state open']);
  assert.deepEqual(chips({ origin: 'launch' }), ['origin launch']);
  assert.deepEqual(chips({ sessionId: 's1' }), ['session Aurora']);
  assert.deepEqual(chips({ sessionId: 'gone' }), ['session gone']);
  assert.deepEqual(chips({ query: '  deploy ' }), ['“deploy”']);
});

test('a blank query is not a chip and resetting to defaults clears all of them', () => {
  assert.deepEqual(chips({ query: '   ' }), []);
  assert.deepEqual(chips({ state: 'open', origin: 'human', sessionId: 's1', query: 'x' }).length, 4);
  assert.deepEqual(chips({ ...defaultRequestFilter }), []);
});
