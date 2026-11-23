import { useEffect, useRef, useState } from 'react';
import { boundaryTab, focusRequested, focusStaysIn, rowOf, type FocusRequest } from './virtual-dom.ts';
import type { Geometry } from './virtual-geometry.ts';

/** Re-measures on scroll and on container or table resizes. */
export function useScrollObservers(body: HTMLTableSectionElement | null, update: () => void): void {
  useEffect(() => {
    if (!body) return undefined;
    const container = body.closest<HTMLElement>('.content');
    let frame = 0;
    const schedule = (): void => { if (frame === 0) frame = requestAnimationFrame(() => { frame = 0; update(); }); };
    const target: HTMLElement | Window = container ?? window;
    target.addEventListener('scroll', schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container ?? document.documentElement);
    if (body.parentElement) observer.observe(body.parentElement);
    return () => { target.removeEventListener('scroll', schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [body, update]);
}

/** Pins the focused row so scrolling never unmounts it, and carries Tab across unmounted rows. */
export function useRowFocus(geometry: Geometry, scrollToIndex: (index: number) => void) {
  const [focused, setFocused] = useState<number | null>(null);
  const pending = useRef<FocusRequest | null>(null);
  const latest = useRef(geometry);
  latest.current = geometry;
  const handlers = {
    onFocus: (event: React.FocusEvent<HTMLElement>): void => {
      pending.current = null;
      const row = rowOf(event.target);
      setFocused(row ? Number(row.dataset.vindex) : null);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>): void => { if (!focusStaysIn(event)) setFocused(null); },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>): void => {
      const request = boundaryTab(event, latest.current.count);
      if (!request) return;
      event.preventDefault();
      pending.current = request;
      scrollToIndex(request.index);
    },
  };
  const flush = (body: HTMLElement | null): void => {
    const request = pending.current;
    if (!body || !request) return;
    if (focusRequested(body, request)) pending.current = null;
  };
  return { focused, handlers, flush };
}
