import { existsSync } from 'node:fs';
import type { EventLog } from '@pi-console/contract';
import { discover, sessionTailer, type FileTailer } from '@pi-console/adapters';

export interface SourceStatus { source: string; files: number; lagBytes: number; lastPollAt: string | null }

export interface IngestionOptions {
  /** Directories searched recursively for pi session JSONL files. */
  roots: readonly string[];
  backfillWindowDays: number;
  pollMs: number;
  now?: () => Date;
}

/**
 * Polls pi session files through the P2 adapters (read-only, checkpointed, redacted at ingestion). One tailer per
 * file; a file that cannot be read is skipped and retried on the next poll, never fatal for the daemon.
 */
export class SessionIngestion {
  readonly #log: EventLog;
  readonly #options: IngestionOptions;
  readonly #tailers = new Map<string, FileTailer>();
  #timer: NodeJS.Timeout | undefined;
  #status: SourceStatus = { source: 'session-jsonl', files: 0, lagBytes: 0, lastPollAt: null };
  #polls = 0;
  #running: Promise<void> | undefined;
  #stopped = false;
  #started = false;

  constructor(log: EventLog, options: IngestionOptions) {
    this.#log = log;
    this.#options = options;
  }

  get status(): SourceStatus {
    return { ...this.#status };
  }

  /** True once every file in the backfill window has been read once (trivially true when ingestion never started). */
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
    for (const tailer of this.#tailers.values()) tailer.close();
    this.#tailers.clear();
  }

  /** One pass over every discovered file. */
  async poll(): Promise<void> {
    const now = (this.#options.now ?? (() => new Date()))();
    const since = now.getTime() - this.#options.backfillWindowDays * 86_400_000;
    const paths = this.#options.roots.filter(root => existsSync(root)).flatMap(root => discover(root, since));
    let lagBytes = 0;
    for (const path of paths) lagBytes += await this.#pollFile(path);
    this.#polls++;
    this.#status = { source: 'session-jsonl', files: this.#tailers.size, lagBytes, lastPollAt: now.toISOString() };
  }

  async #pollFile(path: string): Promise<number> {
    try {
      let tailer = this.#tailers.get(path);
      if (!tailer) {
        tailer = sessionTailer(this.#log, path);
        this.#tailers.set(path, tailer);
      }
      return (await tailer.poll([path])).lagBytes;
    } catch {
      return 0;
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
