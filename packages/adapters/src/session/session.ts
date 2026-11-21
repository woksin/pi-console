import { dirname } from 'node:path';
import type { EventLog } from '@pi-console/contract';
import { sourcePath } from '../tailing/paths.ts';
import { openSource, resolveSourceScope } from '../tailing/open-source.ts';
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
async function headerMapper(path: string, options: TailerOptions): Promise<Mapper> {
  sourcePath(path); // Validate without opening the pre-resolved target.
  const scope = options.roots ? { path, roots: options.roots } : resolveSourceScope(path, [dirname(path)]);
  const { handle } = await openSource(scope.path, scope.roots);
  try {
    const bytes = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return decodeHeader(bytes.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

/** One tailer per session file; include its renamed archives when polling after restart. */
export function sessionTailer(log: EventLog, path: string, options: TailerOptions = {}): FileTailer {
  return new FileTailer(log, 'session-jsonl', { load: () => headerMapper(path, options) }, options);
}
