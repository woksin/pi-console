import { emptyStates, markerLegend, timelineViewModel, fitWindow, markers, clock, clip, pad, wrap, type Marker, type TimelineLane } from '@pi-console/viewmodels';
import { Column, Lines, Panel, h, type Line } from '../view/renderer.ts';
import { blank, statusParts, t, windowOf } from '../view/parts.ts';
import { emptyLines, whenLoaded, type Env, type SectionView } from './common.ts';
import { gridPart, inWindow, nearby } from './timeline-grid.ts';

const LABEL = 24;

interface LaneRow { measure?: Env['measure']; width: number; ticks: ReadonlySet<number>; scrub: number | undefined; phase: number }

function laneLine(lane: TimelineLane, selected: boolean, row: LaneRow): Line {
  const byColumn = new Map(lane.cells.map(cell => [cell.column, cell]));
  const style = { scrub: row.scrub, ticks: row.ticks, selected };
  const parts = Array.from({ length: row.width }, (_, column) => gridPart(byColumn.get(column), column, style));
  return [t(selected ? '▌' : ' ', 'cyan'), ...statusParts({ ...lane.status }, row.phase, false), t(' '), t(pad(lane.label, LABEL - 3, row.measure), selected ? 'text' : 'muted', { bold: selected }), ...parts];
}

function axisLine(axis: readonly { column: number; label: string }[], width: number, scrub: number | undefined, scrubLabel: string): Line {
  const cells = Array.from({ length: width }, () => ' ');
  for (const tick of axis) for (const [index, character] of [...tick.label].entries()) if (tick.column + index < width) cells[tick.column + index] = character;
  if (scrub !== undefined) for (const [index, character] of [...scrubLabel].entries()) if (scrub + index < width) cells[scrub + index] = character;
  return [t(' '.repeat(LABEL + 1)), t(cells.join(''), 'faint')];
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

export function timelineView(env: Env): SectionView {
  const { data, ui } = env;
  const width = Math.max(20, env.width - 4 - LABEL - 1);
  const base = { sessions: data.sessions, requests: data.requests, resets: data.resets, questions: data.questions, messages: data.messages };
  const all = markers(base);
  const fitted = fitWindow(all);
  const model = timelineViewModel({ ...base, window: ui.window ?? fitted, width });
  const cursor = Math.min(ui.cursor.timeline, Math.max(0, model.lanes.length - 1));
  const { scrub, scrubAt } = scrubOf(ui, width, model.window);
  const lane = model.lanes[cursor];
  const row: LaneRow = { measure: env.measure, width, ticks: new Set(model.axis.map(tick => tick.column)), scrub, phase: env.phase };
  const { start, end } = windowOf(model.lanes.length, cursor, Math.max(1, env.height - 4 - 2 - 9));
  const focus = scrub === undefined ? inWindow(all, lane?.sessionId, model.window) : nearby(all, lane?.sessionId, scrubAt, model.window.span / width * 3);
  const label = lane?.label ?? '';
  const heading = scrub === undefined ? `${label} · last markers in view` : `scrub ${clock(new Date(scrubAt).toISOString())} · ${label} · nearest markers`;
  const legend: Line = [t(' ', 'faint'), ...markerLegend.flatMap(entry => [t(entry.glyph, entry.color, { bold: true }), t(` ${entry.label}  `, 'muted')])];
  const detail = whenLoaded(data.loaded, () => model.lanes.length === 0 ? emptyLines(emptyStates.timeline, env.width - 4) : detailLines(heading, focus, env.width - 4, env.measure));
  const spanSeconds = Math.round(model.window.span / 1000);
  return {
    length: model.lanes.length,
    time: { fit: fitted, width },
    rowAt: index => ({ sessionId: model.lanes[index]?.sessionId ?? null, groupId: null }),
    idAt: index => model.lanes[index]?.sessionId ?? null,
    render: () => h(Column, { grow: 1 },
      h(Panel, { title: `Timeline · window ${String(spanSeconds)}s · + − zoom · h l pan · t scrub`, focused: true, grow: 1, right: `${String(model.lanes.length)} lanes` },
        h(Lines, { lines: [axisLine(model.axis, width, scrub, ''), ...model.lanes.slice(start, end).map((entry, offset) => laneLine(entry, start + offset === cursor, row)), blank, legend] }),
        h(Lines, { lines: detail, grow: 1 }))),
  };
}
