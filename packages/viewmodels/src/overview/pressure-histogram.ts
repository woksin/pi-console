import type { Session } from '@pi-console/contract';
import { pressure, type Pressure } from '../format/format.ts';

/** Sessions whose context is in `[from, to)` percent (the last bin includes 100). */
export interface PressureBin { from: number; to: number; count: number; band: Pressure; label: string }
export interface PressureHistogram {
  bins: PressureBin[];
  /** The tallest bin, at least 1, for scaling. */
  peak: number;
  /** The soft (60 %) and handoff (80 %) thresholds drawn as ticks, as on every pressure bar. */
  ticks: readonly number[];
  warm: number; hot: number;
  summary: string;
}

export const pressureTicks = [60, 80] as const;

/** Bins by the bin's lowest value, so a tick sits on a bin edge: 60 starts the warm band, 80 the hot one. */
const bandOf = (from: number): Pressure => (from >= 80 ? 'hot' : from >= 60 ? 'warm' : 'calm');

/** The fleet's context pressure as a histogram of `binCount` equal bins over 0–100 %, with threshold ticks and counts in words. */
export function pressureHistogram(sessions: readonly Pick<Session, 'contextPercent'>[], binCount = 10): PressureHistogram {
  const size = 100 / binCount;
  const bins = Array.from({ length: binCount }, (_, index): PressureBin => {
    const from = Math.round(index * size);
    const to = Math.round((index + 1) * size);
    return { from, to, count: 0, band: bandOf(from), label: `${String(from)}–${String(to)}%` };
  });
  for (const session of sessions) {
    const percent = Math.max(0, Math.min(100, Number.isFinite(session.contextPercent) ? session.contextPercent : 0));
    bins[Math.min(binCount - 1, Math.floor(percent / size))].count++;
  }
  const levels = sessions.map(session => pressure(session.contextPercent));
  const warm = levels.filter(level => level === 'warm').length;
  const hot = levels.filter(level => level === 'hot').length;
  const summary = `${String(sessions.length)} sessions: ${String(hot)} above 80 %, ${String(warm)} between 60 and 80 %`;
  return { bins, peak: Math.max(1, ...bins.map(bin => bin.count)), ticks: pressureTicks, warm, hot, summary };
}
