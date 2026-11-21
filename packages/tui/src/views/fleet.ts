import { fleetViewModel, pad, padStart, type FleetRow, type SessionRow } from '@pi-console/viewmodels';
import { Lines, Panel, Row, h, type Line } from '../view/renderer.ts';
import { pressureBar, blank, heading, pressureTone, selectable, statusParts, t, windowOf } from '../view/parts.ts';
import type { Env, SectionView } from './common.ts';
import { listFilter } from '../state/ui.ts';

function groupLine(row: Extract<FleetRow, { kind: 'group' }>, width: number, selected: boolean) {
  const attention = row.attention > 0 ? [t(`  ${String(row.attention)} need attention`, 'amber')] : [];
  return selectable([t(row.collapsed ? '▸ ' : '▾ ', 'cyan'), t(row.label, 'text', { bold: true }), t(`  ${String(row.sessions)}`, 'faint'), ...attention], width, selected);
}

function sessionLine(row: SessionRow, width: number, selected: boolean, env: Env, fresh: boolean) {
  const showSpark = width >= 96;
  const fixed = 15 + 1 + 10 + 1 + 4 + 1 + (showSpark ? 13 : 0) + 6 + 7;
  const name = Math.max(10, width - fixed - 4 - row.depth * 2);
  const status = statusParts(row.status, env.phase, false);
  return selectable([
    t('  ' + '  '.repeat(row.depth) + (row.depth > 0 ? '└ ' : '')), ...status, t(' '), t(pad(row.status.label, 10), row.status.color), t(' '),
    t(pad(row.name, name), row.role === 'subagent' ? 'muted' : 'text'), t(' '),
    ...pressureBar(row.contextPercent, 10), t(padStart(`${String(row.contextPercent)}%`, 5), pressureTone(row.pressure)),
    ...(showSpark ? [t(' '), t(row.spark.padEnd(12), 'faint')] : []),
    t(padStart(row.age, 5), 'muted'), t(padStart(row.cost, 7), 'faint'),
  ], width, selected, fresh);
}

function preview(row: SessionRow | undefined, width: number): ReturnType<typeof h> {
  const lines: Line[] = row ? [
    [t(row.name, 'text', { bold: true })], [...statusParts(row.status, 0, true)], blank,
    heading('Lane'), [t(row.lane, 'text')], heading('Branch'), [t(row.branch, 'muted')], heading('Model'), [t(row.model, 'muted')], blank,
    heading('Context'), [...pressureBar(row.contextPercent, 20), t(` ${String(row.contextPercent)}%`, pressureTone(row.pressure))], [t(row.spark, 'cyan')], blank,
    [t('cost ', 'muted'), t(row.cost, 'text'), t('   updated ', 'muted'), t(`${row.age} ago`, 'text')], blank, [t('⏎ ', 'cyan'), t('open transcript', 'muted')],
  ] : [[t('Select a session', 'faint')]];
  return h(Panel, { title: 'Selected', width }, h(Lines, { lines }));
}

export function fleetView(env: Env): SectionView {
  const model = fleetViewModel({ sessions: env.data.sessions, now: env.now, query: listFilter(env.ui), collapsed: new Set(env.ui.collapsed) });
  const rows = model.rows;
  const wide = env.width >= 110;
  const width = (wide ? env.width - 40 : env.width) - 4;
  const cursor = Math.min(env.ui.cursor.fleet, Math.max(0, rows.length - 1));
  const visible = Math.max(1, env.height - 4);
  const { start, end } = windowOf(rows.length, cursor, visible);
  const lines: Line[] = rows.length === 0
    ? [blank, [t('  No session matches ', 'muted'), t(`“${model.query}”`, 'amber'), t('. Esc clears the filter.', 'muted')]]
    : rows.slice(start, end).map((row, offset) => {
      const selected = start + offset === cursor;
      return row.kind === 'group' ? groupLine(row, width, selected) : sessionLine(row, width, selected, env, env.data.fresh.has(row.id));
    });
  const selected = rows[cursor];
  const title = model.query ? `Fleet · filter “${model.query}” · ${String(model.matched)} of ${String(model.sessionCount)}` : `Fleet · ${String(model.sessionCount)} sessions`;
  return {
    length: rows.length,
    rowAt: index => { const row = rows[index]; return row ? (row.kind === 'group' ? { sessionId: null, groupId: row.id } : { sessionId: row.id, groupId: null }) : { sessionId: null, groupId: null }; },
    idAt: index => rows[index]?.id ?? null,
    render: () => h(Row, { grow: 1, gap: 1 },
      h(Panel, { title, focused: true, grow: 1, right: rows.length > end ? `↓ ${String(rows.length - end)} more` : '' },
        h(Lines, { lines, grow: 1, onLineClick: index => { env.click(start + index); } })),
      ...(wide ? [preview(selected?.kind === 'session' ? selected : undefined, 39)] : [])),
  };
}
