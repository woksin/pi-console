import { timelineViewModel, fitWindow, markers, clock, clip, pad, wrap, type Marker, type TimelineLane } from '@pi-console/viewmodels';
import { Column, Lines, Panel, h, type Line, type Part } from '../view/renderer.ts';
import { blank, statusParts, t, windowOf } from '../view/parts.ts';
import type { Env, SectionView } from './common.ts';

const LABEL = 24;

function laneLine(lane: TimelineLane, width: number, selected: boolean, ticks: ReadonlySet<number>, scrub: number | undefined, phase: number): Line {
  const byColumn = new Map(lane.cells.map(cell => [cell.column, cell]));
  const parts: Part[] = [];
  for (let column = 0; column < width; column++) {
    const cell = byColumn.get(column);
    const background = column === scrub ? 'select' as const : selected ? 'panel' as const : undefined;
    if (cell) parts.push({ text: cell.glyph, color: cell.color, bold: true, background });
    else parts.push({ text: column === scrub ? '│' : ticks.has(column) ? '┊' : '─', color: column === scrub ? 'cyan' : ticks.has(column) ? 'border' : 'border', background, dim: column !== scrub });
  }
  return [t(selected ? '▌' : ' ', 'cyan'), ...statusParts({ ...lane.status }, phase, false), t(' '), t(pad(lane.label, LABEL - 3), selected ? 'text' : 'muted', { bold: selected }), ...parts];
}

function axisLine(axis: readonly { column: number; label: string }[], width: number, scrub: number | undefined, scrubLabel: string): Line {
  const cells = Array.from({ length: width }, () => ' ');
  for (const tick of axis) for (const [index, character] of [...tick.label].entries()) if (tick.column + index < width) cells[tick.column + index] = character;
  if (scrub !== undefined) for (const [index, character] of [...scrubLabel].entries()) if (scrub + index < width) cells[scrub + index] = character;
  return [t(' '.repeat(LABEL + 1)), t(cells.join(''), 'faint')];
}

function nearby(all: readonly Marker[], sessionId: string | undefined, atMs: number, spanMs: number): Marker[] {
  return all.filter(marker => marker.sessionId === sessionId).sort((a, b) => Math.abs(a.at - atMs) - Math.abs(b.at - atMs)).filter(marker => Math.abs(marker.at - atMs) <= spanMs).slice(0, 6);
}

export function timelineView(env: Env): SectionView {
  const { data, ui } = env;
  const width = Math.max(20, env.width - 4 - LABEL - 1);
  const base = { sessions: data.sessions, requests: data.requests, resets: data.resets, questions: data.questions, messages: data.messages };
  const all = markers(base);
  const fitted = fitWindow(all);
  const model = timelineViewModel({ ...base, window: ui.window ?? fitted, width });
  const cursor = Math.min(ui.cursor.timeline, Math.max(0, model.lanes.length - 1));
  const scrub = ui.scrub ? Math.min(width - 1, ui.scrubColumn) : undefined;
  const scrubAt = scrub === undefined ? 0 : model.window.start + model.window.span * scrub / Math.max(1, width - 1);
  const lane = model.lanes[cursor];
  const ticks = new Set(model.axis.map(tick => tick.column));
  const laneRows = Math.max(1, env.height - 4 - 2 - 9);
  const { start, end } = windowOf(model.lanes.length, cursor, laneRows);
  const focus = scrub === undefined ? all.filter(marker => marker.sessionId === lane?.sessionId && marker.at >= model.window.start && marker.at <= model.window.start + model.window.span).slice(-6).reverse() : nearby(all, lane?.sessionId, scrubAt, model.window.span / width * 3);
  const gridWidth = env.width - 4;
  const legend: Line = [t(' ', 'faint'), ...model.legend.flatMap(entry => [t(entry.glyph, entry.color, { bold: true }), t(` ${entry.label}  `, 'muted')])];
  const detail: Line[] = [
    [t(scrub === undefined ? `${lane?.label ?? ''} · last markers in view` : `scrub ${clock(new Date(scrubAt).toISOString())} · ${lane?.label ?? ''} · nearest markers`, 'muted', { bold: true })],
    ...(focus.length === 0 ? [[t('Nothing here. Zoom out with -, pan with h and l.', 'faint')] as Line] : focus.flatMap((marker): Line[] => [
      [t(`${clock(new Date(marker.at).toISOString())} `, 'faint'), t(`${marker.glyph} `, marker.color, { bold: true }), t(marker.kind, marker.color)],
      ...wrap(clip(marker.text, 200), gridWidth - 6, 1).map((text): Line => [t('         ' + text, 'text')]),
    ])).slice(0, 8),
  ];
  const spanSeconds = Math.round(model.window.span / 1000);
  return {
    length: model.lanes.length,
    time: { fit: fitted, width },
    rowAt: index => ({ sessionId: model.lanes[index]?.sessionId ?? null, groupId: null }),
    idAt: index => model.lanes[index]?.sessionId ?? null,
    render: () => h(Column, { grow: 1 },
      h(Panel, { title: `Timeline · window ${String(spanSeconds)}s · + − zoom · h l pan · t scrub`, focused: true, grow: 1, right: `${String(model.lanes.length)} lanes` },
        h(Lines, { lines: [axisLine(model.axis, width, scrub, ''), ...model.lanes.slice(start, end).map((entry, offset) => laneLine(entry, width, start + offset === cursor, ticks, scrub, env.phase)), blank, legend] }),
        h(Lines, { lines: detail, grow: 1 }))),
  };
}
