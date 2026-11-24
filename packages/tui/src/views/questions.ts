import { fitSessionLabel, emptyStates, filterQuestionRows, questionSortLabels, questionsViewModel, wrap, pad, type QuestionRow, type TextWidth } from '@pi-console/viewmodels';
import { questionDetailShown } from '../state/ui.ts';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { blank, heading, selectable, split, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, listBody, shownOf, type Env, type SectionView } from './common.ts';

function optionLines(options: string[], width: number, full: boolean, measure?: TextWidth): Line[] {
  return options.flatMap((option, index) => (full ? wrap(option, Math.max(1, width - 8), Infinity, measure) : [option]).map((text, line): Line => [t(line === 0 ? `  ${String(index + 1)} ` : '    ', 'cyan'), t(text, 'text')]));
}

const entryMeta = (entry: NonNullable<QuestionRow['history']>[number]): string => `${entry.time} ${entry.operation} by ${entry.actor} · ${entry.age} ago`;

function historyLines(row: QuestionRow, width: number, measure?: TextWidth): Line[] {
  if (!row.history) return [heading('History'), [t('History unavailable: this question predates recorded history.', 'faint', { italic: true })]];
  if (row.history.length === 0) return [heading(`History (0)`), [t('No history recorded.', 'faint')]];
  return [heading(`History (${String(row.history.length)}, newest first)`), ...row.history.flatMap((entry): Line[] => [
    ...wrap(entryMeta(entry), Math.max(1, width - 4), Infinity, measure).map((text): Line => [t(text, 'muted')]),
    ...(entry.withheld ? [[t('    note withheld', 'faint', { italic: true })] satisfies Line] : []),
    ...(entry.excerpt ? wrap(entry.excerpt, Math.max(1, width - 8), Infinity, measure).map((text): Line => [t('    ', 'text'), t(text, 'text')]) : []),
  ])];
}

/** Updated time, last activity and the text-labelled inactivity warning; kept in the preview so a long history cannot push them away. */
function activityLines(row: QuestionRow, width: number, measure?: TextWidth): Line[] {
  const text = `Updated ${row.updated === '–' ? 'unknown' : `${row.updated} ago`} · last activity ${row.lastActivity}`;
  return [
    ...wrap(text, Math.max(1, width - 4), Infinity, measure).map((part): Line => [t(part, 'faint')]),
    ...(row.stale ? [[t(row.stale, 'amber', { bold: true })] satisfies Line] : []),
  ];
}
function linkLines(row: QuestionRow): Line[] {
  return row.links.length ? [heading('Links'), ...row.links.map((link): Line => [t(`  ${link}`, 'muted')])] : [];
}

function mootLines(row: QuestionRow, width: number, full: boolean, measure?: TextWidth): Line[] {
  if (!row.moot) return [];
  const wrapped = (text: string, indent: number): Line[] => wrap(text, Math.max(1, width - indent), Infinity, measure).map((part): Line => [t(`${' '.repeat(indent - 2)}${part}`, 'muted')]);
  return [
    ...(row.moot.label ? [[t(row.moot.label, 'amber', { bold: true })] satisfies Line] : []),
    ...(full ? [heading('GitHub evidence'), ...wrapped(row.moot.explanation, 6), ...row.moot.evidence.flatMap(item => wrapped(item.text, 6))] : [[t(`GitHub evidence (${String(row.moot.evidence.length)}) · v expand`, 'faint')] satisfies Line]),
  ];
}

const historySummary = (row: QuestionRow): Line => [t(row.history ? `History (${String(row.history.length)}) · v expand` : 'History unavailable', 'faint')];

function detail(row: QuestionRow | undefined, width: number, full = false, measure?: TextWidth): Line[] {
  if (!row) return [[t('Select a question', 'faint')]];
  return [
    [...statusParts(row.status, 0, true), t(`  ${row.age} ago`, 'faint')], ...activityLines(row, width, measure),
    [t(row.kind, 'violet', { bold: true }), ...(row.urgent ? [t('  urgent', 'red', { bold: true })] : []), ...(row.blocking ? [t('  blocking', 'amber', { bold: true })] : [])], blank,
    ...wrap(row.text, width - 4, full ? Infinity : 8, measure).map((text): Line => [t(text, 'text')]), blank,
    ...(row.options.length ? [heading('Options'), ...optionLines(row.options, width, full, measure)] : []), blank,
    ...linkLines(row), ...mootLines(row, width, full, measure), ...(full ? [...historyLines(row, width, measure), blank] : [historySummary(row)]),
    [t('Read-only here · answer in the session', 'faint', { italic: true })],
  ];
}

function fullDetail(row: QuestionRow | undefined, env: Env) {
  const lines = detail(row, env.width, true, env.measure);
  const page = Math.max(1, env.height - 2), max = Math.max(0, lines.length - page);
  const start = Math.min(env.ui.detailScroll, max);
  return { bounds: { max, page }, render: () => h(Panel, { title: 'Question', right: `↑↓ scroll · PgUp/PgDn · enter session · esc back · ${String(start + 1)}–${String(Math.min(lines.length, start + page))} of ${String(lines.length)}`, focused: true, grow: 1 }, h(Lines, { lines: lines.slice(start, start + page), grow: 1 })) };
}

const preferenceTitle = (env: Env): string => ` · ${questionSortLabels[env.ui.questionSort].toLowerCase()} · stale ${String(env.ui.questionStaleDays)}d`;

function rowLine(row: QuestionRow, env: Env, width: number, selected: boolean): Line {
  const left = [...statusParts(row.status, env.phase, false), t(row.urgent ? ' ‼ ' : '   ', 'red'), ...(row.moot?.label ? [t(`${row.moot.label} · `, 'amber', { bold: true })] : []), t(row.text, row.status.status === 'done' ? 'muted' : 'text')];
  const right = [t(row.stale ? 'stale ' : '', 'amber'), t(pad(fitSessionLabel(row.session, 22, env.measure), 22, env.measure), 'muted'), t(row.age.padStart(4), 'faint')];
  return selectable(split(left, right, width - 1, { measure: env.measure }), width, selected, { measure: env.measure });
}

export function questionsView(env: Env): SectionView {
  const model = questionsViewModel({ questions: env.data.questions, sessions: env.data.sessions, now: env.now, sort: env.ui.questionSort, staleDays: env.ui.questionStaleDays });
  const rows = filterQuestionRows(model.rows, env.ui.filter);
  const wide = env.width >= 110;
  const width = (wide ? env.width - 49 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.questions, Math.max(0, rows.length - 1));
  const full = fullDetail(rows[cursor], env);
  const viewport = wide && !questionDetailShown(env.ui) ? undefined : full.bounds;
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 4));
  const lines = rows.slice(start, end).map((row, offset) => rowLine(row, env, width, start + offset === cursor));
  return {
    length: rows.length,
    detail: viewport,
    rowAt: index => ({ sessionId: rows[index]?.sessionId ?? null, groupId: null }),
    idAt: index => rows[index]?.id ?? null,
    render: questionDetailShown(env.ui) ? full.render : () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: `Questions · ${String(model.open)} open · ${String(model.blocking)} blocking${preferenceTitle(env)}${shownOf(env.data, 'questions', rows.length)}`, focused: true, grow: 1 }, h(Lines, { lines: listBody({ loaded: env.data.loaded, lines, query: env.ui.filter, noun: 'question', anyRows: model.rows.length > 0, empty: () => emptyLines(emptyStates.questions, env.width - 4) }), grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [h(Panel, { title: 'Question · v expand', width: 48 }, h(Lines, { lines: detail(rows[cursor], 48, false, env.measure) }))] : [])),
  };
}
