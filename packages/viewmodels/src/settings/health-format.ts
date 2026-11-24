import { age, sanitize } from '../format/format.ts';
import { timeDisplay } from '../format/time.ts';

/** Untrusted health text is always a single printable line. */
export const healthText = (value: string): string => sanitize(value).replace(/\n/g, ' ');

/** Binary byte sizes with the unit that keeps the number short. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = Math.abs(bytes);
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${bytes < 0 ? '-' : ''}${unit === 0 ? String(size) : size.toFixed(1)} ${units[unit]}`;
}

/** Relative age and the viewer's local date, clock and zone. */
export function healthTimestamp(value: string, now: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return `${age(value, now)} ago · ${timeDisplay(value).absolute}`;
}

/** Daemon-owned scalars use the same units in both clients, including unknown fields. */
export function healthValue(key: string, value: unknown, now: number, milliseconds = false): string {
  if (typeof value === 'boolean') return key === 'complete' ? (value ? 'Complete' : 'In progress') : (value ? 'Yes' : 'No');
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '–';
    if (key.endsWith('Bytes')) return formatBytes(value);
    if (milliseconds || key.endsWith('Ms')) return `${Number.isInteger(value) ? String(value) : value.toFixed(1)} ms`;
    return value.toLocaleString('en-US');
  }
  if (typeof value === 'string') return healthTimestamp(value, now) ?? healthText(value);
  return '–';
}
