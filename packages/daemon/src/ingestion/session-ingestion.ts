import { statSync } from 'node:fs';
import type { EventLog, SourceCheckpoint } from '@pi-console/contract';
import { discover, sessionTailer } from '@pi-console/adapters';
import { yieldToLoop } from './yield-to-loop.ts';
import { SourceRoot } from './source-root.ts';

export interface SourceStatus { source: string; files: number; lagBytes: number; lastPollAt: string | null }

export interface IngestionOptions {
  /** Directories searched recursively for pi session JSONL files. */
  roots: readonly string[];
  backfillWindowDays: number;
  pollMs: number;
  now?: () => Date;
}

const source = 'session-jsonl';
/**
 * One batch is one map + append (one fsync) + projection chain, measured at about 6 ms per 256 KiB; a longer record
 * doubles the batch up to the budget. Smaller batches mostly add append transactions.
 */
const batchBytes = 256 * 1024;
/** Bytes one file may advance per poll (the former single batch), so backfill pacing across polls is unchanged. */
const pollBudgetBytes = 1024 * 1024;
/** Unchanged files cost a stat each; the loop is yielded to after this many of them in a row. */
const skippedPerYield = 64;
const oversizeRecord = (error: unknown): boolean => error instanceof Error && error.message.startsWith('Source record exceeds batch limit');

/**
 * True when the checkpoint already covers every byte of this exact file (same identity, size and mtime). Only metadata
 * is read; a file that is not caught up goes through the tailer, which canonicalises and checks the path before reading.
 */
function caughtUp(path: string, saved: ReadonlyMap<string, SourceCheckpoint>): boolean {
  const stat = statSync(path);
  const checkpoint = saved.get(`${stat.dev}:${stat.ino}:${stat.birthtimeMs}`);
  return checkpoint !== undefined && checkpoint.offset === checkpoint.size && checkpoint.size === stat.size && checkpoint.mtimeMs === stat.mtimeMs;
}

/**
 * Polls pi session files through the P2 adapters (read-only, checkpointed, redacted at ingestion). One tailer per
 * file; a file that cannot be read is skipped and retried on the next poll, never fatal for the daemon.
 *
 * Bounded work: a file its checkpoint already covers is not opened, reads go in small batches, and the event loop is
 * yielded to between batches and files, so the API stays responsive during a large backfill or a warm first pass.
 */
export class SessionIngestion {
  readonly #log: EventLog;
  readonly #options: IngestionOptions;
  readonly #roots: readonly SourceRoot[];
  readonly #files = new Set<string>();
  #timer: NodeJS.Timeout | undefined;
  #status: SourceStatus = { source: 'session-jsonl', files: 0, lagBytes: 0, lastPollAt: null };
  #polls = 0;
  #running: Promise<void> | undefined;
  #stopped = false;
  #started = false;

  constructor(log: EventLog, options: IngestionOptions) {
    this.#log = log;
    this.#options = options;
    this.#roots = options.roots.map(root => new SourceRoot(root));
  }

  get status(): SourceStatus {
    return { ...this.#status };
  }

  /** True once a first pass has finished, even a failed one (trivially true when ingestion never started). */
  get backfillComplete(): boolean {
    return !this.#started || this.#polls > 0;
  }

  start(): void {
    this.#started = true;
    this.#schedule(0);
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#timer);
    await this.#running;
  }

  /** One pass over every discovered file. */
  async poll(): Promise<void> {
    const now = (this.#options.now ?? (() => new Date()))();
    const since = now.getTime() - this.#options.backfillWindowDays * 86_400_000;
    let lagBytes = 0;
    try {
      const roots = this.#roots.flatMap(root => root.available() ?? []);
      const paths = roots.flatMap(root => discover(root, since));
      const saved = new Map((await this.#log.checkpoints(source)).map(checkpoint => [checkpoint.identity, checkpoint]));
      let skipped = 0;
      for (const path of paths) {
        if (this.#stopped) break;
        const lag = await this.#pollFile(path, saved);
        if (lag !== undefined) lagBytes += lag;
        if (lag !== undefined || ++skipped % skippedPerYield === 0) await yieldToLoop();
      }
    } finally {
      this.#polls++; // An unreadable directory is a finished attempt too: it must not hold the other sources back forever.
    }
    this.#status = { source: 'session-jsonl', files: this.#files.size, lagBytes, lastPollAt: now.toISOString() };
  }

  /** Unread bytes left in the file, or `undefined` when it was skipped without being opened. */
  async #pollFile(path: string, saved: ReadonlyMap<string, SourceCheckpoint>): Promise<number | undefined> {
    try {
      if (caughtUp(path, saved)) {
        this.#files.add(path);
        return undefined;
      }
      return await this.#tail(path);
    } catch {
      return 0;
    }
  }

  /** Reads at the pacing batch size; a single record that does not fit retries with a larger batch. */
  async #tail(path: string): Promise<number> {
    for (let size = batchBytes; ; size *= 2) {
      try {
        return await this.#tailBatches(path, size);
      } catch (error) {
        if (!oversizeRecord(error) || size >= pollBudgetBytes) throw error;
      }
    }
  }

  /** Reads up to the per-poll budget in batches (or until caught up or no longer progressing); returns the unread bytes. */
  async #tailBatches(path: string, size: number): Promise<number> {
    const tailer = sessionTailer(this.#log, path, { roots: this.#roots.flatMap(root => root.available() ?? []), batchBytes: size });
    this.#files.add(path);
    try {
      let lag = (await tailer.poll([path])).lagBytes;
      for (let batch = 1; batch < pollBudgetBytes / size && lag > 0 && !this.#stopped; batch++) {
        await yieldToLoop();
        const previous = lag;
        lag = (await tailer.poll([path])).lagBytes;
        if (lag >= previous) break;
      }
      return lag;
    } finally {
      await tailer.close();
    }
  }

  #schedule(delay: number): void {
    if (this.#stopped) return;
    this.#timer = setTimeout(() => {
      this.#running = this.poll().catch(() => undefined).finally(() => { this.#schedule(this.#options.pollMs); });
    }, delay);
    this.#timer.unref();
  }
}
