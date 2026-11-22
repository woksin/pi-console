import type { Marker } from '@pi-console/viewmodels';

/** Match the former first-match lookup even if a producer repeats an ID. */
export function indexMarkers(markers: readonly Marker[]): Map<string, Marker> {
  const indexed = new Map<string, Marker>();
  for (const marker of markers) {
    if (!indexed.has(marker.id)) indexed.set(marker.id, marker);
  }
  return indexed;
}
