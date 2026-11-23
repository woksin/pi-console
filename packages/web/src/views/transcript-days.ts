import { timeDisplay, type TranscriptLine } from '@pi-console/viewmodels';

/** Consecutive lines of one local calendar day; `date` is empty when the first line has no readable time. */
export interface DayGroup { key: string; date: string; lines: TranscriptLine[] }

/** Splits the displayed sequence at each local-day change; the first group always starts at the first displayed line. */
export function dayGroups(lines: readonly TranscriptLine[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const seen = new Map<string, number>();
  let day: string | undefined;
  for (const line of lines) {
    const display = timeDisplay(line.at);
    if (display.dayKey !== day) {
      day = display.dayKey;
      const occurrence = seen.get(day) ?? 0;
      seen.set(day, occurrence + 1);
      groups.push({ key: `${day}#${String(occurrence)}`, date: day ? display.date : '', lines: [] });
    }
    groups[groups.length - 1].lines.push(line);
  }
  return groups;
}
