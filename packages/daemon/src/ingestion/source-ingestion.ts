import { statSync } from 'node:fs';
import type { EventLog } from '@pi-console/contract';
import { FileTailer, pollSnapshot, type AdapterWorker, type TailerOptions } from '@pi-console/adapters';
import { CheckpointCache } from './checkpoint-cache.ts';
import { discoverFilesSliced, type Feed } from './source-table.ts';
import type { SourceId } from './source-ids.ts';
import { seekStart, windowed } from './window.ts';
import { yieldToLoop } from './yield-to-loop.ts';

export interface SourceStatus {
  source: string;
  files: number;
  lagBytes: number;
  lastPollAt: string | null;
  /** Files that failed in the last poll (unreadable, or the log refused the batch). Never carries text or paths. */
  errors: number;
}

export interface SourceIngestionOptions {
  id: SourceId;
  feeds: readonly Feed[];
  backfillWindowDays: number;
  now?: () => Date;
}

/** Small batches: one append transaction stays in the tens of milliseconds, so the event loop is never held long. */
const batchBytes = 64 * 1024;
/** A record longer than the batch grows it, doubling up to the tailer default; a larger record is counted as a file error. */
const maxBatchBytes = 1024 * 1024;
const oversizeRecord = (error: unknown): boolean => error instanceof Error && error.message.startsWith('Source record exceeds batch limit');

async function filesFor(feed: Feed, since: number): Promise<string[]> {
  const files: string[] = [];
  for (const directory of feed.directories) files.push(...await discoverFilesSliced(directory, feed, since));
  return files;
}

interface Seen { mtimeMs: number; size: number }

const timeOfRow = (key: string) => (line: string): number => Date.parse(String((JSON.parse(line) as Record<string, unknown>)[key]));

/**
 * One source's files, read through the P2 adapters: read-only, scoped to the feed directories, checkpointed in the
 * event log (so a restart resumes without duplicates). A file that fails is counted and skipped; the others still
 * deliver. A failure that is not about one file (an unreadable directory) throws so the supervisor backs off.
 *
 * Bounded work: a file whose mtime and size are unchanged since it was last read is not opened again, tail files are
 * opened only while they have unread bytes, checkpoints are read from the log once, and the event loop is yielded to
 * after every batch and snapshot so the API stays responsive during a large first pass. `abort()` ends a poll at the
 * next such point.
 */
export class SourceIngestion implements AdapterWorker {
  readonly #log: EventLog;
  readonly #options: SourceIngestionOptions;
  readonly #seen = new Map<string, Seen>();
  #aborted = false;
  #status: SourceStatus;

  constructor(log: EventLog, options: SourceIngestionOptions) {
    this.#log = new CheckpointCache(log);
    this.#options = options;
    this.#status = { source: options.id, files: 0, lagBytes: 0, lastPollAt: null, errors: 0 };
  }

  get status(): SourceStatus {
    return { ...this.#status };
  }

  async poll(): Promise<void> {
    const now = (this.#options.now ?? (() => new Date()))();
    const since = now.getTime() - this.#options.backfillWindowDays * 86_400_000;
    const totals = { files: 0, lagBytes: 0, errors: 0 };
    for (const feed of this.#options.feeds) {
      const files = await filesFor(feed, since);
      totals.files += files.length;
      for (const file of files) {
        if (this.#aborted) return;
        try {
          totals.lagBytes += await this.#pollFile(feed, file, since);
        } catch {
          totals.errors++;
        }
        this.#status = { ...this.#status, ...totals };
        await yieldToLoop();
      }
    }
    this.#status = { source: this.#options.id, ...totals, lastPollAt: now.toISOString() };
  }

  async #pollFile(feed: Feed, file: string, since: number): Promise<number> {
    const stat = statSync(file);
    const seen = this.#seen.get(file);
    if (seen?.mtimeMs === stat.mtimeMs && seen.size === stat.size) return 0;
    const lagBytes = feed.kind === 'snapshot' ? await this.#snapshot(feed, file) : await this.#tail(feed, file, since);
    this.#seen.set(file, { mtimeMs: stat.mtimeMs, size: stat.size });
    return lagBytes;
  }

  async #snapshot(feed: Feed, file: string): Promise<number> {
    await pollSnapshot(this.#log, this.#options.id, file, feed.mapper, { roots: feed.directories, decode: feed.decode });
    return 0;
  }

  /** Reads at the pacing batch size; a single record that does not fit retries with a larger batch. */
  async #tail(feed: Feed, file: string, since: number): Promise<number> {
    for (let size = batchBytes; ; size *= 2) {
      try {
        return await this.#tailBatches(feed, file, since, size);
      } catch (error) {
        if (!oversizeRecord(error) || size >= maxBatchBytes) throw error;
      }
    }
  }

  /** Reads batches until caught up (or no longer progressing on an unterminated last line); returns the unread bytes. */
  async #tailBatches(feed: Feed, file: string, since: number, size: number): Promise<number> {
    const tailer = new FileTailer(this.#log, this.#options.id, feed.filterBy ? windowed(feed.mapper, feed.filterBy, since) : feed.mapper, tailerOptions(feed, since, size));
    try {
      let lag = Number.POSITIVE_INFINITY;
      for (let result = await tailer.poll([file]); !this.#aborted; result = await tailer.poll([file])) {
        const progressed = result.lagBytes < lag;
        lag = result.lagBytes;
        if (lag === 0 || !progressed) break;
        await yieldToLoop();
      }
      return lag;
    } finally {
      tailer.close();
    }
  }

  abort(): void {
    this.#aborted = true;
  }

  close(): void {
    this.#aborted = true;
    this.#seen.clear();
  }
}

function tailerOptions(feed: Feed, since: number, size: number): TailerOptions {
  const { seekBy, lineFilter } = feed;
  return {
    batchBytes: size,
    startOffset: seekBy ? (fd, size) => seekStart(fd, size, since, timeOfRow(seekBy)) : undefined,
    lineFilter: lineFilter ? line => line.includes(lineFilter) : undefined,
  };
}
