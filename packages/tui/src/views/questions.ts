import { emptyStates, filterQuestionRows, questionsViewModel, wrap, pad, type QuestionRow } from '@pi-console/viewmodels';
import { questionDetailShown } from '../state/ui.ts';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, listBody, shownOf, type Env, type SectionView } from './common.ts';

function optionLines(options: string[], width: number, full: boolean): Line[] {
  return options.flatMap((option, index) => (full ? wrap(option, Math.max(1, width - 8)) : [option]).map((text, line): Line => [t(line === 0 ? `  ${String(index + 1)} ` : '    ', 'cyan'), t(text, 'text')]));
}

function detail(row: QuestionRow | undefined, width: number, full = false): Line[] {
  if (!row) return [[t('Select a question', 'faint')]];
  return [
    [...statusParts(row.status, 0, true), t(`  ${row.age} ago`, 'faint')],
    [t(row.kind, 'violet', { bold: true }), ...(row.urgent ? [t('  urgent', 'red', { bold: true })] : []), ...(row.blocking ? [t('  blocking', 'amber', { bold: true })] : [])], blank,
    ...wrap(row.text, width - 4, full ? Infinity : 8).map((text): Line => [t(text, 'text')]), blank,
    ...(row.options.length ? [heading('Options'), ...optionLines(row.options, width, full)] : []), blank,
    [t('Read-only in this version: answer in the session itself.', 'faint', { italic: true })],
  ];
}

function fullDetail(row: QuestionRow | undefined, env: Env) {
  const lines = detail(row, env.width, true);
  const page = Math.max(1, env.height - 2), max = Math.max(0, lines.length - page);
  const start = Math.min(env.ui.detailScroll, max);
  return { bounds: { max, page }, render: () => h(Panel, { title: 'Question', right: `↑↓ scroll · PgUp/PgDn · enter session · esc back · ${String(start + 1)}–${String(Math.min(lines.length, start + page))} of ${String(lines.length)}`, focused: true, grow: 1 }, h(Lines, { lines: lines.slice(start, start + page), grow: 1 })) };
}

export function questionsView(env: Env): SectionView {
  const model = questionsViewModel({ questions: env.data.questions, sessions: env.data.sessions, now: env.now });
  const rows = filterQuestionRows(model.rows, env.ui.filter);
  const wide = env.width >= 110;
  const width = (wide ? env.width - 48 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.questions, Math.max(0, rows.length - 1));
  const full = fullDetail(rows[cursor], env);
  const viewport = wide && !questionDetailShown(env.ui) ? undefined : full.bounds;
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset): Line => selectable(split(
    [...statusParts(row.status, env.phase, false), t(row.urgent ? ' ‼ ' : '   ', 'red'), t(row.text, row.status.status === 'done' ? 'muted' : 'text')],
    [t(pad(row.session, 22), 'muted'), t(row.age.padStart(4), 'faint')], width - 1), width, start + offset === cursor));
  return {
    length: rows.length,
    detail: viewport,
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: questionDetailShown(env.ui) ? full.render : () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Questions · ${String(model.open)} open · ${String(model.blocking)} blocking${shownOf(env.data, 'questions', rows.length)}`, focused: true, grow: 1 }, h(Lines, { lines: listBody({ loaded: env.data.loaded, lines, query: env.ui.filter, noun: 'question', anyRows: model.rows.length > 0, empty: () => emptyLines(emptyStates.questions, env.width - 4) }), grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [h(Panel, { title: 'Question · v expand', width: 48 }, h(Lines, { lines: detail(rows[cursor], 48) }))] : [])),
  };
}
