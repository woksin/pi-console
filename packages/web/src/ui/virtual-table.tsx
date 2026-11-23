import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bodyView, boundaryTab, focusRequested, measuredHeights, rowOf, type FocusRequest } from './virtual-dom.ts';
import { clampRange, createGeometry, planSegments, revealOffset, sameRange, visibleRange, type Geometry, type Range, type Segment } from './virtual-geometry.ts';

export interface VirtualTable {
  /** Spread onto the `<tbody>`: tracks the scroll container, the focused row and boundary Tab navigation. */
  bodyProps: { ref: (element: HTMLTableSectionElement | null) => void; onFocus: (event: React.FocusEvent<HTMLElement>) => void; onBlur: (event: React.FocusEvent<HTMLElement>) => void; onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void };
  /** Mounted rows and the `aria-hidden` spacers standing in for the rest, in document order. */
  segments: readonly Segment[];
  /** Total logical rows, for `aria-rowcount` (add one for the header). */
  count: number;
  /** Attributes every mounted row carries: its logical index and kind, and its `aria-rowindex` (the header is row 1). */
  rowAttributes: (index: number) => { 'data-vindex': number; 'data-vkind': number; 'aria-rowindex': number };
  /** Reveals a logical row, mounted or not, with the least scrolling. */
  scrollToIndex: (index: number) => void;
}

export type VirtualRowAttributes = ReturnType<VirtualTable['rowAttributes']>;

const movesWithin = (event: React.FocusEvent<HTMLElement>): boolean => event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget);

/** Re-measures on scroll and on container or table resizes. */
function useScrollObservers(body: HTMLTableSectionElement | null, update: () => void): void {
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
function useRowFocus(geometry: Geometry, scrollToIndex: (index: number) => void) {
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
    onBlur: (event: React.FocusEvent<HTMLElement>): void => {
      if (!movesWithin(event)) setFocused(null);
    },
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

/**
 * Windowing for a native table body whose page scroll container is `.content`. `kinds[i]` is row i's kind (an index into the
 * measured heights); only rows within the viewport, a little overscan and the focused row are mounted.
 */
export function useVirtualTable(options: { kinds: ArrayLike<number>; fallbackHeights: readonly number[]; overscan?: number }): VirtualTable {
  const { kinds, fallbackHeights, overscan = 5 } = options;
  const bodyRef = useRef<HTMLTableSectionElement | null>(null);
  const [body, setBody] = useState<HTMLTableSectionElement | null>(null);
  const [heights, setHeights] = useState(fallbackHeights);
  const [range, setRange] = useState<Range>({ start: 0, end: Math.min(kinds.length, 40) });
  const geometry = useMemo(() => createGeometry(kinds, heights), [kinds, heights]);
  const latest = useRef({ geometry, overscan });
  latest.current = { geometry, overscan };

  const update = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    setHeights(current => measuredHeights(element, current));
    const view = bodyView(element);
    const next = visibleRange(latest.current.geometry, view.scroll, view.scroll + view.viewport, latest.current.overscan);
    setRange(current => (sameRange(current, next) ? current : next));
  }, []);

  const scrollToIndex = useCallback((index: number) => {
    const element = bodyRef.current;
    if (!element) return;
    const view = bodyView(element);
    const target = revealOffset(latest.current.geometry, index, view);
    if (target === view.scroll) return;
    view.container.scrollTop = index === 0 ? 0 : view.bodyTop + target;
    update();
  }, [update]);

  const rowFocus = useRowFocus(geometry, scrollToIndex);
  useLayoutEffect(() => { update(); rowFocus.flush(bodyRef.current); });
  useScrollObservers(body, update);
  const segments = useMemo(() => planSegments(geometry, clampRange(range, geometry.count), rowFocus.focused), [geometry, range, rowFocus.focused]);
  const ref = useCallback((element: HTMLTableSectionElement | null) => { bodyRef.current = element; setBody(element); }, []);

  return {
    bodyProps: { ref, ...rowFocus.handlers }, segments, count: geometry.count, scrollToIndex,
    rowAttributes: index => ({ 'data-vindex': index, 'data-vkind': kinds[index], 'aria-rowindex': index + 2 }),
  };
}

/** A zero-content row that stands in for unmounted rows; hidden from assistive technology because the table's `aria-rowcount` carries the size. */
export function SpacerRow({ height, columns }: { height: number; columns: number }) {
  return <tr className="virtual-spacer" aria-hidden="true" style={{ height }}><td colSpan={columns} /></tr>;
}
