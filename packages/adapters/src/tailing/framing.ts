import { readSync } from 'node:fs';
import { setImmediate as yieldToLoop } from 'node:timers/promises';

/** Scan only the captured file size, reusing the batch buffer and yielding between chunks.
 * Returns the byte after the newline; undefined leaves an unterminated record resumable.
 */
export async function recordEnd(fd: number, offset: number, size: number, bytes: Buffer): Promise<number | undefined> {
  while (offset < size) {
    await yieldToLoop();
    const read = readSync(fd, bytes, 0, Math.min(bytes.length, size - offset), offset);
    if (read === 0) break;
    const newline = bytes.subarray(0, read).indexOf(10);
    if (newline !== -1) return offset + newline + 1;
    offset += read;
  }
  return undefined;
}

/** Complete JSONL spans, retaining byte positions before UTF-8 decoding. */
export function* recordSpans(bytes: Buffer): Generator<{ start: number; end: number }> {
  let start = 0;
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
    yield { start, end: end + 1 };
    start = end + 1;
  }
}
