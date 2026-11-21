// Test support: separates work this thread did from time the host took away. A 1 ms timer chain marks one
// event-loop iteration per tick; each iteration's wall time and this thread's CPU time (`process.threadCpuUsage`,
// so libuv-pool and GC-helper threads do not count) are compared. Descheduling and concurrent spec processes add
// wall time but no CPU time, so the CPU figure measures what the daemon controls.
import { PerformanceObserver, type PerformanceEntry } from 'node:perf_hooks';

/** One iteration at or over the threshold in wall or CPU time; `gcMs` is main-thread GC pause time inside it. */
export interface LongTurn { startedAt: number; wallMs: number; cpuMs: number; gcMs: number }

export interface TurnSummary { turns: number; maxCpuMs: number; maxWallMs: number; long: LongTurn[] }

const cpuMs = (): number => {
  const usage = process.threadCpuUsage();
  return (usage.user + usage.system) / 1_000;
};

const overlap = (turn: LongTurn, entry: PerformanceEntry): number =>
  Math.max(0, Math.min(turn.startedAt + turn.wallMs, entry.startTime + entry.duration) - Math.max(turn.startedAt, entry.startTime));

export class LoopTurns {
  readonly #thresholdMs: number;
  readonly #long: LongTurn[] = [];
  readonly #gc: PerformanceEntry[] = [];
  readonly #observer = new PerformanceObserver(list => { this.#gc.push(...list.getEntries()); });
  #timer: ReturnType<typeof setTimeout> | undefined;
  #turns = 0;
  #maxCpuMs = 0;
  #maxWallMs = 0;
  #wall = 0;
  #cpu = 0;

  constructor(thresholdMs = 50) {
    this.#thresholdMs = thresholdMs;
  }

  start(): void {
    this.#observer.observe({ entryTypes: ['gc'] });
    this.#wall = performance.now();
    this.#cpu = cpuMs();
    this.#timer = setTimeout(this.#tick, 1);
  }

  /** Stops sampling; GC entries are delivered asynchronously, so read the summary after `stop`. */
  async stop(): Promise<TurnSummary> {
    clearTimeout(this.#timer);
    await new Promise(resolve => { setImmediate(resolve); });
    this.#observer.disconnect();
    const long = this.#long.map(turn => ({ ...turn, gcMs: this.#gc.reduce((sum, entry) => sum + overlap(turn, entry), 0) }));
    return { turns: this.#turns, maxCpuMs: this.#maxCpuMs, maxWallMs: this.#maxWallMs, long };
  }

  readonly #tick = (): void => {
    const wall = performance.now();
    const cpu = cpuMs();
    const turn = { startedAt: this.#wall, wallMs: wall - this.#wall, cpuMs: cpu - this.#cpu, gcMs: 0 };
    this.#turns++;
    this.#maxCpuMs = Math.max(this.#maxCpuMs, turn.cpuMs);
    this.#maxWallMs = Math.max(this.#maxWallMs, turn.wallMs);
    if (turn.wallMs >= this.#thresholdMs || turn.cpuMs >= this.#thresholdMs) this.#long.push(turn);
    this.#wall = wall;
    this.#cpu = cpu;
    this.#timer = setTimeout(this.#tick, 1);
  };
}

/** One line per long turn, for the spec log: CPU close to wall is our own work, CPU far below wall is descheduling. */
export const describeTurns = (summary: TurnSummary): string =>
  [`loop turns: ${summary.turns}, max cpu ${summary.maxCpuMs.toFixed(1)} ms, max wall ${summary.maxWallMs.toFixed(1)} ms, long ${summary.long.length}`,
    ...summary.long.map(turn => `  long turn: wall ${turn.wallMs.toFixed(1)} ms, cpu ${turn.cpuMs.toFixed(1)} ms, gc ${turn.gcMs.toFixed(1)} ms`)].join('\n');
