import { clock } from '../format/format.ts';
import { columnOf, type TimeWindow } from './timeline.ts';

/** Clock-aligned steps, independent of the terminal's column-based axis. */
export function timelineTickStep(span: number): number {
  const target = span / 7;
  return [1000, 5000, 10_000, 30_000, 60_000, 300_000, 900_000, 1_800_000, 3_600_000].find(step => step >= target) ?? 3_600_000;
}

export function timelineTicks(window: TimeWindow, width: number): { at: number; column: number; label: string }[] {
  const step = timelineTickStep(window.span);
  const first = Math.ceil(window.start / step) * step;
  const count = Math.max(0, Math.floor((window.start + window.span - first) / step) + 1);
  return Array.from({ length: count }, (_, index) => {
    const at = first + index * step;
    return { at, column: columnOf(at, window, width), label: clock(new Date(at).toISOString()) };
  });
}
