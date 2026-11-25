import type { Marker, TimelineCell } from '@pi-console/viewmodels';

/** Alternate nearby glyphs above/below the lane without moving their time or hit box. Cells are in column order. */
export function offsetTimelineMarkers(cells: readonly TimelineCell[], cellWidth: number): (TimelineCell & { offsetY: number })[] {
  let previousOffset = 0;
  return cells.map((cell, index) => {
    const closeTo = (other: TimelineCell | undefined): boolean => other !== undefined && Math.abs(cell.column - other.column) * cellWidth < 10;
    const closeBefore = closeTo(cells[index - 1]);
    const clustered = closeBefore || closeTo(cells[index + 1]);
    const offsetY = clustered ? (closeBefore ? -previousOffset : -4) : 0;
    previousOffset = offsetY;
    return { ...cell, offsetY };
  });
}

/** Match the former first-match lookup even if a producer repeats an ID. */
export function indexMarkers(markers: readonly Marker[]): Map<string, Marker> {
  const indexed = new Map<string, Marker>();
  for (const marker of markers) {
    if (!indexed.has(marker.id)) indexed.set(marker.id, marker);
  }
  return indexed;
}
