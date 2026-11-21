const waiting: (() => void)[] = [];
let scheduled = false;

/** Resumes the oldest waiter; its slice runs in this callback's microtasks, and the next waiter gets a later loop turn. */
function resumeOne(): void {
  waiting.shift()?.();
  scheduled = waiting.length > 0;
  if (scheduled) setImmediate(resumeOne);
}

/**
 * Resume ingestion on a macrotask so HTTP, timers and projection delivery can run. Concurrent pipelines (sources,
 * sessions, discovery) take turns, one slice per event-loop iteration, so their slices never add up in one turn.
 */
export const yieldToLoop = (): Promise<void> => new Promise(resolve => {
  waiting.push(resolve);
  if (scheduled) return;
  scheduled = true;
  setImmediate(resumeOne);
});
