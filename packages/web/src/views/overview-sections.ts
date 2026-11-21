import { attentionSections } from '@pi-console/viewmodels';

/** Adjacent-only shared grouping keeps the daemon's ranking and keyboard order authoritative. */
export function groupAttentionCards<T extends { reason: string; reasonLabel: string }>(cards: readonly T[]): { reason: string; label: string; cards: T[] }[] {
  return attentionSections(cards).map(section => ({ ...section, reason: section.cards[0].reason }));
}
