import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Health } from '@pi-console/contract';

/** Process event-loop delay since daemon startup, in milliseconds; reading never resets the histogram. */
export class EventLoopHealth {
  readonly #histogram = monitorEventLoopDelay({ resolution: 5 });

  constructor() {
    this.#histogram.enable();
  }

  read(): Health['eventLoop'] {
    const histogram = this.#histogram;
    if (histogram.count === 0) return { p50: 0, p99: 0, max: 0 };
    return { p50: histogram.percentile(50) / 1e6, p99: histogram.percentile(99) / 1e6, max: histogram.max / 1e6 };
  }

  close(): void {
    this.#histogram.disable();
  }
}
