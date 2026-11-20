export interface AdapterWorker {
  poll(): Promise<unknown>;
  close(): void | Promise<void>;
  /** Asked to stop early, while a poll may be running; the poll should return at its next safe point. */
  abort?(): void;
}
export interface SupervisorOptions {
  intervalMs?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  onError?: (error: unknown, retryMs: number) => void;
}

/** Recreate workers after failure; durable checkpoints belong to the injected EventLog. */
export class AdapterSupervisor {
  private timer?: ReturnType<typeof setTimeout>;
  private worker?: AdapterWorker;
  private active = false;
  private pending: Promise<void> = Promise.resolve();
  private failures = 0;
  private readonly factory: () => AdapterWorker;
  private readonly options: SupervisorOptions;

  constructor(factory: () => AdapterWorker, options: SupervisorOptions = {}) {
    this.factory = factory;
    this.options = options;
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    this.schedule(0);
  }

  async stop(): Promise<void> {
    this.active = false;
    clearTimeout(this.timer);
    this.worker?.abort?.();
    await this.pending;
    await this.closeWorker();
  }

  async restart(): Promise<void> {
    await this.stop();
    this.failures = 0;
    this.start();
  }

  private schedule(delay: number): void {
    if (!this.active) return;
    this.timer = setTimeout(() => { this.pending = this.tick(); }, delay);
  }

  private async closeWorker(): Promise<void> {
    const worker = this.worker;
    this.worker = undefined;
    await worker?.close();
  }

  private async tick(): Promise<void> {
    let delay = this.options.intervalMs ?? 1000;
    try {
      this.worker ??= this.factory();
      await this.worker.poll();
      this.failures = 0;
    } catch (error) {
      this.failures++;
      delay = Math.min(this.options.maxBackoffMs ?? 30_000, (this.options.backoffMs ?? 250) * 2 ** Math.min(this.failures - 1, 16));
      try { await this.closeWorker(); } catch { /* The next worker resumes committed state. */ }
      this.options.onError?.(error, delay);
    }
    this.schedule(delay);
  }
}
