import type { Session } from '@pi-console/contract';
import { compactNumber } from '../format/format.ts';
import { laneLabel } from '../format/lane-label.ts';
import { statusCell, type StatusCell } from '../format/status-cell.ts';

/** One session in the fleet pulse strip. */
export interface PulseCell { id: string; title: string; status: StatusCell }
export interface PulseViewModel {
  /** One cell per session, most urgent status first, then by lane, so like statuses form one coloured run. */
  cells: PulseCell[];
  /** Tokens per minute across the fleet over the last `minutes` minutes, oldest first. */
  activity: number[];
  /** `activity` as a braille sparkline, two minutes per character. */
  braille: string;
  needsYou: number; working: number; sessions: number;
  /** One sentence for screen readers and tooltips. */
  summary: string;
}

const precedence = ['needs-you', 'blocked', 'failed', 'working', 'waiting', 'idle', 'done'];
const severity = (status: string): number => { const at = precedence.indexOf(status); return at < 0 ? precedence.length : at; };
const minute = 60_000;

/** Bottom-up dot bits of a braille cell: left column, then right column. */
const left = [0x40, 0x04, 0x02, 0x01];
const right = [0x80, 0x20, 0x10, 0x08];
const dots = (column: readonly number[], level: number): number => column.slice(0, level).reduce((bits, bit) => bits | bit, 0);

/** Two values per braille character, four dot rows high; any non-zero value shows at least one dot. */
export function brailleSparkline(values: readonly number[], max = Math.max(0, ...values)): string {
  const level = (value: number | undefined): number => (value === undefined || value <= 0 || max <= 0 ? 0 : Math.max(1, Math.min(4, Math.round(value / max * 4))));
  let text = '';
  for (let at = 0; at < values.length; at += 2) text += String.fromCodePoint(0x2800 + dots(left, level(values[at])) + dots(right, level(values[at + 1])));
  return text;
}

/** Tokens per minute summed over every session's samples, for the `minutes` minutes up to the newest sample. */
export function fleetActivity(sessions: readonly Session[], minutes: number): number[] {
  const samples = sessions.flatMap(session => session.samples);
  const buckets = Array.from({ length: minutes }, () => 0);
  if (samples.length === 0) return buckets;
  const minuteOf = (at: string): number => Math.floor(Date.parse(at) / minute);
  const end = Math.max(...samples.map(sample => minuteOf(sample.at)));
  for (const sample of samples) {
    const back = end - minuteOf(sample.at);
    if (back < minutes) buckets[minutes - 1 - back] += sample.tokens;
  }
  return buckets;
}

/** The fleet pulse: a btop-style strip with one status-coloured cell per session, an activity sparkline and the needs-you count. */
export function pulseViewModel(input: { sessions: readonly Session[]; needsYou: number; minutes?: number }): PulseViewModel {
  const cells = [...input.sessions]
    .sort((a, b) => severity(a.status) - severity(b.status) || laneLabel(a.repositoryId, a.laneId).localeCompare(laneLabel(b.repositoryId, b.laneId)) || a.name.localeCompare(b.name))
    .map(session => ({ id: session.id, title: `${laneLabel(session.repositoryId, session.laneId)} ${session.name}`, status: statusCell(session.status) }));
  const activity = fleetActivity(input.sessions, input.minutes ?? 24);
  const working = input.sessions.filter(session => session.status === 'working').length;
  const latest = activity.at(-1) ?? 0;
  const summary = `${String(input.sessions.length)} sessions, ${String(working)} working, ${String(input.needsYou)} need you; ${compactNumber(latest)} tokens in the last minute`;
  return { cells, activity, braille: brailleSparkline(activity), needsYou: input.needsYou, working, sessions: input.sessions.length, summary };
}
