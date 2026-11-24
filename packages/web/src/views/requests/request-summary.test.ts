import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeFilterChips, defaultRequestFilter, filterValueLabel } from './request-summary.ts';

const sessions = [{ id: 's1', name: 'Aurora' }];
const chips = (filter: Partial<typeof defaultRequestFilter>) => activeFilterChips({ filter: { ...defaultRequestFilter, ...filter }, sessions });

test('default filters produce no chips', () => {
  assert.deepEqual(chips({}), []);
});

test('each non-default filter produces exactly its own chip', () => {
  assert.deepEqual(chips({ state: 'open' }), ['State: Open']);
  assert.deepEqual(chips({ origin: 'launch' }), ['Origin: Launch']);
  assert.deepEqual(chips({ sessionId: 's1' }), ['Session: Aurora']);
  assert.deepEqual(chips({ sessionId: 'gone' }), ['Session: gone']);
  assert.deepEqual(chips({ query: '  deploy ' }), ['“deploy”']);
});

test('a blank query is not a chip and resetting to defaults clears all of them', () => {
  assert.deepEqual(chips({ query: '   ' }), []);
  assert.deepEqual(chips({ state: 'open', origin: 'human', sessionId: 's1', query: 'x' }).length, 4);
  assert.deepEqual(chips({ ...defaultRequestFilter }), []);
});

test('selector options and chips share one capitalised label convention', () => {
  assert.deepEqual(['all', 'possibly-unseen', 'human'].map(filterValueLabel), ['All', 'Possibly unseen', 'Human']);
});
