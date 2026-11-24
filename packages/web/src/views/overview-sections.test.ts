import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupAttentionCards } from './overview-sections.ts';

test('groups requests together after blocking questions using the shared reason priority', () => {
  const cards = [
    { id: 'request A', reason: 'open-request', reasonLabel: 'Open request' },
    { id: 'question B', reason: 'blocking-question', reasonLabel: 'Blocking question' },
    { id: 'request C', reason: 'open-request', reasonLabel: 'Open request' },
  ];
  assert.deepEqual(groupAttentionCards(cards), [
    { reason: 'blocking-question', label: 'Blocking question', cards: [cards[1]] },
    { reason: 'open-request', label: 'Open request', cards: [cards[0], cards[2]] },
  ]);
  assert.deepEqual(groupAttentionCards(cards).flatMap(section => section.cards), [cards[1], cards[0], cards[2]]);
  assert.deepEqual(groupAttentionCards([]), []);
});

test('keeps the shared viewmodel order inside each reason', () => {
  const cards = ['request A', 'request C'].map(id => ({ id, reason: 'open-request', reasonLabel: 'Open request' }));
  assert.deepEqual(groupAttentionCards(cards), [{ reason: 'open-request', label: 'Open request', cards }]);
});
