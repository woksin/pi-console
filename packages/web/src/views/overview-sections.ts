import { attentionSections } from '@pi-console/viewmodels';

/** Shared reason priority keeps section and keyboard order aligned with the viewmodel. */
export function groupAttentionCards<T extends { reason: string; reasonLabel: string }>(cards: readonly T[]): { reason: string; label: string; cards: T[] }[] {
  return attentionSections(cards).map(section => ({ ...section, reason: section.cards[0].reason }));
}
