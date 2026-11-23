import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { bodyView, measuredHeights } from './virtual-dom.ts';
import type { VirtualTable } from './virtual-types.ts';
import { useRowFocus, useScrollObservers } from './virtual-hooks.ts';
import { clampRange, createGeometry, planSegments, revealOffset, sameRange, visibleRange, type Range } from './virtual-geometry.ts';
export type { VirtualRowAttributes, VirtualTable } from './virtual-types.ts';

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
