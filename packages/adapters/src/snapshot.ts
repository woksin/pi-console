import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { EventLog, SourceCheckpoint } from '@pi-console/contract';
import { mapLine, type Mapper } from './tailing/events.ts';
import { sourceFile } from './tailing/paths.ts';
import type { Scanner } from './tailing/redact.ts';

export interface SnapshotOptions {
  roots: readonly string[];
  scanner?: Scanner;
  maxBytes?: number;
  /** Turns the file bytes into the JSON line the mapper reads, for files that are not JSON (default: the bytes as text). */
  decode?: (bytes: Buffer, path: string) => string;
}

/** One descriptor and a content hash: atomic rename and same-size rewrites are both observed. */
export async function pollSnapshot(log: EventLog, source: string, candidate: string, mapper: Mapper, options: SnapshotOptions): Promise<number> {
  const path = sourceFile(candidate, options.roots);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Source is not a regular file');
    const bytes = snapshotBytes(fd, options.maxBytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const identity = `snapshot:${path}`; // Logical snapshot survives atomic file replacement.
    const saved = (await log.checkpoints(source)).find(item => item.path === path && item.identity === identity);
    if (saved?.headHash === hash) return 0;
    const checkpoint: SourceCheckpoint = { source, path, identity, generation: (saved?.generation ?? -1) + 1, offset: bytes.length, size: bytes.length, mtimeMs: stat.mtimeMs, headHash: hash };
    const events = mapLine(options.decode ? options.decode(bytes, path) : bytes.toString('utf8'), 0, { checkpoint, mapper, scanner: options.scanner });
    return (await log.append(events, [checkpoint])).appended;
  } finally { closeSync(fd); }
}

function snapshotBytes(fd: number, limit = 4 * 1024 * 1024): Buffer {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid snapshot limit');
  const { size } = fstatSync(fd);
  if (size > limit) throw new Error('Snapshot exceeds limit');
  const buffer = Buffer.alloc(Math.min(limit, size) + 1);
  const count = readSync(fd, buffer, 0, buffer.length, 0);
  if (count > limit) throw new Error('Snapshot exceeds limit');
  return buffer.subarray(0, count);
}
