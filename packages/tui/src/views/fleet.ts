import { emptyStates, fleetColumns, fleetRowAt, fleetStructure, lastInput, clip, pad, padStart, type FleetEntry, type FleetRow, type SessionRow, type TextWidth } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { pressureBar, blank, fit, heading, pressureTone, selectable, statusParts, t, windowOf } from '../view/parts.ts';
import { checklistLines, emptyLines, loadingLines, noMatchLines, type Env, type SectionView } from './common.ts';
import { listFilter } from '../state/ui.ts';

function groupLine(row: Extract<FleetRow, { kind: 'group' }>, width: number, selected: boolean, measure?: TextWidth) {
  const attention = row.attention > 0 ? [t(`  ${String(row.attention)} need attention`, 'amber')] : [];
  return selectable([t(row.collapsed ? '▸ ' : '▾ ', 'cyan'), t(row.label, 'text', { bold: true }), t(`  ${String(row.sessions)}`, 'faint'), ...attention], width, selected, { measure });
}

const columns = (width: number) => {
  const spark = width >= 96;
  const details = width >= 55;
  const context = Math.min(15, Math.max(5, width - 27));
  return { width, spark, details, context, name: Math.max(10, width - 3 - 1 - 13 - context - (spark ? 13 : 0) - (details ? 13 : 0)) };
};
type Columns = ReturnType<typeof columns>;

function columnHeadings(layout: Columns): Line {
  const widths = { name: layout.name + 1, status: 13, context: layout.context, trend: layout.spark ? 13 : 0, cost: layout.details ? 7 : 0, age: layout.details ? 6 : 0 };
  const cells = fleetColumns.filter(column => widths[column.id] > 0).map(column =>
    t(column.id === 'cost' || column.id === 'age' ? padStart(column.label, widths[column.id]) : pad(column.label, widths[column.id]), 'muted'));
  return fit([t('   '), ...cells], layout.width);
}

function sessionName(row: SessionRow, width: number, measure?: TextWidth): Line {
  const indent = row.depth > 0 ? `${'  '.repeat(row.depth)}└ ` : '';
  return [t(pad(indent + row.name, width, measure), row.role === 'subagent' ? 'muted' : 'text')];
}

const compactCost = (cost: string): string => cost.replace(/^(.*) \(known\)$/, '≥$1');

function sessionLine(row: SessionRow, layout: Columns, env: Env, selected: boolean) {
  return selectable([
    t('  '), ...sessionName(row, layout.name, env.measure), t(' '),
    ...statusParts(row.status, env.phase, false), t(' '), t(pad(row.status.label, 10), row.status.color), t(' '),
    ...pressureBar(row.contextPercent, layout.context - 5), t(padStart(`${String(row.contextPercent)}%`, 5), pressureTone(row.pressure)),
    ...(layout.spark ? [t(' '), t(row.spark.padEnd(12), 'faint')] : []),
    ...(layout.details ? [t(padStart(clip(compactCost(row.cost), 7, env.measure), 7, env.measure), 'faint'), t(padStart(row.age, 6), 'muted')] : []),
  ], layout.width, selected, { flash: env.data.fresh.has(row.id), measure: env.measure });
}

function preview(row: FleetRow | undefined, sessions: number): ReturnType<typeof h> {
  const lines: Line[] = row?.kind === 'session' ? [
    [t(row.name, 'text', { bold: true })], [...statusParts(row.status, 0, true)], blank,
    ...metadataLines(row), heading('Model'), [t(row.model, 'muted')], blank,
    heading('Context'), [...pressureBar(row.contextPercent, 20), t(` ${String(row.contextPercent)}%`, pressureTone(row.pressure))], [t(row.spark, 'cyan')], blank,
    [t('cost ', 'muted'), t(row.cost, 'text'), t('   updated ', 'muted'), t(`${row.age} ago`, 'text')], blank, [t('⏎ ', 'cyan'), t('open transcript', 'muted')],
  ] : groupSummary(row, sessions);
  return h(Panel, { title: 'Selected', width: 39 }, h(Lines, { lines }));
}

function metadataLines(row: SessionRow): Line[] {
  return [
    ...(row.lane ? [heading('Lane'), [t(row.lane, 'text')]] : []),
    ...(row.branch ? [heading('Branch'), [t(row.branch, 'muted')]] : []),
  ];
}

function groupSummary(row: Exclude<FleetRow, SessionRow> | undefined, sessions: number): Line[] {
  if (!row) return [heading('Fleet'), [t(`${String(sessions)} sessions`, 'muted')], blank, [t('Select a repository or session.', 'faint')]];
  return [[t(row.label, 'text', { bold: true })], blank, [t(`${String(row.sessions)} sessions`, 'text')],
    [t(`${String(row.attention)} need attention`, row.attention > 0 ? 'amber' : 'muted')], blank,
    [t(row.collapsed ? 'Space expands the repository.' : 'Space collapses the repository.', 'muted')]];
}

function fleetLines(rows: FleetRow[], env: Env, window: { layout: Columns; cursor: number; start: number }): Line[] {
  const { layout, cursor, start } = window;
  return rows.map((row, offset) => row.kind === 'group'
    ? groupLine(row, layout.width, start + offset === cursor, env.measure)
    : sessionLine(row, layout, env, start + offset === cursor));
}

function rowLocation(row: FleetEntry | undefined) {
  if (!row) return { sessionId: null, groupId: null };
  return row.kind === 'group' ? { sessionId: null, groupId: row.id } : { sessionId: row.id, groupId: null };
}

function hiddenColumnsHint(layout: Columns) {
  if (layout.details) return [];
  return [h(Lines, { lines: [fit([t('+cost age hidden — widen terminal', 'faint')], layout.width)] })];
}

const noRows = (query: string, env: Env, width: number): Line[] => query
  ? noMatchLines('session', query)
  : [...emptyLines(emptyStates.fleet, width), ...checklistLines({ connected: env.data.connection.connected, sessions: 0 }, width)];

/** The clock-free layout for the last sessions/filter/collapsed inputs; a clock tick or cursor move reuses it. */
const structureFor = lastInput((sessions: Env['data']['sessions'], query: string, collapsed: readonly string[]) => fleetStructure({ sessions, query, collapsed: new Set(collapsed) }));

const fleetTitle = (model: ReturnType<typeof structureFor>): string => model.query
  ? `Fleet · filter “${model.query}” · ${String(model.matched)} of ${String(model.sessionCount)}`
  : `Fleet · ${String(model.sessionCount)} sessions`;

export function fleetView(env: Env): SectionView {
  const model = structureFor(env.data.sessions, listFilter(env.ui), env.ui.collapsed);
  const rows = model.entries;
  const wide = env.width >= 140;
  const layout = columns((wide ? env.width - 40 : env.width) - 4);
  const cursor = Math.min(env.ui.cursor.fleet, Math.max(0, rows.length - 1));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, env.height - 5 - Number(!layout.details)));
  const lines = !env.data.loaded ? loadingLines() : rows.length ? fleetLines(rows.slice(start, end).map(entry => fleetRowAt(entry, env.now)), env, { layout, cursor, start }) : noRows(model.query, env, layout.width);
  const current = rows.at(cursor);
  const selected = current && fleetRowAt(current, env.now);
  return {
    length: rows.length,
    rowAt: index => rowLocation(rows[index]),
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title: fleetTitle(model), focused: true, grow: 1, right: rows.length > end ? `↓ ${String(rows.length - end)} more` : '' },
        h(Lines, { lines: [columnHeadings(layout)] }),
        h(Lines, { lines, grow: 1, onLineClick: index => { env.click(start + index); } }),
        ...hiddenColumnsHint(layout)),
      ...(wide ? [preview(selected, model.sessionCount)] : [])),
  };
}
