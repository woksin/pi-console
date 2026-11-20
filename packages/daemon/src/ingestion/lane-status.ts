import { basename } from 'node:path';

/** A status line is one short sentence; anything longer is cut before it is parsed. */
const maxLine = 1024;

/**
 * Turns a `<LANE>.status` file into the JSON line the lane-status mapper reads: the lane name from the file name and
 * the first line of the file. The mapper rejects names and lines that do not fit the grammar.
 */
export function laneStatusJson(bytes: Buffer, path: string): string {
  const line = bytes.subarray(0, maxLine).toString('utf8').split('\n', 1)[0].trim();
  return JSON.stringify({ lane: basename(path, '.status'), line });
}
