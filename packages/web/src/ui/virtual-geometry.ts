/** Row geometry for a virtualized table body: one shared model for visible ranges, spacers and reveal offsets. */
export interface Geometry {
  readonly count: number;
  readonly total: number;
  /** `offsets[i]` is the top of row `i`; `offsets[count]` is the body height. */
  readonly offsets: Float64Array;
}
/** Half-open row range. */
export interface Range { readonly start: number; readonly end: number }
export type Segment = { readonly kind: 'spacer'; readonly height: number } | { readonly kind: 'row'; readonly index: number };

/** Builds offsets from each row's kind (an index into `heights`), so mixed row heights cost one number per row. */
export function createGeometry(kinds: ArrayLike<number>, heights: readonly number[]): Geometry {
  const offsets = new Float64Array(kinds.length + 1);
  for (let index = 0; index < kinds.length; index += 1) offsets[index + 1] = offsets[index] + (heights[kinds[index]] ?? 0);
  return { count: kinds.length, total: offsets[kinds.length], offsets };
}

/** The row containing body offset `y`, clamped to the list (0 when empty). */
export function indexAt(geometry: Geometry, y: number): number {
  let low = 0;
  let high = Math.max(0, geometry.count - 1);
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (geometry.offsets[middle] <= y) low = middle; else high = middle - 1;
  }
  return low;
}

/** Rows intersecting the body window `[top, bottom)` plus `overscan` rows each side, clamped to the list. */
export function visibleRange(geometry: Geometry, top: number, bottom: number, overscan: number): Range {
  if (geometry.count === 0) return { start: 0, end: 0 };
  const first = indexAt(geometry, Math.max(0, top));
  const last = indexAt(geometry, Math.max(0, bottom - 1));
  return { start: Math.max(0, first - overscan), end: Math.min(geometry.count, last + 1 + overscan) };
}

export const clampRange = (range: Range, count: number): Range => {
  const end = Math.min(count, range.end);
  return { start: Math.min(range.start, end), end };
};

export const sameRange = (a: Range, b: Range): boolean => a.start === b.start && a.end === b.end;

/** The row ranges to mount, in order: the range plus the pinned row when it lies outside it. */
function mountedPieces(count: number, range: Range, pinned: number | null): Range[] {
  const outside = pinned !== null && pinned >= 0 && pinned < count && (pinned < range.start || pinned >= range.end);
  if (!outside) return [range];
  const pin = { start: pinned, end: pinned + 1 };
  return pinned < range.start ? [pin, range] : [range, pin];
}

/** Mounted rows and the spacers standing in for the rest; an optional pinned row (the focused one) stays mounted outside the range. */
export function planSegments(geometry: Geometry, range: Range, pinned: number | null): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;
  const spacer = (height: number): void => { if (height > 0) segments.push({ kind: 'spacer', height }); };
  for (const piece of mountedPieces(geometry.count, range, pinned)) {
    spacer(geometry.offsets[piece.start] - geometry.offsets[cursor]);
    for (let index = piece.start; index < piece.end; index += 1) segments.push({ kind: 'row', index });
    cursor = piece.end;
  }
  spacer(geometry.total - geometry.offsets[cursor]);
  return segments;
}

/** The scroll container's window over the body: scroll offset, viewport height and the sticky header `inset` covering its top. */
export interface ScrollView { scroll: number; viewport: number; inset: number }

/**
 * The body scroll offset that brings `index` into the window `[scroll + inset, scroll + viewport]` with the least movement;
 * unchanged when the row is already visible.
 */
export function revealOffset(geometry: Geometry, index: number, view: ScrollView): number {
  const row = Math.max(0, Math.min(geometry.count - 1, index));
  const top = geometry.offsets[row];
  const bottom = geometry.offsets[row + 1];
  if (top < view.scroll + view.inset) return top - view.inset;
  if (bottom > view.scroll + view.viewport) return bottom - view.viewport;
  return view.scroll;
}

/** The current index of a row identified by its stable key, or null when the key is unset or its row is gone (the pin is then dropped). */
export function resolvePinned(indexOfKey: ReadonlyMap<string, number>, key: string | null): number | null {
  return key === null ? null : indexOfKey.get(key) ?? null;
}
