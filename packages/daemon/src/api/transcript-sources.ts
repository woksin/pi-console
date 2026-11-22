import { openSource, sessionMapper, transcriptUnavailable, validateTranscriptSource, type TranscriptVersion } from '@pi-console/adapters';
import type { EventLog, SourceCheckpoint } from '@pi-console/contract';
import { SourceRoot } from '../ingestion/source-root.ts';

export interface TranscriptSource {
  path: string;
  roots: readonly string[];
  version: TranscriptVersion;
  epoch: string;
}
interface Association { key: string; sessionId: string; size: number; mtimeMs: number; revision: number }

/** Metadata-only index of ingestion-owned paths. Neither session IDs nor anchor IDs ever become paths. */
export class TranscriptSources {
  readonly #log: Pick<EventLog, 'checkpoints'>;
  readonly #roots: SourceRoot[];
  readonly #headers = new Map<string, Association>();

  constructor(log: Pick<EventLog, 'checkpoints'>, roots: readonly string[]) {
    this.#log = log;
    this.#roots = roots.map(root => new SourceRoot(root));
  }

  async resolve(sessionId: string): Promise<TranscriptSource | undefined> {
    const roots = this.#roots.flatMap(root => root.available() ?? []);
    const checkpoints = await this.#log.checkpoints('session-jsonl');
    const live = new Set(checkpoints.map(checkpoint => checkpoint.identity));
    for (const identity of this.#headers.keys()) if (!live.has(identity)) this.#headers.delete(identity);
    const matches: TranscriptSource[] = [];
    for (const checkpoint of checkpoints) {
      const candidate = await this.#candidate(checkpoint, roots);
      if (candidate?.sessionId === sessionId) matches.push(candidate.source);
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  async #candidate(checkpoint: SourceCheckpoint, roots: readonly string[]): Promise<{ sessionId: string; source: TranscriptSource } | undefined> {
    if (!checkpoint.path.endsWith('.jsonl')) return undefined;
    try {
      const { handle, stat } = await openSource(checkpoint.path, roots);
      try {
        const saved = { identity: checkpoint.identity, size: checkpoint.size, mtimeMs: checkpoint.mtimeMs, headHash: checkpoint.headHash, headBytes: Math.min(512, checkpoint.size) };
        await validateTranscriptSource(handle, stat, saved);
        const key = JSON.stringify([checkpoint.identity, checkpoint.generation, checkpoint.path, roots, checkpoint.headHash]);
        const association = await this.#association(checkpoint.identity, key, handle, stat);
        return { sessionId: association.sessionId, source: {
          path: checkpoint.path, roots, version: { ...saved, size: stat.size, mtimeMs: stat.mtimeMs }, epoch: `${association.key}:${association.revision}`,
        } };
      } finally { await handle.close(); }
    } catch (error) {
      this.#headers.delete(checkpoint.identity);
      if (transcriptUnavailable(error) || error instanceof InvalidHeader) return undefined;
      throw error;
    }
  }

  async #association(identity: string, key: string, handle: Awaited<ReturnType<typeof openSource>>['handle'], stat: { size: number; mtimeMs: number }): Promise<Association> {
    const previous = this.#headers.get(identity);
    const association = previous?.key === key ? previous : { key, sessionId: await headerId(handle), size: stat.size, mtimeMs: stat.mtimeMs, revision: 0 };
    if (rewritten(association, stat)) {
      association.sessionId = await headerId(handle);
      association.revision++;
    }
    association.size = stat.size;
    association.mtimeMs = stat.mtimeMs;
    this.#headers.set(identity, association);
    return association;
  }
}

function rewritten(previous: Association, current: { size: number; mtimeMs: number }): boolean {
  if (current.size < previous.size) return true;
  return current.size === previous.size && current.mtimeMs !== previous.mtimeMs;
}

class InvalidHeader extends Error {}

async function headerId(handle: Awaited<ReturnType<typeof openSource>>['handle']): Promise<string> {
  const bytes = Buffer.alloc(64 * 1024);
  const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
  try {
    const end = bytes.subarray(0, bytesRead).indexOf(10);
    if (end < 0) throw new InvalidHeader();
    const value: unknown = JSON.parse(bytes.subarray(0, end).toString('utf8'));
    if (!value || typeof value !== 'object') throw new InvalidHeader();
    const header = value as Record<string, unknown>;
    if (header.type !== 'session' || typeof header.id !== 'string' || !header.id) throw new InvalidHeader();
    sessionMapper(header.id)(header);
    return header.id;
  } catch { throw new InvalidHeader(); }
}
