import type { Marker, TimelineLane } from '@pi-console/viewmodels';
import type { Part } from '../view/renderer.ts';

/** How one lane row is drawn: which column is scrubbed, which carry axis ticks, and whether the lane is the selected one. */
export interface GridStyle { scrub: number | undefined; ticks: ReadonlySet<number>; selected: boolean }

/** The part drawn at one column of a lane row: the lane's own cell, or the scrub line, an axis tick or the baseline. */
export function gridPart(cell: TimelineLane['cells'][number] | undefined, column: number, style: GridStyle): Part {
  const scrubbed = column === style.scrub;
  const background = scrubbed ? 'select' as const : style.selected ? 'panel' as const : undefined;
  if (cell) return { text: cell.glyph, color: cell.color, bold: true, background };
  const text = scrubbed ? '│' : style.ticks.has(column) ? '┊' : '─';
  return { text, color: scrubbed ? 'cyan' : 'border', background, dim: !scrubbed };
}

/** The markers nearest `atMs` for one session, closest first, within `spanMs`. */
export function nearby(all: readonly Marker[], sessionId: string | undefined, atMs: number, spanMs: number): Marker[] {
  return all.filter(marker => marker.sessionId === sessionId).sort((a, b) => Math.abs(a.at - atMs) - Math.abs(b.at - atMs)).filter(marker => Math.abs(marker.at - atMs) <= spanMs).slice(0, 6);
}

/** The newest markers of one session inside the window, newest first. */
export function inWindow(all: readonly Marker[], sessionId: string | undefined, window: { start: number; span: number }): Marker[] {
  return all.filter(marker => marker.sessionId === sessionId && marker.at >= window.start && marker.at <= window.start + window.span).slice(-6).reverse();
}

/** The axis labels laid into `width` cells: a label that would run past the right edge is moved left to end there, and one that would then touch its neighbour is dropped. */
export function axisCells(axis: readonly { column: number; label: string }[], width: number): string[] {
  const cells = Array.from({ length: width }, () => ' ');
  let end = 0;
  for (const tick of axis) {
    const characters = [...tick.label];
    const start = Math.max(0, Math.min(tick.column, width - characters.length));
    if (start < end) continue;
    for (const [index, character] of characters.entries()) cells[start + index] = character;
    end = start + characters.length + 1;
  }
  return cells;
}
