import { clock } from '@pi-console/viewmodels';

/** Daemon UTC timestamps keep their date and use the console's 24-hour clock. */
export function settingsTimestamp(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return null;
  return `${value.slice(0, 10)} ${clock(value)} UTC`;
}
