import type { EventLog } from '@pi-console/contract';
import { FileTailer, pollSnapshot, type AdapterWorker } from '@pi-console/adapters';
import { discoverFiles, type Feed } from './source-table.ts';
import type { SourceId } from './source-ids.ts';

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

/**
 * One source's files, read through the P2 adapters: read-only, scoped to the feed directories, checkpointed in the
 * event log (so a restart resumes without duplicates). A file that fails is counted and skipped; the others still
 * deliver. A failure that is not about one file (an unreadable directory) throws so the supervisor backs off.
 */
export class SourceIngestion implements AdapterWorker {
  readonly #log: EventLog;
  readonly #options: SourceIngestionOptions;
  readonly #tailers = new Map<string, FileTailer>();
  #status: SourceStatus;

  constructor(log: EventLog, options: SourceIngestionOptions) {
    this.#log = log;
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
      const files = feed.directories.flatMap(directory => discoverFiles(directory, feed.extension, since));
      totals.files += files.length;
      for (const file of files) {
        try {
          totals.lagBytes += await this.#pollFile(feed, file);
        } catch {
          totals.errors++;
        }
      }
    }
    this.#status = { source: this.#options.id, ...totals, lastPollAt: now.toISOString() };
  }

  async #pollFile(feed: Feed, file: string): Promise<number> {
    const { id } = this.#options;
    if (feed.kind === 'snapshot') {
      await pollSnapshot(this.#log, id, file, feed.mapper, { roots: feed.directories });
      return 0;
    }
    let tailer = this.#tailers.get(file);
    if (!tailer) {
      tailer = new FileTailer(this.#log, id, feed.mapper);
      this.#tailers.set(file, tailer);
    }
    return (await tailer.poll([file])).lagBytes;
  }

  close(): void {
    for (const tailer of this.#tailers.values()) tailer.close();
    this.#tailers.clear();
  }
}
