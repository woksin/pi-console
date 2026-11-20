import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import type { EventLog } from '@pi-console/contract';
import { sourcePath } from '../tailing/paths.ts';
import { FileTailer, type TailerOptions } from '../tailing/tailer.ts';
import type { Mapper } from '../tailing/events.ts';
import { sessionMapper } from './mapper.ts';

function decodeHeader(bytes: Buffer): Mapper {
  try {
    const end = bytes.indexOf(10);
    const value: unknown = end < 0 ? null : JSON.parse(bytes.subarray(0, end).toString('utf8'));
    return mapperForHeader(value);
  } catch {
    return () => { throw new Error('Unsupported session header'); };
  }
}

function mapperForHeader(value: unknown): Mapper {
  if (!value) throw new Error('Unsupported session header');
  if (typeof value !== 'object') throw new Error('Unsupported session header');
  const header = value as Record<string, unknown>;
  if (header.type !== 'session') throw new Error('Unsupported session header');
  if (header.version !== 3) throw new Error('Unsupported session header');
  if (typeof header.id !== 'string') throw new Error('Unsupported session header');
  if (!header.id) throw new Error('Unsupported session header');
  return sessionMapper(header.id);
}

/** Inspect only the bounded header, including when resuming at a nonzero checkpoint. */
function headerMapper(path: string): Mapper {
  const fd = openSync(sourcePath(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Source is not a regular file');
    const bytes = Buffer.alloc(64 * 1024);
    const count = readSync(fd, bytes, 0, bytes.length, 0);
    return decodeHeader(bytes.subarray(0, count));
  } finally {
    closeSync(fd);
  }
}

/** One tailer per session file; include its renamed archives when polling after restart. */
export function sessionTailer(log: EventLog, path: string, options: TailerOptions = {}): FileTailer {
  return new FileTailer(log, 'session-jsonl', headerMapper(path), options);
}
