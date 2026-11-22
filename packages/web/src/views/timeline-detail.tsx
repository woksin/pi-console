import type { Marker } from '@pi-console/viewmodels';

export function TimelineDetail({ marker, lane }: { marker: Marker; lane: string }) {
  return (
    <section className="timeline-detail" id="timeline-event-detail" role="region" aria-label="Timeline event detail" aria-live="polite">
      <h2>{marker.kind}</h2>
      <p className="muted">{lane} · {marker.sessionId} · <time dateTime={new Date(marker.at).toISOString()}>{new Date(marker.at).toISOString()}</time></p>
      <p className="timeline-detail-text">{marker.text}</p>
    </section>
  );
}
