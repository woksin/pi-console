import { attentionSections, wrap, type AttentionCard, type NewSince } from '@pi-console/viewmodels';
import type { Line } from '../view/renderer.ts';
import { heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import type { Env } from './common.ts';

const CARD_HEIGHT = 3;
interface Section { label: string; count: number; cards: AttentionCard[] }
interface Page { start: number; end: number; sections: Section[] }
interface Marks { selected: boolean; isNew: boolean; flash: boolean }
interface Input {
  cards: AttentionCard[]; cursor: number; width: number; height: number;
  fresh: NewSince; flashing: (id: string) => boolean; env: Env;
}

function pageOf(cards: AttentionCard[], cursor: number, size: number): Page {
  const { start, end } = windowOf(cards.length, cursor, size);
  const visible = new Set(cards.slice(start, end));
  const sections = attentionSections(cards).map(section => ({
    label: section.label, count: section.cards.length, cards: section.cards.filter(card => visible.has(card)),
  })).filter(section => section.cards.length > 0);
  return { start, end, sections };
}

/** Reserve one counted heading per visible reason, without losing the selected card or its text. */
function visiblePage(cards: AttentionCard[], cursor: number, height: number): Page {
  for (let size = Math.max(1, Math.floor(height / CARD_HEIGHT)); size > 1; size--) {
    const page = pageOf(cards, cursor, size);
    if ((page.end - page.start) * CARD_HEIGHT + page.sections.length <= height) return page;
  }
  return pageOf(cards, cursor, 1);
}

function cardLines(card: AttentionCard, width: number, marks: Marks, env: Env): Line[] {
  const head: Line = split(
    [...statusParts(card.status, env.phase, false), t(' '), t(card.reasonLabel, card.status.color, { bold: true }), t('  '), t(card.title, 'text'), ...(marks.isNew ? [t(' new', 'cyan', { bold: true })] : [])],
    [t(card.age, 'faint')], width - 1, { measure: env.measure });
  const text = wrap(card.text, width - 3, 1, env.measure)[0] ?? '';
  return [selectable(head, width, marks.selected, { flash: marks.flash, measure: env.measure }), selectable([t('  '), t(text, 'muted')], width, marks.selected, { flash: marks.flash, measure: env.measure }), [t('')]];
}

export function attentionPage(input: Input): { end: number; lines: Line[]; indices: (number | null)[] } {
  const page = visiblePage(input.cards, input.cursor, input.height);
  const rows = page.sections.flatMap(section => [
    { line: heading(`${section.label} (${String(section.count)})`), index: null },
    ...section.cards.flatMap(card => {
      const index = input.cards.indexOf(card);
      const marks = { selected: index === input.cursor, isNew: input.fresh.ids.has(card.id), flash: input.flashing(card.id) };
      return cardLines(card, input.width, marks, input.env).map(line => ({ line, index }));
    }),
  ]);
  return { end: page.end, lines: rows.map(row => row.line), indices: rows.map(row => row.index) };
}
