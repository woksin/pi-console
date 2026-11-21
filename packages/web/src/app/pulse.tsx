import { useMemo } from 'react';
import { pulseViewModel } from '@pi-console/viewmodels';
import type { Session } from '@pi-console/contract';
import { Sparkline } from '../ui/primitives.tsx';

/** Bounded status-coloured fleet runs, activity, and the needs-you count. Same view model as the TUI strip. */
export function FleetPulse({ sessions, needsYou }: { sessions: readonly Session[]; needsYou: number }) {
  const pulse = useMemo(() => pulseViewModel({ sessions, needsYou }), [sessions, needsYou]);
  if (pulse.sessions === 0) return null;
  return (
    <div className="pulse" role="img" aria-label={`Fleet pulse: ${pulse.summary}`} title={pulse.summary}>
      <span className="pulse-cells" aria-hidden="true">
        {pulse.cells.map(cell => <i key={cell.id} className={`pulse-cell tone-${cell.status.color} st-${cell.status.status}`} title={`${cell.title}: ${cell.status.label}`}><span>{cell.monoGlyph}</span></i>)}
      </span>
      {pulse.needsYou > 0 && <span className="pulse-count" aria-hidden="true">! {pulse.needsYou}</span>}
      <span className="pulse-activity" aria-hidden="true"><Sparkline values={pulse.activity} width={72} height={20} fill label="Fleet activity" /></span>
    </div>
  );
}
