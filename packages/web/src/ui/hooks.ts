import { useEffect, useRef, useState } from 'react';

/** True for `ms` after `value` changes (not on first render): drives the brief highlight on rows whose status changed. */
export function useChangeFlash(value: string, ms = 1400): boolean {
  const previous = useRef(value);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (previous.current === value) return undefined;
    previous.current = value;
    setFlash(true);
    const timer = window.setTimeout(() => { setFlash(false); }, ms);
    return () => { window.clearTimeout(timer); };
  }, [value, ms]);
  return flash;
}

/** Keeps the selected element in view as the keyboard moves it. */
export function useScrollIntoView<T extends HTMLElement>(active: boolean): React.RefObject<T | null> {
  const ref = useRef<T | null>(null);
  useEffect(() => { if (active) ref.current?.scrollIntoView({ block: 'nearest' }); }, [active]);
  return ref;
}

/** Wall-clock time that re-renders its component every `ms`: ages and the stale banner stay honest between events. */
export function useTick(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => { setNow(Date.now()); }, ms); return () => { window.clearInterval(timer); }; }, [ms]);
  return now;
}
