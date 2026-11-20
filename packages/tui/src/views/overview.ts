import { overviewViewModel, wrap, type AttentionCard, type OverviewViewModel } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { bar, blank, fit, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import type { Env, SectionView } from './common.ts';

const CARD_HEIGHT = 3;

function cardLines(card: AttentionCard, width: number, selected: boolean, env: Env): Line[] {
  const head: Line = split(
    [...statusParts(card.status, env.phase, false), t(' '), t(card.reasonLabel, card.status.color, { bold: true }), t('  '), t(card.title, 'text')],
    [t(card.age, 'faint')], width - 1);
  const text = wrap(card.text, width - 3, 1)[0] ?? '';
  return [selectable(head, width, selected), selectable([t('  '), t(text, 'muted')], width, selected), [t('')]];
}

function attentionPanel(model: OverviewViewModel, env: Env, width: number, height: number): ReturnType<typeof h> {
  const inner = width - 4;
  const visible = Math.max(1, Math.floor((height - 4) / CARD_HEIGHT));
  const cursor = env.ui.cursor.overview;
  const { start, end } = windowOf(model.cards.length, cursor, visible);
  const lines: Line[] = model.cards.length === 0
    ? [blank, [t('  ✓ ', 'green', { bold: true }), t('Nothing is waiting on you.', 'text')], [t('    Sessions are working, idle or done.', 'muted')]]
    : model.cards.slice(start, end).flatMap((card, offset) => cardLines(card, inner, start + offset === cursor, env));
  const more = model.cards.length > end ? `↓ ${String(model.cards.length - end)} more` : model.cards.length > 0 ? `${String(cursor + 1)}/${String(model.cards.length)}` : '';
  return h(Panel, { title: model.headline, right: more, focused: true, accent: model.cards.length > 0 ? 'amber' : 'green', grow: 1 },
    h(Lines, { lines, grow: 1, onLineClick: index => { env.click(start + Math.floor(index / CARD_HEIGHT)); } }));
}

function fleetPanel(model: OverviewViewModel, width: number): ReturnType<typeof h> {
  const inner = width - 4;
  const peak = Math.max(1, ...model.counts.map(entry => entry.count));
  const lines: Line[] = [
    [t(String(model.fleet.sessions), 'text', { bold: true }), t(` sessions in ${String(model.fleet.repositories)} repositories`, 'muted')],
    [t(String(model.fleet.working), 'cyan', { bold: true }), t(' working right now', 'muted')],
    blank, heading('Status'),
    ...model.counts.map(entry => fit([
      ...statusParts(entry.status, 0, false), t(` ${entry.status.label.padEnd(10)}`, entry.count ? 'text' : 'faint'), t(String(entry.count).padStart(3), entry.count ? 'text' : 'faint'), t(' '),
      ...bar(entry.count / peak * 100, Math.max(4, inner - 19), entry.count ? entry.status.color : 'border'),
    ], inner)),
    blank, heading('Context, fleet average'),
    [t(model.fleet.contextSpark, 'cyan')],
    blank,
    [t('tokens ', 'muted'), t(model.fleet.tokens, 'text'), t('   cost ', 'muted'), t(model.fleet.cost, 'text')],
  ];
  return h(Panel, { title: 'Fleet', width }, h(Lines, { lines }));
}

export function overviewView(env: Env): SectionView {
  const model = overviewViewModel({ needsYou: env.data.needsYou, sessions: env.data.sessions, repositories: env.data.repositories, now: env.now });
  const wide = env.width >= 100;
  return {
    length: model.cards.length,
    rowAt: index => ({ sessionId: model.cards[index]?.sessionId ?? null, groupId: null }),
    idAt: index => model.cards[index]?.sessionId ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      attentionPanel(model, env, wide ? env.width - 38 : env.width, env.height),
      ...(wide ? [fleetPanel(model, 37)] : [])),
  };
}
