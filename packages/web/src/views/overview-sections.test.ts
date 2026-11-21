import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupAttentionCards } from './overview-sections.ts';

test('merges non-adjacent attention reasons without losing cards or their within-group ranking', () => {
  const cards = [
    { id: 'first', reason: 'open-request', reasonLabel: 'Open request' },
    { id: 'unseen', reason: 'answer-possibly-unseen', reasonLabel: 'Answer possibly unseen' },
    { id: 'later', reason: 'open-request', reasonLabel: 'Open request' },
  ];
  assert.deepEqual(groupAttentionCards(cards), [
    { reason: 'open-request', label: 'Open request', cards: [cards[0], cards[2]] },
    { reason: 'answer-possibly-unseen', label: 'Answer possibly unseen', cards: [cards[1]] },
  ]);
  assert.deepEqual(groupAttentionCards([]), []);
});
