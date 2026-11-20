export interface Refresher { request: () => void; stop: () => void }

/**
 * Runs `load` at most once per `interval` and never overlapping. A request that arrives while throttled or in flight is not dropped:
 * it is remembered and served by one trailing load, so the last event always ends in a fresh read.
 */
export function throttled(load: () => Promise<void>, interval: number): Refresher {
  let running = false;
  let pending = false;
  let stopped = false;
  let last = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const trailing = () => {
    if (!pending || stopped || running || timer) return;
    timer = setTimeout(() => { timer = undefined; request(); }, Math.max(0, last + interval - Date.now()));
  };
  const request = () => {
    if (stopped) return;
    pending = true;
    if (running || Date.now() - last < interval) { trailing(); return; }
    pending = false;
    running = true;
    load().catch(() => undefined).finally(() => { running = false; last = Date.now(); trailing(); });
  };
  return { request, stop: () => { stopped = true; if (timer) clearTimeout(timer); timer = undefined; } };
}
