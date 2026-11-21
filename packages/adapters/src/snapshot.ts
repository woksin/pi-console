import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import type { EventLog, SourceCheckpoint } from '@pi-console/contract';
import { mapLine, type Mapper } from './tailing/events.ts';
import { openSource, resolveSourceScope } from './tailing/open-source.ts';
import type { Scanner } from './tailing/redact.ts';

export interface SnapshotOptions {
  roots: readonly string[];
  /** Pinned canonical trust roots supplied by discovery; never re-resolve them at read time. */
  resolvedRoots?: readonly string[];
  scanner?: Scanner;
  maxBytes?: number;
  /** Turns the file bytes into the JSON line the mapper reads, for files that are not JSON (default: the bytes as text). */
  decode?: (bytes: Buffer, path: string) => string;
}

/** One descriptor and a content hash: atomic rename and same-size rewrites are both observed. */
export async function pollSnapshot(log: EventLog, source: string, candidate: string, mapper: Mapper, options: SnapshotOptions): Promise<number> {
  const scope = options.resolvedRoots ? { path: candidate, roots: options.resolvedRoots } : resolveSourceScope(candidate, options.roots);
  const { handle, path, stat } = await openSource(scope.path, scope.roots);
  try {
    const bytes = await snapshotBytes(handle, stat.size, options.maxBytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    const identity = `snapshot:${path}`; // Logical snapshot survives atomic file replacement.
    const saved = (await log.checkpoints(source)).find(item => item.path === path && item.identity === identity);
    if (saved?.headHash === hash) return 0;
    const checkpoint: SourceCheckpoint = { source, path, identity, generation: (saved?.generation ?? -1) + 1, offset: bytes.length, size: bytes.length, mtimeMs: stat.mtimeMs, headHash: hash };
    const events = mapLine(options.decode ? options.decode(bytes, path) : bytes.toString('utf8'), 0, { checkpoint, mapper, scanner: options.scanner });
    return (await log.append(events, [checkpoint])).appended;
  } finally { await handle.close(); }
}

async function snapshotBytes(handle: FileHandle, size: number, limit = 4 * 1024 * 1024): Promise<Buffer> {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Invalid snapshot limit');
  if (size > limit) throw new Error('Snapshot exceeds limit');
  const buffer = Buffer.alloc(Math.min(limit, size) + 1);
  const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
  if (bytesRead > limit) throw new Error('Snapshot exceeds limit');
  return buffer.subarray(0, bytesRead);
}
