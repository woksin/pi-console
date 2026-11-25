import { clip, glyphs, type Marker } from '@pi-console/viewmodels';

export function TimelineMarker({ marker, lane, x, cellWidth, offsetY = 0, selected, onSelect }: { marker: Marker; lane: string; x: number; cellWidth: number; offsetY?: number; selected: boolean; onSelect: () => void }) {
  const bounds = { x: x - cellWidth / 2, y: 3, width: cellWidth, height: 24 };
  const label = `${marker.kind} · ${lane} (${marker.sessionId}) · ${new Date(marker.at).toISOString()} · ${clip(marker.text, 160)}`;
  return (
    <g className="timeline-marker" role="button" tabIndex={0} aria-label={label} aria-pressed={selected} aria-controls={selected ? 'timeline-event-detail' : undefined}
      onClick={onSelect} onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect();
      }}>
      <title>{marker.text}</title>
      <rect className="marker-hit" {...bounds} fill="transparent" pointerEvents="all" aria-hidden="true" />
      <rect className="marker-ring" {...bounds} rx={2} pointerEvents="none" aria-hidden="true" />
      <text className={`mark tone-${marker.color}${marker.glyph === glyphs.reset ? ' mark-reset' : ''}`} x={x} y={20 + offsetY} textAnchor="middle" pointerEvents="none" aria-hidden="true">{marker.glyph}</text>
    </g>
  );
}
