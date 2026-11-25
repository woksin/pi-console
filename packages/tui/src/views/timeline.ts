import { emptyStates, markerLegend, timelineViewModel, timelineGroups, withoutRepositoryPrefix, sessionLabels, repositoryLabel, fitSessionLabel, fitWindow, markers, clock, clip, pad, wrap, type Marker, type TimelineGroup, type TimelineLane } from '@pi-console/viewmodels';
import { Column, Lines, Panel, h, type Line } from '../view/renderer.ts';
import { blank, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, whenLoaded, type Env, type SectionView } from './common.ts';
import { axisCells, gridPart, inWindow, nearby } from './timeline-grid.ts';

const LABEL = 24;
const GUTTER = 1;

interface LaneRow { measure?: Env['measure']; width: number; ticks: ReadonlySet<number>; scrub: number | undefined; phase: number }

function laneLine(lane: TimelineLane, selected: boolean, row: LaneRow): Line {
  const byColumn = new Map(lane.cells.map(cell => [cell.column, cell]));
  const style = { scrub: row.scrub, ticks: row.ticks, selected };
  const parts = Array.from({ length: row.width }, (_, column) => gridPart(byColumn.get(column), column, style));
  return [t(selected ? '▌' : ' ', 'cyan'), ...statusParts({ ...lane.status }, row.phase, false), t(' '), t(pad(lane.label, LABEL - 3, row.measure), selected ? 'text' : 'muted', { bold: selected }), t(' '.repeat(GUTTER)), ...parts];
}

function axisLine(axis: readonly { column: number; label: string }[], width: number, scrub: number | undefined, scrubLabel: string): Line {
  const cells = axisCells(axis, width);
  if (scrub !== undefined) for (const [index, character] of [...scrubLabel].entries()) if (scrub + index < width) cells[scrub + index] = character;
  return [t(' '.repeat(LABEL + GUTTER)), t(cells.join(''), 'faint')];
}

function groupedLanes(lanes: readonly TimelineLane[], env: Env): TimelineGroup[] {
  const sessions = new Map(env.data.sessions.map(session => [session.id, session]));
  return timelineGroups(lanes, env.data.sessions).map(group => ({
    ...group,
    lanes: group.lanes.map(lane => {
      const session = sessions.get(lane.sessionId);
      if (!session) return lane;
      const labels = withoutRepositoryPrefix(sessionLabels(session), repositoryLabel(group.repositoryId));
      return { ...lane, label: fitSessionLabel(labels, LABEL - 3, env.measure) };
    }),
  }));
}

/** Reserve a row for the repository heading when scrolling starts inside a group. */
function laneLines(groups: readonly TimelineGroup[], selectedId: string | undefined, row: LaneRow, height: number): Line[] {
  const rows = groups.flatMap(group => {
    const heading: Line = [t(` ${clip(repositoryLabel(group.repositoryId), LABEL + GUTTER + row.width - 1, row.measure)}`, 'cyan', { bold: true })];
    return [
      { line: heading, selected: false, heading: undefined },
      ...group.lanes.map(lane => ({ line: laneLine(lane, lane.sessionId === selectedId, row), selected: lane.sessionId === selectedId, heading })),
    ];
  });
  const cursor = Math.max(0, rows.findIndex(entry => entry.selected));
  const { start, end } = windowOf(rows.length, cursor, Math.max(1, height - 1));
  const visible = rows.slice(start, end);
  const heading = visible[0]?.heading;
  return [...(heading ? [heading] : []), ...visible.map(entry => entry.line)];
}

/** Scrub column clamped to the grid, and the time it points at (0 when not scrubbing). */
function scrubOf(ui: Env['ui'], width: number, window: { start: number; span: number }): { scrub: number | undefined; scrubAt: number } {
  const scrub = ui.scrub ? Math.min(width - 1, ui.scrubColumn) : undefined;
  return { scrub, scrubAt: scrub === undefined ? 0 : window.start + window.span * scrub / Math.max(1, width - 1) };
}

function markerLines(marker: Marker, gridWidth: number, measure?: Env['measure']): Line[] {
  return [
    [t(`${clock(new Date(marker.at).toISOString())} `, 'faint'), t(`${marker.glyph} `, marker.color, { bold: true }), t(marker.kind, marker.color)],
    ...wrap(clip(marker.text, 200, measure), gridWidth - 6, 1, measure).map((text): Line => [t('         ' + text, 'text')]),
  ];
}

function detailLines(heading: string, focus: readonly Marker[], gridWidth: number, measure?: Env['measure']): Line[] {
  const body = focus.length === 0 ? [[t('Nothing here. Zoom out with -, pan with h and l.', 'faint')] as Line] : focus.flatMap(marker => markerLines(marker, gridWidth, measure)).slice(0, 8);
  return [[t(heading, 'muted', { bold: true })], ...body];
}

function windowDuration(span: number): string {
  const units = [[86400000, 'd'], [3600000, 'h'], [60000, 'm'], [1000, 's']] as const;
  const first = units.findIndex(([size]) => span >= size);
  if (first < 0) return '0s';
  let remaining = span;
  return units.slice(first, first + 2).map(([size, label]) => {
    const count = Math.floor(remaining / size);
    remaining %= size;
    return count > 0 ? `${String(count)}${label}` : '';
  }).filter(Boolean).join(' ');
}

export function timelineView(env: Env): SectionView {
  const { data, ui } = env;
  const width = Math.max(20, env.width - 4 - LABEL - GUTTER);
  const base = { sessions: data.sessions, requests: data.requests, resets: data.resets, questions: data.questions, messages: data.messages };
  const all = markers(base);
  const fitted = fitWindow(all);
  const model = timelineViewModel({ ...base, window: ui.window ?? fitted, width, labelWidth: LABEL - 3, measure: env.measure });
  const groups = groupedLanes(model.lanes, env);
  const lanes = groups.flatMap(group => group.lanes);
  const cursor = Math.min(ui.cursor.timeline, Math.max(0, lanes.length - 1));
  const { scrub, scrubAt } = scrubOf(ui, width, model.window);
  const lane = lanes[cursor];
  const row: LaneRow = { measure: env.measure, width, ticks: new Set(model.axis.map(tick => tick.column)), scrub, phase: env.phase };
  const lines = laneLines(groups, lane?.sessionId, row, Math.max(2, env.height - 4 - 2 - 9));
  const focus = scrub === undefined ? inWindow(all, lane?.sessionId, model.window) : nearby(all, lane?.sessionId, scrubAt, model.window.span / width * 3);
  const label = lane?.label ?? '';
  const heading = scrub === undefined ? `${label} · last markers in view` : `scrub ${clock(new Date(scrubAt).toISOString())} · ${label} · nearest markers`;
  const legend: Line = [t(' ', 'faint'), ...markerLegend.flatMap(entry => [t(entry.glyph, entry.color, { bold: true }), t(` ${entry.label}  `, 'muted')])];
  const detail = whenLoaded(data.loaded, () => model.lanes.length === 0 ? emptyLines(emptyStates.timeline, env.width - 4) : detailLines(heading, focus, env.width - 4, env.measure));
  const duration = windowDuration(model.window.span);
  return {
    length: model.lanes.length,
    time: { fit: fitted, width },
    rowAt: index => ({ sessionId: lanes[index]?.sessionId ?? null, groupId: null }),
    idAt: index => lanes[index]?.sessionId ?? null,
    render: () => h(Column, { grow: 1 },
      h(Panel, { title: `Timeline · window ${duration} · + − zoom · h l pan · t scrub`, focused: true, grow: 1, right: `${String(model.lanes.length)} lanes` },
        h(Lines, { lines: [axisLine(model.axis, width, scrub, ''), ...lines, blank, legend] }),
        h(Lines, { lines: detail, grow: 1 }))),
  };
}
