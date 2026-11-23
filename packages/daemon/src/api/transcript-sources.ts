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
interface IndexedCheckpoint { identity: string; key?: string; sessionId?: string }
interface Candidate { sessionId: string; source: TranscriptSource }

/** Metadata-only index of ingestion-owned paths. Neither session IDs nor anchor IDs ever become paths. */
export class TranscriptSources {
  readonly #log: Pick<EventLog, 'checkpoints'>;
  readonly #roots: SourceRoot[];
  readonly #headers = new Map<string, Association>();
  readonly #indexed = new Map<string, IndexedCheckpoint>();
  readonly #sessions = new Map<string, Set<string>>();
  #resolution: Promise<unknown> = Promise.resolve();

  constructor(log: Pick<EventLog, 'checkpoints'>, roots: readonly string[]) {
    this.#log = log;
    this.#roots = roots.map(root => new SourceRoot(root));
  }

  resolve(sessionId: string): Promise<TranscriptSource | undefined> {
    // Serialize header discovery, not transcript bodies: concurrent readers learn each checkpoint only once.
    const resolution = this.#resolution.then(() => this.#resolve(sessionId));
    this.#resolution = resolution.catch(() => undefined);
    return resolution;
  }

  async #resolve(sessionId: string): Promise<TranscriptSource | undefined> {
    const roots = this.#roots.flatMap(root => root.available() ?? []);
    const checkpoints = new Map((await this.#log.checkpoints('session-jsonl')).map(checkpoint => [checkpoint.identity, checkpoint]));
    const refreshed = await this.#refresh(checkpoints, roots);
    const matches: TranscriptSource[] = [];
    for (const identity of this.#sessions.get(sessionId) ?? []) {
      const checkpoint = checkpoints.get(identity);
      if (!checkpoint) continue;
      const candidate = refreshed.has(identity) ? refreshed.get(identity) : await this.#candidate(checkpoint, roots);
      if (candidate?.sessionId === sessionId) matches.push(candidate.source);
    }
    return matches.length === 1 ? matches[0] : undefined;
  }

  #prune(checkpoints: ReadonlyMap<string, SourceCheckpoint>): void {
    for (const [identity, indexed] of this.#indexed) {
      if (checkpoints.has(identity)) continue;
      this.#removeSession(indexed);
      this.#headers.delete(identity);
      this.#indexed.delete(identity);
    }
  }

  async #refresh(checkpoints: ReadonlyMap<string, SourceCheckpoint>, roots: readonly string[]): Promise<Map<string, Candidate | undefined>> {
    this.#prune(checkpoints);
    const refreshed = new Map<string, Candidate | undefined>();
    for (const checkpoint of checkpoints.values()) {
      const key = JSON.stringify([checkpoint.generation, checkpoint.path, roots, checkpoint.headHash, checkpoint.size, checkpoint.mtimeMs]);
      const indexed = this.#indexed.get(checkpoint.identity) ?? { identity: checkpoint.identity };
      if (indexed.key === key) continue;
      this.#indexed.set(checkpoint.identity, indexed);
      const candidate = await this.#candidate(checkpoint, roots);
      refreshed.set(checkpoint.identity, candidate);
      // Only validated headers are known; every lookup retries the remaining identities before deciding uniqueness.
      indexed.key = candidate ? key : undefined;
    }
    return refreshed;
  }

  #associate(checkpoint: SourceCheckpoint, association: Association): void {
    const indexed = this.#indexed.get(checkpoint.identity);
    if (!indexed || indexed.sessionId === association.sessionId) return;
    this.#removeSession(indexed);
    indexed.sessionId = association.sessionId;
    const identities = this.#sessions.get(association.sessionId) ?? new Set<string>();
    identities.add(checkpoint.identity);
    this.#sessions.set(association.sessionId, identities);
  }

  #removeSession({ identity, sessionId }: IndexedCheckpoint): void {
    if (sessionId === undefined) return;
    const identities = this.#sessions.get(sessionId);
    identities?.delete(identity);
    if (identities?.size === 0) this.#sessions.delete(sessionId);
  }

  #invalidate(checkpoint: SourceCheckpoint): void {
    this.#headers.delete(checkpoint.identity);
    const indexed = this.#indexed.get(checkpoint.identity);
    if (indexed) indexed.key = undefined;
  }

  async #candidate(checkpoint: SourceCheckpoint, roots: readonly string[]): Promise<Candidate | undefined> {
    if (!checkpoint.path.endsWith('.jsonl')) return undefined;
    try {
      const { handle, stat } = await openSource(checkpoint.path, roots);
      try {
        const saved = { identity: checkpoint.identity, size: checkpoint.size, mtimeMs: checkpoint.mtimeMs, headHash: checkpoint.headHash, headBytes: Math.min(512, checkpoint.size) };
        await validateTranscriptSource(handle, stat, saved);
        const key = JSON.stringify([checkpoint.identity, checkpoint.generation, checkpoint.path, roots, checkpoint.headHash]);
        const association = await this.#association(checkpoint.identity, key, handle, stat);
        this.#associate(checkpoint, association);
        return { sessionId: association.sessionId, source: {
          path: checkpoint.path, roots, version: { ...saved, size: stat.size, mtimeMs: stat.mtimeMs }, epoch: `${association.key}:${association.revision}`,
        } };
      } finally { await handle.close(); }
    } catch (error) {
      // Keep the learnt candidate membership so temporary failures cannot hide a duplicate on later accesses.
      this.#invalidate(checkpoint);
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
