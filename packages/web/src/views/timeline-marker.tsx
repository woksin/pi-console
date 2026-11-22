import { clip, type Marker } from '@pi-console/viewmodels';

export function TimelineMarker({ marker, lane, x, selected, onSelect }: { marker: Marker; lane: string; x: number; selected: boolean; onSelect: () => void }) {
  const label = `${marker.kind} · ${lane} (${marker.sessionId}) · ${new Date(marker.at).toISOString()} · ${clip(marker.text, 160)}`;
  return (
    <g className="timeline-marker" role="button" tabIndex={0} aria-label={label} aria-pressed={selected} aria-controls="timeline-event-detail"
      onClick={onSelect} onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        onSelect();
      }}>
      <title>{marker.text}</title>
      <circle className="marker-ring" cx={x} cy={15} r={12} aria-hidden="true" />
      <text className={`mark tone-${marker.color}`} x={x} y={20} textAnchor="middle" aria-hidden="true">{marker.glyph}</text>
    </g>
  );
}
