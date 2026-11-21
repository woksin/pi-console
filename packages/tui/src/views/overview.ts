import { newSince, overviewEmpty, overviewViewModel, pressureHistogram, wrap, type AttentionCard, type NewSince, type OverviewViewModel, type PressureHistogram } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { bar, blank, fit, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { checklistLines, emptyLines, type Env, type SectionView } from './common.ts';

const CARD_HEIGHT = 3;

interface CardMarks { selected: boolean; isNew: boolean; flash: boolean }

function cardLines(card: AttentionCard, width: number, marks: CardMarks, env: Env): Line[] {
  const head: Line = split(
    [...statusParts(card.status, env.phase, false), t(' '), t(card.reasonLabel, card.status.color, { bold: true }), t('  '), t(card.title, 'text'), ...(marks.isNew ? [t(' new', 'cyan', { bold: true })] : [])],
    [t(card.age, 'faint')], width - 1);
  const text = wrap(card.text, width - 3, 1)[0] ?? '';
  return [selectable(head, width, marks.selected, marks.flash), selectable([t('  '), t(text, 'muted')], width, marks.selected, marks.flash), [t('')]];
}

/**
 * What changed since the user last looked: new cards and status flashes (only with motion on). Nothing before both the
 * snapshot and the attention list have loaded, so the first look's baseline is the real list rather than an empty one.
 */
function changesOf(model: OverviewViewModel, env: Env): { fresh: NewSince; flashing: (id: string) => boolean } {
  const changes = env.changes;
  if (!changes || !env.data.loaded || !env.data.needsYouLoaded) return { fresh: newSince(null, []), flashing: () => false };
  const fresh = changes.look.look(model.cards.map(card => card.id));
  changes.flash.observe(model.cards.map(card => ({ id: card.id, status: card.status.status })), env.now);
  return { fresh, flashing: id => changes.motion && changes.flash.isFlashing(id, env.now) };
}

/** The "N new since you looked" divider, cyan like the web one. */
const newSinceLine = (label: string, width: number): Line => [t('── ', 'cyan'), t(label, 'cyan', { bold: true }), t(` ${'─'.repeat(Math.max(0, width - label.length - 4))}`, 'cyan')];

function attentionPanel(model: OverviewViewModel, env: Env, width: number, height: number): ReturnType<typeof h> {
  const inner = width - 4;
  const { fresh, flashing } = changesOf(model, env);
  const divider: Line[] = fresh.label ? [newSinceLine(fresh.label, inner)] : [];
  const visible = Math.max(1, Math.floor((height - 4 - divider.length) / CARD_HEIGHT));
  const cursor = env.ui.cursor.overview;
  const { start, end } = windowOf(model.cards.length, cursor, visible);
  const lines: Line[] = model.cards.length === 0
    ? (env.data.sessions.length === 0
      ? checklistLines({ connected: env.data.connection.connected, sessions: 0 }, inner)
      : emptyLines(overviewEmpty(model.fleet.working), inner))
    : [...divider, ...model.cards.slice(start, end).flatMap((card, offset) =>
      cardLines(card, inner, { selected: start + offset === cursor, isNew: fresh.ids.has(card.id), flash: flashing(card.id) }, env))];
  const more = model.cards.length > end ? `↓ ${String(model.cards.length - end)} more` : model.cards.length > 0 ? `${String(cursor + 1)}/${String(model.cards.length)}` : '';
  return h(Panel, { title: model.headline, right: more, focused: true, accent: model.cards.length > 0 ? 'amber' : 'green', grow: 1 },
    h(Lines, { lines, grow: 1, onLineClick: index => { if (index >= divider.length) env.click(start + Math.floor((index - divider.length) / CARD_HEIGHT)); } }));
}

const eighths = ' ▁▂▃▄▅▆▇█';
const BAR_ROWS = 3;

/** One histogram bar row: two cells per bin and a gap that carries the 60/80 % tick, so a tick sits on the bin edge as on the web. */
function barRow(histogram: PressureHistogram, row: number): Line {
  const last = histogram.bins.length - 1;
  const floor = (BAR_ROWS - 1 - row) * 8;
  return histogram.bins.flatMap((bin, index) => {
    const level = bin.count === 0 ? 0 : Math.max(1, Math.round(bin.count / histogram.peak * BAR_ROWS * 8));
    const fill = Math.max(0, Math.min(8, level - floor));
    const tick = histogram.ticks.includes(histogram.bins[index + 1]?.from ?? -1);
    return [t(eighths[fill].repeat(2), `pressure:${index / last * 100}`), t(tick ? '┊' : ' ', 'muted')];
  });
}

/** The fleet's context pressure: sessions per 10 % bin, coloured by the shared ramp, with the 60 and 80 % ticks and counts in words. */
export function pressureLines(histogram: PressureHistogram): Line[] {
  const axis = histogram.bins.map((bin, index) => (histogram.ticks.includes(histogram.bins[index + 1]?.from ?? -1) ? '──┼' : '───')).join('');
  return [
    ...Array.from({ length: BAR_ROWS }, (_, row) => barRow(histogram, row)),
    [t(axis, 'border')],
    [t('0', 'faint'), t(' '.repeat(15)), t('60', 'faint'), t(' '.repeat(4)), t('80', 'faint'), t(' '.repeat(3)), t('100', 'faint')],
    [t(String(histogram.hot), 'red', { bold: true }), t(' above 80 %  ', 'muted'), t(String(histogram.warm), 'amber', { bold: true }), t(' at 60–80 %', 'muted')],
  ];
}

function fleetPanel(model: OverviewViewModel, histogram: PressureHistogram, width: number, height: number): ReturnType<typeof h> {
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
  const pressure = [blank, heading('Context pressure'), ...pressureLines(histogram)];
  if (lines.length + pressure.length <= height - 2) lines.push(...pressure);
  return h(Panel, { title: 'Fleet', width }, h(Lines, { lines }));
}

export function overviewView(env: Env): SectionView {
  const model = overviewViewModel({ needsYou: env.data.needsYou, sessions: env.data.sessions, repositories: env.data.repositories, now: env.now });
  const wide = env.width >= 100 && model.fleet.sessions > 0;
  return {
    length: model.cards.length,
    rowAt: index => ({ sessionId: model.cards[index]?.sessionId ?? null, groupId: null }),
    idAt: index => model.cards[index]?.sessionId ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      attentionPanel(model, env, wide ? env.width - 38 : env.width, env.height),
      ...(wide ? [fleetPanel(model, pressureHistogram(env.data.sessions), 37, env.height)] : [])),
  };
}
