import type { Overview, Session } from '@pi-console/contract';
import { burnWindow } from '../projections/burn.ts';

type Point = Overview['sparkline'][number];

/**
 * Fleet-wide 24-point burn line: sessions' sample series aligned at their newest point, context averaged and
 * tokens summed per position. Sessions without samples do not count.
 */
export function sparkline(sessions: readonly Session[]): Point[] {
  const series = sessions.map(session => session.samples).filter(samples => samples.length > 0);
  const points: Point[] = [];
  for (let back = burnWindow; back >= 1; back--) {
    const column = series.map(samples => samples.at(-back)).filter(sample => sample !== undefined);
    if (column.length === 0) continue;
    points.push({
      at: column.map(sample => sample.at).sort().at(-1) ?? '',
      contextPercent: Math.round(column.reduce((sum, sample) => sum + sample.contextPercent, 0) / column.length),
      tokens: column.reduce((sum, sample) => sum + sample.tokens, 0),
      costUsd: 0,
    });
  }
  return points;
}
