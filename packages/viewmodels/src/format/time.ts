/** Shared, viewer-local presentation of ISO timestamps, so the web and the TUI show times identically. */

type IsoTimestamp = string;
/** An IANA zone name; omitted means the viewer's own zone. */
export type TimeZoneName = string | undefined;

export interface TimeDisplay {
  /** `HH:mm:ss`, 24-hour, in the viewer's zone. */
  clock: string;
  /** Local calendar-day identity (`YYYY-MM-DD`); empty when the input is not a time. */
  dayKey: string;
  /** Readable local calendar day, e.g. `20 Nov 2026`. */
  date: string;
  /** Full local time with its zone, e.g. `20 Nov 2026 14:00:00 UTC+01:00 (Europe/Oslo)`. */
  absolute: string;
}

const unknown: TimeDisplay = { clock: '–', dayKey: '', date: '–', absolute: '–' };
const maxFormatters = 8;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: TimeZoneName): Intl.DateTimeFormat {
  const key = zone ?? '';
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'longOffset',
  });
  if (formatters.size >= maxFormatters) formatters.clear();
  formatters.set(key, created);
  return created;
}

const monthNumbers = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (value: string): string => value.padStart(2, '0');

/** `GMT+01:00` becomes `UTC+01:00`; a bare `GMT` is `UTC+00:00`. */
const offsetOf = (raw: string): string => (raw === 'GMT' ? 'UTC+00:00' : raw.replace(/^GMT/, 'UTC'));

/** The local clock, calendar day and absolute time of `iso`; an unparseable input yields the `–` convention. `zone` is for deterministic specs. */
export function timeDisplay(iso: IsoTimestamp, zone?: TimeZoneName): TimeDisplay {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return unknown;
  const formatter = formatterFor(zone);
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(ms)) parts[part.type] = part.value;
  const month = monthNumbers.indexOf(parts.month) + 1;
  const date = `${parts.day} ${parts.month} ${parts.year}`;
  const clock = `${pad2(parts.hour)}:${pad2(parts.minute)}:${pad2(parts.second)}`;
  const name = formatter.resolvedOptions().timeZone;
  const where = name === 'UTC' ? 'UTC' : `${offsetOf(parts.timeZoneName)} (${name})`;
  return { clock, dayKey: `${parts.year}-${pad2(String(month))}-${pad2(parts.day)}`, date, absolute: `${date} ${clock} ${where}` };
}

/** Whether `current` starts a new local calendar day after `previous` (always true for the first displayed item). */
export const startsNewDay = (previous: IsoTimestamp | undefined, current: IsoTimestamp, zone?: TimeZoneName): boolean =>
  previous === undefined || timeDisplay(previous, zone).dayKey !== timeDisplay(current, zone).dayKey;
