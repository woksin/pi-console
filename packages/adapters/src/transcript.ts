import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { sourceFile, sourcePath } from './tailing/paths.ts';
import { redactValue, type Scanner } from './tailing/redact.ts';

export interface TranscriptRequest {
  path: string;
  roots: readonly string[];
  offset?: number;
  limitBytes?: number;
  scanner?: Scanner;
}
export interface TranscriptPage { entries: unknown[]; nextOffset: number; partial: boolean }

/** Source path must come from the daemon's index, never directly from a browser request. */
export function readTranscript(request: TranscriptRequest): TranscriptPage {
  const path = sourcePath(sourceFile(request.path, request.roots));
  const { offset, limit } = pageBounds(request);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Source is not a regular file');
    const bytes = Buffer.alloc(limit);
    const count = readSync(fd, bytes, 0, limit, offset);
    const complete = bytes.subarray(0, count).lastIndexOf(10) + 1;
    const entries = decodeLines(bytes.subarray(0, complete).toString('utf8'), request.scanner);
    return { entries, nextOffset: offset + complete, partial: complete < count };
  } finally { closeSync(fd); }
}

function pageBounds(request: TranscriptRequest): { offset: number; limit: number } {
  const offset = request.offset ?? 0;
  const limit = request.limitBytes ?? 256 * 1024;
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid transcript offset');
  if (offset < 0) throw new Error('Invalid transcript offset');
  if (!Number.isSafeInteger(limit)) throw new Error('Invalid transcript limit');
  if (limit < 1) throw new Error('Invalid transcript limit');
  if (limit > 1024 * 1024) throw new Error('Invalid transcript limit');
  return { offset, limit };
}

function decodeLines(body: string, scanner?: Scanner): unknown[] {
  return body.split('\n').filter(line => line.trim()).map(line => {
    try { return redactValue(JSON.parse(line) as unknown, scanner); }
    catch { return { withheld: true }; }
  });
}
