import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupAttentionCards } from './overview-sections.ts';

test('keeps request A, question B, request C in daemon order as separate adjacent sections', () => {
  const cards = [
    { id: 'request A', reason: 'open-request', reasonLabel: 'Open request' },
    { id: 'question B', reason: 'blocking-question', reasonLabel: 'Blocking question' },
    { id: 'request C', reason: 'open-request', reasonLabel: 'Open request' },
  ];
  assert.deepEqual(groupAttentionCards(cards), [
    { reason: 'open-request', label: 'Open request', cards: [cards[0]] },
    { reason: 'blocking-question', label: 'Blocking question', cards: [cards[1]] },
    { reason: 'open-request', label: 'Open request', cards: [cards[2]] },
  ]);
  assert.deepEqual(groupAttentionCards(cards).flatMap(section => section.cards), cards);
  assert.deepEqual(groupAttentionCards([]), []);
});

test('merges adjacent cards of the same reason without changing their order', () => {
  const cards = ['request A', 'request C'].map(id => ({ id, reason: 'open-request', reasonLabel: 'Open request' }));
  assert.deepEqual(groupAttentionCards(cards), [{ reason: 'open-request', label: 'Open request', cards }]);
});
