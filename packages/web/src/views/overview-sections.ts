/** Presentation-only grouping; keep first-seen reason order and daemon order within each reason. */
export function groupAttentionCards<T extends { reason: string; reasonLabel: string }>(cards: readonly T[]): { reason: string; label: string; cards: T[] }[] {
  const groups = new Map<string, { reason: string; label: string; cards: T[] }>();
  for (const card of cards) {
    const group = groups.get(card.reason);
    if (group) group.cards.push(card);
    else groups.set(card.reason, { reason: card.reason, label: card.reasonLabel, cards: [card] });
  }
  return [...groups.values()];
}
