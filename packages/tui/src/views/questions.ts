import { emptyStates, questionsViewModel, wrap, pad, type QuestionRow } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, shownOf, type Env, type SectionView } from './common.ts';

function detail(row: QuestionRow | undefined, width: number): Line[] {
  if (!row) return [[t('Select a question', 'faint')]];
  return [
    [...statusParts(row.status, 0, true), t(`  ${row.age} ago`, 'faint')],
    [t(row.kind, 'violet', { bold: true }), ...(row.urgent ? [t('  urgent', 'red', { bold: true })] : []), ...(row.blocking ? [t('  blocking', 'amber', { bold: true })] : [])], blank,
    ...wrap(row.text, width - 4, 8).map((text): Line => [t(text, 'text')]), blank,
    ...(row.options.length ? [heading('Options'), ...row.options.map((option, index): Line => [t(`  ${String(index + 1)} `, 'cyan'), t(option, 'text')])] : []), blank,
    [t('Answering from the console arrives in M4.', 'faint', { italic: true })],
  ];
}

export function questionsView(env: Env): SectionView {
  const model = questionsViewModel({ questions: env.data.questions, sessions: env.data.sessions, now: env.now });
  const rows = model.rows.filter(row => !env.ui.filter || `${row.text} ${row.session}`.toLowerCase().includes(env.ui.filter.toLowerCase()));
  const wide = env.width >= 110;
  const width = (wide ? env.width - 48 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.questions, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [...statusParts(row.status, env.phase, false), t(row.urgent ? ' ‼ ' : '   ', 'red'), t(row.text, row.status.status === 'done' ? 'muted' : 'text')],
    [t(pad(row.session, 22), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor));
  return {
    length: rows.length,
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Questions · ${String(model.open)} open · ${String(model.blocking)} blocking${shownOf(env.data, 'questions', rows.length)}`, focused: true, grow: 1 }, h(Lines, { lines: lines.length ? lines : emptyLines(emptyStates.questions, env.width - 4), grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [h(Panel, { title: 'Question', width: 48 }, h(Lines, { lines: detail(rows[cursor], 48) }))] : [])),
  };
}
