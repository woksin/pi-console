import { readSync } from 'node:fs';
import type { Mapper } from '@pi-console/adapters';

const probeBytes = 64 * 1024;
const longestLine = 1024 * 1024;

/**
 * Skips rows whose in-record timestamp (`row[key]`) is older than `since`, without touching the mapper. A missing or
 * unparsable timestamp passes through so the mapper still decides (and warns) exactly as it would unwindowed.
 */
export function windowed(mapper: Mapper, key: string, since: number): Mapper {
  return record => {
    const value = record[key];
    return typeof value === 'string' && Date.parse(value) < since ? [] : mapper(record);
  };
}

/** Offset just after the first newline at or after `from`, or `undefined` when the rest of the file has none. */
function lineEnd(fd: number, from: number, size: number): number | undefined {
  const chunk = Buffer.alloc(probeBytes);
  for (let position = from; position < size && position - from < longestLine; position += probeBytes) {
    const read = readSync(fd, chunk, 0, Math.min(probeBytes, size - position), position);
    const index = chunk.subarray(0, read).indexOf(10);
    if (index !== -1) return position + index + 1;
    if (read === 0) return undefined;
  }
  return undefined;
}

interface Line { start: number; next: number; time: number }

/** The complete line starting at `start`. An unreadable or oversized line has time NaN (it counts as in the window). */
function lineAt(fd: number, start: number, size: number, timeOf: (line: string) => number): Line | undefined {
  const next = lineEnd(fd, start, size);
  if (next === undefined) return undefined;
  const bytes = Buffer.alloc(Math.min(next - start, longestLine));
  readSync(fd, bytes, 0, bytes.length, start);
  try { return { start, next, time: timeOf(bytes.toString('utf8')) }; } catch { return { start, next, time: Number.NaN }; }
}

/** First line start at or after `from` (`from` itself when it is `0` or follows a newline), or `undefined` at the end. */
function lineAfter(fd: number, from: number, size: number, timeOf: (line: string) => number): Line | undefined {
  if (from === 0) return lineAt(fd, 0, size, timeOf);
  const start = lineEnd(fd, from - 1, size);
  return start === undefined ? undefined : lineAt(fd, start, size, timeOf);
}

/**
 * Where to start reading a fresh file whose rows are in timestamp order: the start of the first complete row whose
 * time is not before `since` (boundary inclusive), found by binary search with probes of at most 64 KiB. Returns the
 * end of the last complete row when none qualifies. Rows with an unreadable time count as qualifying, so a bad row
 * can only make the read start earlier, never skip data.
 */
export function seekStart(fd: number, size: number, since: number, timeOf: (line: string) => number): number {
  let low = 0;
  let high = size;
  while (high - low > probeBytes) {
    const middle = Math.floor((low + high) / 2);
    const probe = lineAfter(fd, middle, size, timeOf);
    if (!probe) high = middle;
    else if (probe.time < since) low = probe.next;
    else high = middle;
  }
  let position = low;
  for (let line = lineAt(fd, position, size, timeOf); line; line = lineAt(fd, position, size, timeOf)) {
    if (!(line.time < since)) return line.start;
    position = line.next;
  }
  return position;
}
