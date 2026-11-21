/** Resume ingestion on a macrotask so HTTP, timers and projection delivery can run. */
export const yieldToLoop = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
