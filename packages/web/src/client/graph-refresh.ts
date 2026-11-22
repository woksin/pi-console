import type { Event } from '@pi-console/contract';
import type { Clock } from './store.ts';

const graphEvents = new Set<Event['type']>(['snapshot', 'message.sent', 'session.updated']);
const interval = 2000;

/** TUI policy: non-overlapping event reads, with one trailing read two seconds after the previous load finishes. */
export class GraphRefreshController {
  #running: Promise<void> | null = null;
  #pending = false;
  #stopped = false;
  #last = Number.NEGATIVE_INFINITY;
  #timer: number | null = null;
  readonly #load: () => Promise<void>;
  readonly #clock: Clock;

  constructor(load: () => Promise<void>, clock: Clock) { this.#load = load; this.#clock = clock; }

  request(type?: Event['type']): void {
    if (this.#stopped) return;
    if (type !== undefined && !graphEvents.has(type)) return;
    this.#pending = true;
    if (this.#running || this.#clock.now() - this.#last < interval) this.#trailing();
    else void this.#run();
  }

  /** Deliberate refreshes need not wait for the event throttle, but still share an in-flight read. */
  refresh(): Promise<void> {
    if (this.#stopped) return Promise.resolve();
    if (this.#running) return this.#running;
    this.#clearTimer();
    return this.#run();
  }

  #run(): Promise<void> {
    this.#pending = false;
    this.#running = this.#load().catch(() => undefined).finally(() => {
      this.#running = null;
      this.#last = this.#clock.now();
      this.#trailing();
    });
    return this.#running;
  }

  #trailing(): void {
    if (!this.#pending || this.#stopped) return;
    if (this.#running || this.#timer !== null) return;
    this.#timer = this.#clock.setTimeout(() => { this.#timer = null; this.request(); }, Math.max(0, this.#last + interval - this.#clock.now()));
  }

  #clearTimer(): void {
    if (this.#timer !== null) this.#clock.clearTimeout(this.#timer);
    this.#timer = null;
  }

  dispose(): void { this.#stopped = true; this.#clearTimer(); }
}
