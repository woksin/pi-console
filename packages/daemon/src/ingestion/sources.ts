import type { EventLog } from '@pi-console/contract';
import { AdapterSupervisor, type AdapterWorker } from '@pi-console/adapters';
import { SourceIngestion, type SourceStatus } from './source-ingestion.ts';
import { sourceTable, type SourceRoots } from './source-table.ts';
import type { SourceId } from './source-ids.ts';

export interface SourceWorker extends AdapterWorker { readonly status?: SourceStatus }
export interface SourceEntry { id: SourceId; worker: () => SourceWorker }
export interface SourceSetOptions { intervalMs: number; onError?: (source: SourceId, error: unknown) => void }

interface Slot { entry: SourceEntry; supervisor: AdapterSupervisor; worker?: SourceWorker; settled: boolean; failing: number }

/**
 * One `AdapterSupervisor` per source: each has its own timer, worker, checkpoints and backoff, so one source that
 * fails or stalls never delays another once running. They start one after another in table order (each when the
 * previous has settled) and only after the caller's gate opens (the session first pass), so the first pass of every
 * source never competes with another for the single write lock. `statuses()` feeds `/health` (lag and error counts,
 * never error text).
 */
export class SourceSet {
  readonly #slots: Slot[];
  readonly #waitMs: number;
  #started = false;
  #stopped = false;
  #chain: Promise<void> = Promise.resolve();
  #wake?: () => void;

  constructor(entries: readonly SourceEntry[], options: SourceSetOptions) {
    this.#slots = entries.map(entry => this.#slot(entry, options));
    this.#waitMs = Math.min(250, options.intervalMs);
  }

  #slot(entry: SourceEntry, options: SourceSetOptions): Slot {
    const slot = { entry, settled: false, failing: 0 } as Slot;
    const factory = (): AdapterWorker => {
      const worker = entry.worker();
      slot.worker = worker;
      return {
        poll: async () => { await worker.poll(); slot.settled = true; slot.failing = 0; },
        close: () => { slot.worker = undefined; return worker.close(); },
        abort: () => { worker.abort?.(); },
      };
    };
    slot.supervisor = new AdapterSupervisor(factory, {
      intervalMs: options.intervalMs,
      onError: error => { slot.failing++; slot.settled = true; options.onError?.(entry.id, error); },
    });
    return slot;
  }

  /** True once every source has polled once, or failed once (a source that cannot start must not hold back `ok`); trivially true when never started. */
  get backfillComplete(): boolean {
    return !this.#started || this.#slots.every(slot => slot.settled);
  }

  /** Starts the sources in order once `ready()` is true (immediately by default); returns without waiting. */
  start(ready: () => boolean = () => true): void {
    this.#started = true;
    this.#chain = this.#startInOrder(ready);
  }

  async #startInOrder(ready: () => boolean): Promise<void> {
    while (!this.#stopped && !ready()) await this.#sleep();
    for (const slot of this.#slots) {
      if (this.#stopped) return;
      slot.supervisor.start();
      while (!slot.settled && !this.#isStopped()) await this.#sleep();
    }
  }

  #isStopped(): boolean {
    return this.#stopped;
  }

  #sleep(): Promise<void> {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, this.#waitMs);
      this.#wake = () => { clearTimeout(timer); resolve(); };
    });
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#wake?.();
    await this.#chain;
    await Promise.allSettled(this.#slots.map(slot => slot.supervisor.stop()));
  }

  statuses(): SourceStatus[] {
    return this.#slots.map(({ entry, worker, failing }) => {
      const status = worker?.status ?? { source: entry.id, files: 0, lagBytes: 0, lastPollAt: null, errors: 0 };
      return { ...status, source: entry.id, errors: status.errors + failing };
    });
  }
}

export interface SourceSetConfig extends SourceRoots {
  sources: Record<SourceId, boolean>;
  sourcePollMs: number;
  backfillWindowDays: number;
}

/** The enabled sources of the table, each as its own supervised `SourceIngestion`. */
export function sourceSetFor(log: EventLog, config: SourceSetConfig, now?: () => Date): SourceSet {
  const entries = sourceTable(config).filter(spec => config.sources[spec.id]).map(spec => ({
    id: spec.id,
    worker: () => new SourceIngestion(log, { id: spec.id, feeds: spec.feeds, backfillWindowDays: config.backfillWindowDays, now }),
  }));
  return new SourceSet(entries, { intervalMs: config.sourcePollMs });
}
