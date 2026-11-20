import { appendFileSync } from 'node:fs';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { CliRenderer } from '@opentui/core';
import type { Store } from './model.ts';

// Opt-in instrumentation for a real PTY run, never enabled in normal usage.
export function metrics(store: Store, renderer: CliRenderer) {
  const path = process.env.PI_CONSOLE_METRICS_FILE;
  if (!path) return;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let cpu = process.cpuUsage();
  let time = performance.now();
  let revision = store.state.revision;
  let frames = renderer.getStats().frameCount;
  setInterval(() => {
    const now = performance.now();
    const next = process.cpuUsage();
    const state = store.state;
    appendFileSync(path, JSON.stringify({
      seconds: now / 1000, cpuPercent: (next.user + next.system - cpu.user - cpu.system) / (now - time) / 10,
      rssMiB: process.memoryUsage.rss() / 1048576, loopP99Ms: lag.percentile(99) / 1000000,
      renderedFramesPerSecond: (renderer.getStats().frameCount - frames) / ((now - time) / 1000),
      updatesPerSecond: (state.revision - revision) / ((now - time) / 1000),
      received: state.received, retained: state.entries.get('s2')?.length ?? 0,
    }) + '\n');
    cpu = next; time = now; revision = state.revision; frames = renderer.getStats().frameCount; lag.reset();
  }, 1000).unref();
}
