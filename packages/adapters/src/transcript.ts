import type { FileHandle } from 'node:fs/promises';
import { openSource, resolveSourceScope } from './tailing/open-source.ts';
import { redactValue, type Scanner } from './tailing/redact.ts';

export interface TranscriptRequest {
  path: string;
  roots: readonly string[];
  /** Pinned canonical trust roots supplied by discovery; an empty list permits no reads. */
  resolvedRoots?: readonly string[];
  offset?: number;
  limitBytes?: number;
  scanner?: Scanner;
}
export interface TranscriptPage { entries: unknown[]; nextOffset: number; partial: boolean }

/** Source path must come from the daemon's index, never directly from a browser request.
 * Complete oversized records become { withheld: true, oversize: true }; torn tails remain resumable.
 */
export async function readTranscript(request: TranscriptRequest): Promise<TranscriptPage> {
  const scope = request.resolvedRoots ? { path: request.path, roots: request.resolvedRoots } : resolveSourceScope(request.path, request.roots);
  if (!scope.path.endsWith('.jsonl')) throw new Error('Source path is not JSONL');
  const { offset, limit } = pageBounds(request);
  const { handle, stat } = await openSource(scope.path, scope.roots);
  try {
    const bytes = Buffer.alloc(limit);
    const { bytesRead: count } = await handle.read(bytes, 0, limit, offset);
    const complete = bytes.subarray(0, count).lastIndexOf(10) + 1;
    if (complete === 0 && count === limit) return await oversizedPage(handle, bytes, offset, stat.size);
    const entries = decodeLines(bytes.subarray(0, complete).toString('utf8'), request.scanner);
    return { entries, nextOffset: offset + complete, partial: complete < count };
  } finally { await handle.close(); }
}

/** Scan at bounded memory to the next newline, never decode or expose a fragment. */
async function oversizedPage(handle: FileHandle, bytes: Buffer, offset: number, size: number): Promise<TranscriptPage> {
  let cursor = offset + bytes.length;
  while (cursor < size) {
    const { bytesRead: count } = await handle.read(bytes, 0, Math.min(bytes.length, size - cursor), cursor);
    if (count === 0) break;
    const newline = bytes.subarray(0, count).indexOf(10);
    if (newline >= 0) return { entries: [{ withheld: true, oversize: true }], nextOffset: cursor + newline + 1, partial: false };
    cursor += count;
  }
  return { entries: [], nextOffset: offset, partial: true };
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
