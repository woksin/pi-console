export interface Refresher { request: () => void; stop: () => void }
export interface ConnectedRefresher extends Refresher { setConnected: (connected: boolean) => void }

/** Periodic requests share the event throttle and exist only while connected. */
export function pollWhileConnected(refresher: Refresher, interval: number): ConnectedRefresher {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  const setConnected = (connected: boolean) => {
    clearInterval(timer);
    timer = undefined;
    if (!connected || stopped) return;
    timer = setInterval(refresher.request, interval);
    refresher.request();
  };
  const stop = () => { stopped = true; setConnected(false); refresher.stop(); };
  return { request: refresher.request, setConnected, stop };
}

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

  const mustWait = () => running || Date.now() - last < interval;
  const canSchedule = () => pending && !stopped && !running && !timer;
  const trailing = () => {
    if (!canSchedule()) return;
    timer = setTimeout(() => { timer = undefined; request(); }, Math.max(0, last + interval - Date.now()));
  };
  const finish = () => { running = false; last = Date.now(); trailing(); };
  const start = () => {
    pending = false;
    running = true;
    load().catch(() => undefined).finally(finish);
  };
  const request = () => {
    if (stopped) return;
    pending = true;
    if (mustWait()) trailing();
    else start();
  };
  const stop = () => { stopped = true; clearTimeout(timer); timer = undefined; };
  return { request, stop };
}
